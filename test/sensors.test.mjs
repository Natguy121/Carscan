import test from 'node:test';
import assert from 'node:assert/strict';
import { headingFromEvent, tiltFromEvent, circularMean, circularSpread } from '../js/sensors.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('heading turns clockwise as alpha turns anticlockwise', () => {
  assert.equal(headingFromEvent({ alpha: 0 }), 0);
  assert.equal(headingFromEvent({ alpha: 90 }), 270);
  assert.equal(headingFromEvent({ alpha: 270 }), 90);
});

test('a landscape screen shifts the heading', () => {
  assert.equal(headingFromEvent({ alpha: 0 }, 90), 90);
});

test('no reading gives no heading', () => {
  assert.equal(headingFromEvent({ alpha: null }), null);
  assert.equal(headingFromEvent(null), null);
});

test('tilt is the larger of front-back and side-side', () => {
  assert.equal(tiltFromEvent({ beta: 5, gamma: -12 }), 12);
  assert.equal(tiltFromEvent({ beta: null, gamma: 0 }), null);
});

test('averaging angles across north does not land on south', () => {
  close(circularMean([359, 1]) % 360, 0, 1e-9);
  close(circularMean([350, 10, 0]), 0, 1e-9);
  close(circularMean([80, 100]), 90);
  assert.equal(circularMean([]), null);
});

test('spread measures wobble, wrapping across north', () => {
  close(circularSpread([359, 1]), 1);
  assert.ok(circularSpread([0, 90]) > 40);
  assert.equal(circularSpread([]), Infinity);
});
