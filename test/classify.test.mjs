import test from 'node:test';
import assert from 'node:assert/strict';

import { looksLikeVehicle, inferBody, inferBodyFromPredictions, topLabel } from '../js/classify.js';

/** Build a fake MobileNet prediction list, most confident first. */
function predictions(...pairs) {
  return pairs.map(([className, probability]) => ({ className, probability }));
}

test('recognises a car photo from its ImageNet classes', () => {
  assert.ok(looksLikeVehicle(predictions(['pickup, pickup truck', 0.6], ['tow truck, tow car, wrecker', 0.1])));
  assert.ok(looksLikeVehicle(predictions(['car wheel', 0.4], ['disk brake, disc brake', 0.2])));
});

test('a low-confidence guess does not count as spotting a car', () => {
  assert.equal(looksLikeVehicle(predictions(['pickup, pickup truck', 0.05])), false);
});

test('a non-car photo is not mistaken for one', () => {
  assert.equal(looksLikeVehicle(predictions(['golden retriever', 0.8], ['Labrador retriever', 0.1])), false);
});

test('body style is read from the most confident matching class', () => {
  const cases = [
    [predictions(['minivan', 0.7]), 'minivan'],
    [predictions(['pickup, pickup truck', 0.5]), 'pickup'],
    [predictions(['jeep, landrover', 0.6]), 'suv'],
    [predictions(['beach wagon, station wagon', 0.4]), 'wagon'],
    [predictions(['convertible', 0.5]), 'convertible'],
    [predictions(['limousine, limo', 0.3]), 'sedan'],
    [predictions(['sports car, sport car', 0.5]), 'coupe'],
  ];
  for (const [preds, expected] of cases) {
    assert.equal(inferBodyFromPredictions(preds), expected, `failed for ${preds[0].className}`);
  }
});

test('a more specific class wins over a broader one that also matches', () => {
  // "minivan" must not fall through to the generic "van" mapping.
  assert.equal(inferBodyFromPredictions(predictions(['minivan', 0.5])), 'minivan');
});

test('body style is unknown rather than guessed when nothing maps', () => {
  assert.equal(inferBodyFromPredictions(predictions(['golden retriever', 0.9])), null);
});

test('the top label is a readable, title-cased description', () => {
  assert.equal(topLabel(predictions(['sports car, sport car', 0.7])), 'Sports Car');
  assert.equal(topLabel(predictions(['pickup, pickup truck', 0.5])), 'Pickup');
});

test('no predictions yields no label', () => {
  assert.equal(topLabel([]), null);
});

test('agreeing weaker guesses outweigh a single stronger disagreeing one', () => {
  // "sports car" leads on its own, but two wagon-ish classes together beat it.
  const preds = predictions(
    ['sports car, sport car', 0.30],
    ['beach wagon, station wagon', 0.28],
    ['minivan', 0.00],
    ['station wagon', 0.10],
  );
  assert.equal(inferBodyFromPredictions(preds), 'wagon');
});

test('confidence reflects how much the vehicle classes agree', () => {
  const agreed = inferBody(predictions(['pickup, pickup truck', 0.8], ['tow truck, tow car', 0.1]));
  assert.equal(agreed.body, 'pickup');
  assert.ok(agreed.confidence > 0.9, `expected high confidence, got ${agreed.confidence}`);

  const split = inferBody(predictions(['sports car, sport car', 0.3], ['minivan', 0.3]));
  assert.ok(split.confidence <= 0.5, `expected low confidence, got ${split.confidence}`);
});

test('no vehicle classes means no body style and no confidence', () => {
  const r = inferBody(predictions(['golden retriever', 0.9]));
  assert.equal(r.body, null);
  assert.equal(r.confidence, 0);
});
