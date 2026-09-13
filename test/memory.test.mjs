import test from 'node:test';
import assert from 'node:assert/strict';

// The memory keeps its fingerprints in localStorage; give it one before import.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  remember, recall, forgetAll, memoryStats, toUnit, similarity, pack, unpack,
  exportMemory, importMemory, loadSeedMemory,
} = await import('../js/memory.js');

const clearSeedFlag = () => store.delete('carscan.memory.seed-loaded.v1');

/** A repeatable pseudo-random fingerprint, optionally nudged off an original. */
function fingerprint(seed, length = 64) {
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

test.beforeEach(() => { forgetAll(); clearSeedFlag(); });

test('a vector scaled to unit length has length 1', () => {
  const unit = toUnit(new Float32Array([3, 4]));
  assert.ok(Math.abs(Math.hypot(unit[0], unit[1]) - 1) < 1e-6);
});

test('an all-zero fingerprint does not divide by zero', () => {
  const unit = toUnit(new Float32Array([0, 0, 0]));
  assert.ok([...unit].every((v) => v === 0));
});

test('packing and unpacking a fingerprint keeps it recognisably itself', () => {
  const unit = toUnit(fingerprint(7));
  const restored = unpack(pack(unit));
  assert.equal(restored.length, unit.length);
  assert.ok(similarity(unit, restored) > 0.999, 'quantisation must not lose the shape');
});

test('a car you taught it is recognised from a similar photo', () => {
  const seen = fingerprint(1);
  remember('toyota-fortuner', seen);

  const hit = recall(nudge(seen, 0.02));
  assert.ok(hit, 'a near-identical photo should be recognised');
  assert.equal(hit.carId, 'toyota-fortuner');
});

test('an unrelated car is not mistaken for one you taught it', () => {
  remember('toyota-fortuner', fingerprint(1));
  assert.equal(recall(fingerprint(999)), null);
});

test('nothing is recognised from an empty memory', () => {
  assert.equal(recall(fingerprint(1)), null);
});

test('the closest of several taught cars wins', () => {
  const corolla = fingerprint(2);
  remember('honda-civic', fingerprint(3));
  remember('toyota-corolla', corolla);
  remember('ford-f150', fingerprint(4));

  const hit = recall(nudge(corolla, 0.01));
  assert.equal(hit.carId, 'toyota-corolla');
});

test('teaching the same car twice keeps it a single learned car', () => {
  remember('toyota-corolla', fingerprint(2));
  remember('toyota-corolla', nudge(fingerprint(2), 0.05));
  assert.deepEqual(memoryStats(), { samples: 2, cars: 1 });
});

test('an empty fingerprint teaches nothing', () => {
  assert.equal(remember('toyota-corolla', new Float32Array(0)), false);
  assert.equal(memoryStats().samples, 0);
});

test('the memory stays bounded, and a car scanned constantly cannot crowd out a rare one', () => {
  remember('bugatti-chiron', fingerprint(5));
  for (let i = 0; i < 400; i++) remember('toyota-corolla', fingerprint(100 + i));

  const { samples, cars } = memoryStats();
  assert.ok(samples <= 240, `expected the memory to stay capped, got ${samples}`);
  assert.equal(cars, 2, 'the one-off catch should survive the flood');
});

test('forgetting clears everything', () => {
  remember('toyota-corolla', fingerprint(2));
  forgetAll();
  assert.deepEqual(memoryStats(), { samples: 0, cars: 0 });
});

// --------------------------------------------------------- export / import

test('exporting and importing round-trips what was learned', () => {
  remember('toyota-corolla', fingerprint(1));
  remember('honda-civic', fingerprint(2));
  const dump = exportMemory();

  forgetAll();
  assert.equal(memoryStats().samples, 0);

  const added = importMemory(dump);
  assert.equal(added, 2);
  assert.equal(memoryStats().samples, 2);
  assert.ok(recall(fingerprint(1)));
});

test('importing adds to what is already learned rather than replacing it', () => {
  remember('toyota-corolla', fingerprint(1));
  remember('honda-civic', fingerprint(2));
  const dump = exportMemory();
  remember('ford-f150', fingerprint(3)); // learned locally after the export was taken

  importMemory(dump); // re-importing the same export must not lose the local addition
  assert.equal(memoryStats().samples, 5); // 3 local + 2 re-imported duplicates
  assert.equal(memoryStats().cars, 3);
});

test('malformed entries in an imported file are skipped, not crashed on', () => {
  const added = importMemory(JSON.stringify({
    samples: [{ carId: 'toyota-corolla' }, null, { v: 'x' }, { carId: 'honda-civic', v: 'AAAA' }],
  }));
  assert.equal(added, 1, 'only the one entry with both a carId and a fingerprint counts');
  assert.equal(memoryStats().samples, 1);
});

// ------------------------------------------------------------------ seed

test('the seed loads once and marks itself so it never re-imports', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ samples: [{ carId: 'toyota-corolla', v: 'AAAA' }] }),
  });
  const first = await loadSeedMemory();
  assert.equal(first, 1);
  assert.equal(memoryStats().samples, 1);

  const second = await loadSeedMemory();
  assert.equal(second, 0, 'a second load must not re-import the seed');
  assert.equal(memoryStats().samples, 1);
});

test('a missing or unreachable seed file is not an error', async () => {
  clearSeedFlag();
  globalThis.fetch = async () => ({ ok: false });
  assert.equal(await loadSeedMemory(), 0);

  clearSeedFlag();
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await loadSeedMemory(), 0);
});

test('the seed never overwrites cars the player already caught themselves', async () => {
  remember('honda-civic', fingerprint(9));
  clearSeedFlag();
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ samples: [{ carId: 'toyota-corolla', v: 'AAAA' }] }),
  });
  await loadSeedMemory();
  assert.equal(memoryStats().samples, 2);
  assert.equal(memoryStats().cars, 2);
});
