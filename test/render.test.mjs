import test from 'node:test';
import assert from 'node:assert/strict';
import { planSvg, roomShape, scanPreviewSvg, esc } from '../js/render.js';
import { rectangleWalls } from '../js/geometry.js';

const room = (over = {}) => ({
  id: 'r1', name: 'Kitchen', walls: rectangleWalls(4, 3), openings: [], x: 0, y: 0, rotation: 0, ...over,
});

test('a room’s shape reports its area and perimeter', () => {
  const s = roomShape(room());
  assert.ok(s.ok);
  assert.ok(Math.abs(s.area - 12) < 1e-6);
  assert.ok(Math.abs(s.perimeter - 14) < 1e-6);
});

test('the plan labels every wall and the room', () => {
  const svg = planSvg({ rooms: [room()] }, { unit: 'metric' });
  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/4\.00 m/g) || []).length, 2);
  assert.equal((svg.match(/3\.00 m/g) || []).length, 2);
  assert.match(svg, /Kitchen/);
  assert.match(svg, /12\.0 m²/);
});

test('worked-out walls are marked as approximate', () => {
  const walls = rectangleWalls(4, 3);
  walls[2].length = null;
  walls[3].length = null;
  const svg = planSvg({ rooms: [room({ walls })] });
  assert.equal((svg.match(/≈ /g) || []).length, 2);
});

test('interactive plans carry a tap target per wall', () => {
  const svg = planSvg({ rooms: [room()] }, { interactive: true });
  assert.equal((svg.match(/class="wall-hit"/g) || []).length, 4);
});

test('a thumbnail has no labels', () => {
  const svg = planSvg({ rooms: [room()] }, { thumb: true });
  assert.doesNotMatch(svg, /Kitchen/);
});

test('doors and windows are drawn', () => {
  const svg = planSvg({ rooms: [room({ openings: [
    { type: 'door', wall: 0, offset: 1, width: 0.8 },
    { type: 'window', wall: 1, offset: 1, width: 1.2 },
  ] })] });
  assert.match(svg, /<path d="M [^"]+ A /, 'a door swing arc');
});

test('a room that cannot close is shown as broken, not dropped', () => {
  const walls = rectangleWalls(4, 3).map((w) => ({ ...w, length: null }));
  const svg = planSvg({ rooms: [room({ walls })] });
  assert.match(svg, /only two/);
});

test('room names are escaped', () => {
  const svg = planSvg({ rooms: [room({ name: '<b>&' })] });
  assert.match(svg, /&lt;b&gt;&amp;/);
  assert.equal(esc(`"'`), '&quot;&#39;');
});

test('the scan preview draws captured walls and a live direction', () => {
  const svg = scanPreviewSvg([{ heading: 90, length: 3 }, { heading: 180, length: null }], 270);
  assert.match(svg, /3\.00 m/);
  assert.match(svg, /wall 2/);
});
