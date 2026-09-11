import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  hasPassword, setPassword, checkPassword, clearPassword,
  teachLogo, recallLogo, logoStats, forgetLogos, exportLogos, importLogos, loadSeedLogos,
} = await import('../js/logos.js');

const clearSeedFlag = () => store.delete('carscan.logos.seed-loaded.v1');

function fingerprint(seed, length = 32) {
  let x = seed * 9301 + 49297;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    x = (x * 9301 + 49297) % 233280;
    out[i] = x / 233280;
  }
  return out;
}

function nudge(vector, amount) {
  const out = Float32Array.from(vector);
  for (let i = 0; i < out.length; i++) out[i] += (i % 2 ? amount : -amount);
  return out;
}

test.beforeEach(() => { forgetLogos(); clearPassword(); clearSeedFlag(); });

// --------------------------------------------------------------- password

test('no password is set until one is chosen', () => {
  assert.equal(hasPassword(), false);
});

test('the right password checks out once set', async () => {
  await setPassword('carscan123');
  assert.ok(hasPassword());
  assert.ok(await checkPassword('carscan123'));
});

test('a wrong password fails, including empty and near-misses', async () => {
  await setPassword('carscan123');
  assert.equal(await checkPassword('carscan124'), false);
  assert.equal(await checkPassword(''), false);
  assert.equal(await checkPassword(undefined), false);
});

test('checking before any password is set never accidentally passes', async () => {
  assert.equal(await checkPassword(''), false);
  assert.equal(await checkPassword('anything'), false);
});

test('the password itself is never stored in the clear', async () => {
  await setPassword('carscan123');
  const raw = JSON.stringify([...store.entries()]);
  assert.ok(!raw.includes('carscan123'), 'the plaintext password must not be persisted anywhere');
});

test('a too-short password is rejected', async () => {
  await assert.rejects(() => setPassword('abc'));
  assert.equal(hasPassword(), false);
});

test('clearing the password removes it', async () => {
  await setPassword('carscan123');
  clearPassword();
  assert.equal(hasPassword(), false);
  assert.equal(await checkPassword('carscan123'), false);
});

// ------------------------------------------------------------------ logos

test('a taught badge is recognised from a similar photo', () => {
  const seen = fingerprint(1);
  teachLogo('Toyota', seen);
  const hit = recallLogo(nudge(seen, 0.02));
  assert.ok(hit);
  assert.equal(hit.make, 'Toyota');
});

test('an untaught badge is not mistaken for one that was', () => {
  teachLogo('Toyota', fingerprint(1));
  assert.equal(recallLogo(fingerprint(999)), null);
});

test('nothing is recognised before anything is taught', () => {
  assert.equal(recallLogo(fingerprint(1)), null);
});

test('the closest of several taught badges wins', () => {
  const honda = fingerprint(2);
  teachLogo('Ford', fingerprint(3));
  teachLogo('Honda', honda);
  teachLogo('BMW', fingerprint(4));
  assert.equal(recallLogo(nudge(honda, 0.01)).make, 'Honda');
});

test('stats count samples and distinct makes separately', () => {
  teachLogo('Toyota', fingerprint(1));
  teachLogo('Toyota', fingerprint(2));
  teachLogo('Honda', fingerprint(3));
  const stats = logoStats();
  assert.equal(stats.samples, 3);
  assert.equal(stats.makes, 2);
  assert.equal(stats.perMake.get('Toyota'), 2);
});

test('an empty fingerprint teaches nothing', () => {
  assert.equal(teachLogo('Toyota', new Float32Array(0)), false);
  assert.equal(logoStats().samples, 0);
});

test('the trained set stays bounded, favouring variety over one flooded make', () => {
  teachLogo('Bugatti', fingerprint(5));
  for (let i = 0; i < 400; i++) teachLogo('Toyota', fingerprint(100 + i));
  const stats = logoStats();
  assert.ok(stats.samples <= 300);
  assert.equal(stats.makes, 2, 'the one-off badge should survive the flood');
});

test('forgetting clears every trained badge', () => {
  teachLogo('Toyota', fingerprint(1));
  forgetLogos();
  assert.deepEqual(logoStats(), { samples: 0, makes: 0, perMake: new Map() });
});

// --------------------------------------------------------- export / import

test('exporting and importing round-trips the trained set', () => {
  teachLogo('Toyota', fingerprint(1));
  teachLogo('Honda', fingerprint(2));
  const dump = exportLogos();

  forgetLogos();
  assert.equal(logoStats().samples, 0);

  const added = importLogos(dump);
  assert.equal(added, 2);
  assert.equal(logoStats().samples, 2);
  assert.ok(recallLogo(fingerprint(1)));
});

test('importing adds to what is already trained rather than replacing it', () => {
  teachLogo('Toyota', fingerprint(1));
  teachLogo('Honda', fingerprint(2));
  const dump = exportLogos();
  teachLogo('Ford', fingerprint(3)); // trained locally after the export was taken

  importLogos(dump); // re-importing the same export must not lose the local addition
  assert.equal(logoStats().samples, 5); // 3 local + 2 re-imported duplicates
  assert.equal(logoStats().makes, 3);
});

test('malformed entries in an imported file are skipped, not crashed on', () => {
  const added = importLogos(JSON.stringify({
    samples: [{ make: 'Toyota' }, null, { v: 'x' }, { make: 'Honda', v: 'AAAA' }],
  }));
  assert.equal(added, 1, 'only the one entry with both a make and a fingerprint counts');
  assert.equal(logoStats().samples, 1);
});

// ------------------------------------------------------------------ seed

test('the seed loads once and marks itself so it never re-imports', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ samples: [{ make: 'Toyota', v: 'AAAA' }] }),
  });
  const first = await loadSeedLogos();
  assert.equal(first, 1);
  assert.equal(logoStats().samples, 1);

  const second = await loadSeedLogos();
  assert.equal(second, 0, 'a second load must not re-import the seed');
  assert.equal(logoStats().samples, 1);
});

test('a missing or unreachable seed file is not an error', async () => {
  clearSeedFlag();
  globalThis.fetch = async () => ({ ok: false });
  assert.equal(await loadSeedLogos(), 0);

  clearSeedFlag();
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await loadSeedLogos(), 0);
});

test('the seed never overwrites badges the player already taught themselves', async () => {
  teachLogo('Honda', fingerprint(9));
  clearSeedFlag();
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ samples: [{ make: 'Toyota', v: 'AAAA' }] }),
  });
  await loadSeedLogos();
  assert.equal(logoStats().samples, 2);
  assert.ok(logoStats().perMake.has('Honda'));
});
