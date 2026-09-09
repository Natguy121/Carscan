import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseDetection } from '../js/vision.js';
import { rankCandidates, resolve } from '../js/match.js';
import { CARS } from '../js/cars.js';

/** Build a result shaped like a Google WEB_DETECTION response. */
function seen(bestGuess, entityNames, year = null) {
  return {
    bestGuess,
    entities: entityNames.map((name, i) => ({ name, score: 1.5 - i * 0.1 })),
    pages: [],
    year,
  };
}

function identify(detection) {
  const reading = analyseDetection(detection);
  return resolve(reading, rankCandidates(reading));
}

test('identifies a car from one photo', () => {
  const r = identify(seen('nissan gt-r r35', ['Nissan GT-R', 'Nissan', 'Sports car']));
  assert.equal(r.status, 'identified');
  assert.equal(r.car.id, 'nissan-gtr-r35');
});

test('a nickname in the entities still finds the car', () => {
  const r = identify(seen('mazda mx-5 miata', ['Mazda MX-5', 'Mazda', 'Convertible']));
  assert.equal(r.status, 'identified');
  assert.equal(r.car.id, 'mazda-mx5');
});

test('the best-guess label outweighs a lower-ranked entity', () => {
  // The A90 Supra shares its platform with the Z4, which Vision often lists too.
  const r = identify(seen('toyota gr supra a90', ['Toyota Supra', 'Toyota', 'BMW Z4']));
  assert.equal(r.car?.id ?? r.candidates[0].car.id, 'toyota-supra-a90');
});

test('same model different trims comes back ambiguous for the player to settle', () => {
  const r = identify(seen('porsche 911', ['Porsche 911', 'Porsche', 'Porsche 911 (992)']));
  assert.equal(r.status, 'ambiguous');
  const ids = r.candidates.map((c) => c.car.id);
  assert.ok(ids.includes('porsche-911-carrera'));
  assert.ok(ids.includes('porsche-911-turbo-s'));
});

test('a car outside the database resolves to unknown, not a wrong match', () => {
  const r = identify(seen('lada niva', ['Lada Niva', 'Lada', 'AvtoVAZ']));
  assert.equal(r.status, 'unknown');
});

test('the base model wins over its hotter variant when Google names neither', () => {
  // "Golf" alone should not land on the GTI, nor "Civic" on the Type R.
  for (const [guess, entities, expected] of [
    ['volkswagen golf', ['Volkswagen Golf', 'Volkswagen'], 'vw-golf'],
    ['honda civic', ['Honda Civic', 'Honda'], 'honda-civic'],
    ['toyota corolla', ['Toyota Corolla', 'Toyota'], 'toyota-corolla'],
  ]) {
    assert.equal(identify(seen(guess, entities)).car?.id, expected, `failed for ${guess}`);
  }
});

test('names built from a letter and a word survive tokenising', () => {
  // "A-Class" and "Model Y" vanish if the lone letter is dropped before pairing.
  for (const [guess, entities, expected] of [
    ['mercedes a class', ['Mercedes-Benz A-Class', 'Mercedes-Benz'], 'mercedes-aclass'],
    ['mercedes s class', ['Mercedes-Benz S-Class', 'Mercedes-Benz'], 'mercedes-sclass'],
    ['tesla model y', ['Tesla Model Y', 'Tesla'], 'tesla-model-y'],
    ['tesla model x', ['Tesla Model X', 'Tesla'], 'tesla-model-x'],
  ]) {
    assert.equal(identify(seen(guess, entities)).car?.id, expected, `failed for ${guess}`);
  }
});

test('a make word does not outrank the model that names a different car', () => {
  // "Rover" sits in the Range Rover's model name but is only the make here.
  assert.equal(
    identify(seen('land rover defender', ['Land Rover Defender', 'Land Rover'])).car?.id,
    'landrover-defender',
  );
});

test('model year narrows between generations of one nameplate', () => {
  const r = identify(seen('nissan skyline gt-r r34', ['Nissan Skyline GT-R', 'Nissan Skyline', 'Nissan'], 2001));
  assert.equal(r.status, 'identified');
  assert.equal(r.car.id, 'nissan-skyline-r34');
});

test('hyphen and spacing variants of a model code still match', () => {
  for (const label of ['ford f150 pickup', 'ford f-150', 'Ford F 150']) {
    const reading = analyseDetection(seen(label, ['Ford F-Series', 'Ford']));
    const ranked = rankCandidates(reading);
    assert.equal(ranked[0].car.id, 'ford-f150', `failed for ${label}`);
  }
});

test('common commuter cars resolve as readily as exotics', () => {
  const cases = [
    ['toyota corolla', ['Toyota Corolla', 'Toyota'], 'toyota-corolla'],
    ['honda civic sedan', ['Honda Civic', 'Honda'], 'honda-civic'],
    ['jeep wrangler rubicon', ['Jeep Wrangler', 'Jeep'], 'jeep-wrangler'],
    ['tesla model 3', ['Tesla Model 3', 'Tesla'], 'tesla-model-3'],
    ['kia sorento', ['Kia Sorento', 'Kia'], 'kia-sorento'],
    ['subaru forester', ['Subaru Forester', 'Subaru'], 'subaru-forester'],
    ['vauxhall corsa', ['Vauxhall Corsa', 'Opel Corsa'], 'opel-corsa'],
    ['skoda octavia', ['Škoda Octavia', 'Škoda'], 'skoda-octavia'],
    ['bmw x5', ['BMW X5', 'BMW'], 'bmw-x5'],
  ];
  for (const [guess, entities, expected] of cases) {
    const r = identify(seen(guess, entities));
    assert.equal(r.car?.id, expected, `failed for ${guess}`);
  }
});

test('a photo with no car in it yields nothing', () => {
  const r = identify(seen('golden retriever', ['Dog', 'Golden Retriever', 'Puppy']));
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
  assert.ok(CARS.length >= 180);
});
