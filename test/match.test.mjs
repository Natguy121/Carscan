import test from 'node:test';
import assert from 'node:assert/strict';

import { fuseDetections } from '../js/vision.js';
import { rankCandidates, resolve } from '../js/match.js';
import { CARS } from '../js/cars.js';

/** Build an angle result shaped like a Google WEB_DETECTION response. */
function angle(bestGuess, entityNames, year = null) {
  return {
    bestGuess,
    entities: entityNames.map((name, i) => ({ name, score: 1.5 - i * 0.1 })),
    pages: [],
    year,
  };
}

function identify(angles) {
  const fused = fuseDetections(angles);
  return resolve(fused, rankCandidates(fused));
}

test('identifies a car from a single confident angle', () => {
  const r = identify([angle('nissan gt-r r35', ['Nissan GT-R', 'Nissan', 'Sports car'])]);
  assert.equal(r.status, 'identified');
  assert.equal(r.car.id, 'nissan-gtr-r35');
});

test('multiple agreeing angles identify the car', () => {
  const r = identify([
    angle('mazda mx-5 miata', ['Mazda MX-5', 'Mazda', 'Convertible']),
    angle('mazda miata nd', ['Mazda MX-5 Miata', 'Roadster']),
    angle('mx-5', ['Mazda MX-5', 'Mazda']),
  ]);
  assert.equal(r.status, 'identified');
  assert.equal(r.car.id, 'mazda-mx5');
});

test('agreement across angles beats a single dissenting angle', () => {
  const r = identify([
    angle('toyota supra', ['Toyota Supra', 'Toyota GR Supra']),
    angle('toyota gr supra a90', ['Toyota Supra', 'Toyota']),
    angle('bmw z4', ['BMW Z4']), // the A90 shares its platform; one angle gets it wrong
  ]);
  assert.equal(r.car?.id ?? r.candidates[0].car.id, 'toyota-supra-a90');
});

test('same model different trims comes back ambiguous for the player to settle', () => {
  const r = identify([
    angle('porsche 911', ['Porsche 911', 'Porsche', 'Porsche 911 (992)']),
    angle('porsche 992', ['Porsche 911', 'Porsche']),
  ]);
  assert.equal(r.status, 'ambiguous');
  const ids = r.candidates.map((c) => c.car.id);
  assert.ok(ids.includes('porsche-911-carrera'));
  assert.ok(ids.includes('porsche-911-turbo-s'));
});

test('a car outside the database resolves to unknown, not a wrong match', () => {
  const r = identify([angle('kia sorento', ['Kia Sorento', 'Kia', 'Kia Motors'])]);
  assert.equal(r.status, 'unknown');
});

test('model year narrows between generations of one nameplate', () => {
  const r = identify([
    angle('nissan skyline gt-r r34', ['Nissan Skyline GT-R', 'Nissan Skyline', 'Nissan'], 2001),
  ]);
  assert.equal(r.status, 'identified');
  assert.equal(r.car.id, 'nissan-skyline-r34');
});

test('hyphen and spacing variants of a model code still match', () => {
  for (const label of ['ford f150 pickup', 'ford f-150', 'Ford F 150']) {
    const fused = fuseDetections([angle(label, ['Ford F-Series', 'Ford'])]);
    const ranked = rankCandidates(fused);
    assert.equal(ranked[0].car.id, 'ford-f150', `failed for ${label}`);
  }
});

test('common commuter cars resolve as readily as exotics', () => {
  const cases = [
    ['toyota corolla', ['Toyota Corolla', 'Toyota'], 'toyota-corolla'],
    ['honda civic sedan', ['Honda Civic', 'Honda'], 'honda-civic'],
    ['jeep wrangler rubicon', ['Jeep Wrangler', 'Jeep'], 'jeep-wrangler'],
    ['tesla model 3', ['Tesla Model 3', 'Tesla'], 'tesla-model-3'],
  ];
  for (const [guess, entities, expected] of cases) {
    const r = identify([angle(guess, entities)]);
    assert.equal(r.car?.id, expected, `failed for ${guess}`);
  }
});

test('a photo with no car in it yields nothing', () => {
  const r = identify([angle('golden retriever', ['Dog', 'Golden Retriever', 'Puppy'])]);
  assert.equal(r.status, 'unknown');
  assert.equal(r.candidates.length, 0);
});

test('database entries are well formed and uniquely identified', () => {
  const ids = new Set();
  for (const car of CARS) {
    assert.ok(!ids.has(car.id), `duplicate id ${car.id}`);
    ids.add(car.id);
    for (const field of ['make', 'model', 'years', 'body', 'country', 'rarity', 'engine', 'blurb']) {
      assert.ok(car[field], `${car.id} missing ${field}`);
    }
    for (const field of ['power', 'torque', 'zeroToSixty', 'topSpeed', 'weight', 'seats']) {
      assert.equal(typeof car[field], 'number', `${car.id} bad ${field}`);
    }
  }
  assert.ok(CARS.length >= 60);
});
