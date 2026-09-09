import test from 'node:test';
import assert from 'node:assert/strict';

import { candidatesForBody } from '../js/match.js';
import { CARS, BODIES, RARITY } from '../js/cars.js';

test('the shortlist for a body style only contains cars that share it, when there are enough', () => {
  const list = candidatesForBody('pickup', 5);
  assert.ok(list.length > 0);
  assert.ok(list.every((c) => c.body === 'pickup'));
});

test('cars matching the guessed body style are ranked before everything else', () => {
  const list = candidatesForBody('minivan', 20);
  const lastMatchIndex = list.map((c) => c.body === 'minivan').lastIndexOf(true);
  const firstMismatchIndex = list.findIndex((c) => c.body !== 'minivan');
  if (firstMismatchIndex !== -1 && lastMatchIndex !== -1) {
    assert.ok(lastMatchIndex < firstMismatchIndex);
  }
});

test('within a body style, commoner cars are ranked first', () => {
  const list = candidatesForBody('suv', 40);
  const firstRareIndex = list.findIndex((c) => c.rarity !== 'common' && c.body === 'suv');
  const lastCommonIndex = list.map((c) => c.rarity === 'common' && c.body === 'suv').lastIndexOf(true);
  if (firstRareIndex !== -1 && lastCommonIndex !== -1) {
    assert.ok(lastCommonIndex < firstRareIndex);
  }
});

test('an unknown body style still returns a shortlist, ranked by commonness alone', () => {
  const list = candidatesForBody(null, 10);
  assert.equal(list.length, 10);
  assert.equal(list[0].rarity, 'common');
});

test('respects the requested limit', () => {
  assert.equal(candidatesForBody('sedan', 3).length, 3);
});

test('database entries are well formed and uniquely identified', () => {
  const ids = new Set();
  for (const car of CARS) {
    assert.ok(!ids.has(car.id), `duplicate id ${car.id}`);
    ids.add(car.id);
    for (const field of ['make', 'model', 'years', 'body', 'country', 'rarity', 'engine', 'blurb']) {
      assert.ok(car[field], `${car.id} missing ${field}`);
    }
    assert.ok(BODIES[car.body], `${car.id} has unknown body "${car.body}"`);
    assert.ok(RARITY[car.rarity], `${car.id} has unknown rarity "${car.rarity}"`);
    for (const field of ['power', 'torque', 'zeroToSixty', 'topSpeed', 'weight', 'seats']) {
      assert.equal(typeof car[field], 'number', `${car.id} bad ${field}`);
    }
  }
  assert.ok(CARS.length >= 180);
});
