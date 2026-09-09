import test from 'node:test';
import assert from 'node:assert/strict';

// The memory keeps its fingerprints in localStorage; give it one before import.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { remember, recall, forgetAll, memoryStats, toUnit, similarity, pack, unpack } =
  await import('../js/memory.js');

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

test.beforeEach(() => forgetAll());

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
