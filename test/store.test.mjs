import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const {
  listPlans, getPlan, createPlan, savePlan, deletePlan, newRoom, getSettings, saveSettings,
} = await import('../js/store.js');
const { rectangleWalls } = await import('../js/geometry.js');

test.beforeEach(() => mem.clear());

test('a new plan is saved and listed', () => {
  const p = createPlan('Flat');
  assert.equal(listPlans().length, 1);
  assert.equal(getPlan(p.id).name, 'Flat');
});

test('rooms survive a save and reload', () => {
  const p = createPlan('House');
  p.rooms.push(newRoom('Kitchen', rectangleWalls(3, 4)));
  savePlan(p);
  const back = getPlan(p.id);
  assert.equal(back.rooms.length, 1);
  assert.equal(back.rooms[0].walls.length, 4);
  assert.deepEqual(back.rooms[0].openings, []);
});

test('the most recently changed plan is listed first', async () => {
  const a = createPlan('A');
  await new Promise((r) => setTimeout(r, 5));
  createPlan('B');
  await new Promise((r) => setTimeout(r, 5));
  savePlan(a);
  assert.equal(listPlans()[0].name, 'A');
});

test('deleting removes only that plan', () => {
  const a = createPlan('A');
  createPlan('B');
  deletePlan(a.id);
  assert.deepEqual(listPlans().map((p) => p.name), ['B']);
});

test('corrupt storage reads as no plans rather than crashing', () => {
  mem.set('planscan.plans.v1', '{not json');
  assert.deepEqual(listPlans(), []);
});

test('the unit setting defaults to metric and persists', () => {
  assert.equal(getSettings().unit, 'metric');
  saveSettings({ unit: 'imperial' });
  assert.equal(getSettings().unit, 'imperial');
});
