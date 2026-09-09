import test from 'node:test';
import assert from 'node:assert/strict';

import { TRAITS, TRAIT_GROUPS, matchesTraits, usefulTraits } from '../js/traits.js';
import { CARS, CARS_BY_ID } from '../js/cars.js';

test('there are thirty things to look for', () => {
  assert.equal(TRAITS.length, 30);
});

test('every trait is uniquely identified and belongs to a real group', () => {
  const groups = new Set(TRAIT_GROUPS.map(([key]) => key));
  const ids = new Set();
  for (const trait of TRAITS) {
    assert.ok(!ids.has(trait.id), `duplicate trait ${trait.id}`);
    ids.add(trait.id);
    assert.ok(trait.label, `${trait.id} needs a label`);
    assert.ok(groups.has(trait.group), `${trait.id} has unknown group "${trait.group}"`);
    assert.equal(typeof trait.test, 'function');
  }
});

test('every trait actually splits the index — none matches nothing or everything', () => {
  for (const trait of TRAITS) {
    const hits = CARS.filter(trait.test).length;
    assert.ok(hits > 0, `${trait.id} matches no car, so it can only ever be a dead end`);
    assert.ok(hits < CARS.length, `${trait.id} matches every car, so it narrows nothing`);
  }
});

test('an empty selection matches every car', () => {
  const none = new Set();
  assert.ok(CARS.every((car) => matchesTraits(car, none)));
});

test('traits are read off the car, not invented for it', () => {
  const fortuner = CARS_BY_ID.get('toyota-fortuner');
  const ticked = new Set(['tall', 'jp', 'diesel', 'seven-seats']);
  assert.ok(matchesTraits(fortuner, ticked));

  // The same ticks must reject a car that genuinely differs on one of them.
  const civic = CARS_BY_ID.get('honda-civic');
  assert.equal(matchesTraits(civic, ticked), false);
});

test('ticks combine — every one has to hold', () => {
  const ticked = new Set(['electric', 'tall']);
  const matched = CARS.filter((car) => matchesTraits(car, ticked));
  assert.ok(matched.length > 0);
  assert.ok(matched.every((c) => c.fuel === 'electric'));
  assert.ok(matched.every((c) => c.body === 'suv' || c.body === 'pickup'));
});

test('a handful of ticks narrows the index to something pickable', () => {
  const before = CARS.length;
  const after = CARS.filter((car) => matchesTraits(car, new Set(['tall', 'jp', 'diesel', 'seven-seats']))).length;
  assert.ok(after < 10, `expected a short list, got ${after}`);
  assert.ok(after > 0, 'four honest observations should not wipe the list out');
  assert.ok(after < before);
});

test('an unknown trait id is ignored rather than rejecting everything', () => {
  assert.ok(matchesTraits(CARS[0], new Set(['not-a-real-trait'])));
});

test('traits that would empty the list are not offered', () => {
  const pool = CARS.filter((c) => c.fuel === 'electric');
  const offered = usefulTraits(pool, new Set());
  assert.ok(!offered.some((t) => t.id === 'diesel'), 'no electric car is a diesel');
  assert.ok(offered.some((t) => t.id === 'tall'), 'some electric cars are tall, so it still helps');
});

test('a trait every remaining car shares is not offered either', () => {
  const pool = CARS.filter((c) => c.country === 'Japan');
  const offered = usefulTraits(pool, new Set());
  assert.ok(!offered.some((t) => t.id === 'jp'), 'they are all Japanese — ticking it tells you nothing');
});

test('an already-ticked trait stays on the panel so it can be unticked', () => {
  const ticked = new Set(['jp']);
  const pool = CARS.filter((car) => matchesTraits(car, ticked));
  const offered = usefulTraits(pool, ticked);
  assert.ok(offered.some((t) => t.id === 'jp'));
});
