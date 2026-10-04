// Saved plans live in this browser's local storage — no account, no server.
//
// A plan is one floor: a set of rooms, each a loop of walls plus its doors
// and windows, placed somewhere on the floor and turned to line up with its
// neighbours.

const KEY = 'planscan.plans.v1';
const SETTINGS_KEY = 'planscan.settings.v1';

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{"plans":[]}');
    return Array.isArray(parsed.plans) ? parsed.plans : [];
  } catch {
    return [];
  }
}

function writeAll(plans) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ plans }));
    return true;
  } catch {
    return false;
  }
}

/** Most recently changed first. */
export function listPlans() {
  return readAll().sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function getPlan(id) {
  return readAll().find((p) => p.id === id) || null;
}

export function createPlan(name = 'My floor plan') {
  const now = Date.now();
  const plan = { id: newId(), name, created: now, updated: now, rooms: [] };
  savePlan(plan);
  return plan;
}

export function savePlan(plan) {
  const plans = readAll();
  const i = plans.findIndex((p) => p.id === plan.id);
  const stamped = { ...plan, updated: Date.now() };
  if (i >= 0) plans[i] = stamped;
  else plans.push(stamped);
  return writeAll(plans);
}

export function deletePlan(id) {
  return writeAll(readAll().filter((p) => p.id !== id));
}

export function newRoom(name, walls = []) {
  return { id: newId(), name, walls, openings: [], height: null, x: 0, y: 0, rotation: 0 };
}

export function getSettings() {
  try {
    return { unit: 'metric', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { unit: 'metric' };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* a lost unit preference isn't worth bothering anyone about */
  }
}
