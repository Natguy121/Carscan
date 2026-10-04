import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDeg, turnBetween, squareUp, solveRoom, polygonArea, perimeter, centroid,
  placePoints, rectangleWalls,
} from '../js/geometry.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('angles wrap into 0–360 and turns into ±180', () => {
  assert.equal(normalizeDeg(-90), 270);
  assert.equal(normalizeDeg(450), 90);
  assert.equal(turnBetween(350, 10), 20);
  assert.equal(turnBetween(10, 350), -20);
  assert.equal(turnBetween(0, 180), 180);
});

test('a measured rectangle closes and has the right area', () => {
  const r = solveRoom(rectangleWalls(4, 3));
  assert.ok(r.ok);
  close(polygonArea(r.points), 12);
  close(perimeter(r.lengths), 14);
  close(r.error, 0);
});

test('measuring two adjacent walls is enough for a rectangle', () => {
  const r = solveRoom([
    { heading: 90, length: 4 },
    { heading: 180, length: 3 },
    { heading: 270, length: null },
    { heading: 0, length: null },
  ]);
  assert.ok(r.ok);
  close(r.lengths[2], 4);
  close(r.lengths[3], 3);
  assert.deepEqual(r.solved, [2, 3]);
});

test('one missing wall is worked out', () => {
  const r = solveRoom([
    { heading: 90, length: 5 },
    { heading: 180, length: 2 },
    { heading: 270, length: 5 },
    { heading: 0, length: null },
  ]);
  assert.ok(r.ok);
  close(r.lengths[3], 2);
});

test('an L-shaped room comes out the right area', () => {
  // 6×4 with a 2×2 bite out of one corner = 20 m².
  const r = solveRoom([
    { heading: 90, length: 6 },
    { heading: 180, length: 2 },
    { heading: 270, length: 2 },
    { heading: 180, length: 2 },
    { heading: 270, length: 4 },
    { heading: 0, length: 4 },
  ]);
  assert.ok(r.ok);
  close(polygonArea(r.points), 20);
});

test('walking the other way round gives the same area', () => {
  const cw = solveRoom(rectangleWalls(4, 3));
  const ccw = solveRoom([
    { heading: 180, length: 3 },
    { heading: 90, length: 4 },
    { heading: 0, length: 3 },
    { heading: 270, length: 4 },
  ]);
  close(polygonArea(cw.points), polygonArea(ccw.points));
});

test('a loop that misses by a little is closed by adjusting lengths, not angles', () => {
  const r = solveRoom([
    { heading: 90, length: 4.0 },
    { heading: 180, length: 3.0 },
    { heading: 270, length: 4.06 },
    { heading: 0, length: 3.0 },
  ]);
  assert.ok(r.ok);
  close(r.error, 0.06, 1e-9);
  close(r.lengths[0], r.lengths[2]);
  assert.ok(r.lengths[0] > 4.0 && r.lengths[0] < 4.06);
  // Still a true rectangle: last corner lines up under the first.
  close(r.points[3].x, r.points[0].x);
});

test('more than two unmeasured walls is refused with a reason', () => {
  const r = solveRoom([
    { heading: 90, length: 4 },
    { heading: 180, length: null },
    { heading: 270, length: null },
    { heading: 0, length: null },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /only two/);
});

test('two parallel unmeasured walls cannot be worked out', () => {
  const r = solveRoom([
    { heading: 90, length: null },
    { heading: 180, length: 3 },
    { heading: 270, length: null },
    { heading: 0, length: 3 },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /parallel/);
});

test('directions that cannot close are refused instead of drawing nonsense', () => {
  const r = solveRoom([
    { heading: 90, length: 4 },
    { heading: 90, length: 3 },
    { heading: 90, length: null },
  ]);
  assert.equal(r.ok, false);
});

test('fewer than three walls is not a room', () => {
  assert.equal(solveRoom([{ heading: 90, length: 1 }, { heading: 270, length: 1 }]).ok, false);
});

test('square-up snaps nearly-right angles onto the room’s own grid', () => {
  const out = squareUp([17, 108, 196, 289]);
  assert.deepEqual(out.map((h) => Math.round(turnBetween(out[0], h))), [0, 90, 180, -90]);
});

test('square-up leaves a deliberate 45° wall alone', () => {
  const out = squareUp([90, 180, 225, 270, 0], 12);
  assert.ok(Math.abs(turnBetween(out[2], 225)) < 1, 'the diagonal wall must not be forced square');
});

test('centroid of a rectangle is its middle', () => {
  const c = centroid(solveRoom(rectangleWalls(4, 2)).points);
  close(c.x, 2);
  close(c.y, 1);
});

test('placing a room rotates then moves it', () => {
  const [p] = placePoints([{ x: 1, y: 0 }], { x: 10, y: 5, rotation: 90 });
  close(p.x, 10);
  close(p.y, 6);
});
