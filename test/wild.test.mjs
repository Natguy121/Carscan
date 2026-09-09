import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseDetection, inferBody, looksLikeCar } from '../js/vision.js';

function seen(bestGuess, entityNames) {
  return {
    bestGuess,
    entities: entityNames.map((name, i) => ({ name, score: 1.5 - i * 0.1 })),
    pages: [],
    year: null,
  };
}

test('body style is read from the words Google uses', () => {
  const cases = [
    ['suv', ['Sport utility vehicle', 'Car']],
    ['van', ['Van', 'Commercial vehicle']],
    ['minivan', ['Minivan', 'Van']], // the more specific word wins
    ['wagon', ['Station wagon', 'Car']],
    ['pickup', ['Pickup truck', 'Truck']],
    ['coupe', ['Coupé', 'Sports car']],
    ['convertible', ['Convertible', 'Roadster']],
    ['hatchback', ['Hatchback', 'City car']],
    ['sedan', ['Sedan', 'Mid-size car']],
  ];
  for (const [expected, entities] of cases) {
    assert.equal(inferBody(seen('a car', entities)), expected, `failed for ${entities[0]}`);
  }
});

test('body style falls back to a sedan when Google says nothing useful', () => {
  assert.equal(inferBody(seen('bugatti chiron', ['Bugatti Chiron', 'Bugatti'])), 'sedan');
});

test('a car photo is recognised as a car', () => {
  assert.ok(looksLikeCar(seen('kia sorento', ['Kia Sorento', 'Kia', 'Sport utility vehicle', 'Car'])));
  assert.ok(looksLikeCar(seen('some hatchback', ['Bumper', 'Grille', 'Alloy wheel'])));
});

test('a photo that is not a car is not offered as a catch', () => {
  assert.equal(looksLikeCar(seen('golden retriever', ['Dog', 'Golden Retriever', 'Puppy'])), false);
  assert.equal(looksLikeCar(seen('eiffel tower', ['Eiffel Tower', 'Landmark', 'Paris'])), false);
});

test('the properly cased entity name is shown, not the lowercase best guess', () => {
  // Google returns best-guess labels lowercase but entities correctly cased.
  const reading = analyseDetection(seen('kia sorento', ['Kia Sorento', 'Kia']));
  assert.equal(reading.phrases[0].display, 'Kia Sorento');
});
