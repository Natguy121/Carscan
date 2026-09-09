// Save file: what you have caught, your photos of it, XP and achievements.

import { CARS, CARS_BY_ID, RARITY, BODIES } from './cars.js';

const SAVE_KEY = 'carscan.save.v1';

const EMPTY = { xp: 0, scans: 0, entries: {}, achievements: [], created: null };

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...EMPTY, entries: {}, achievements: [], created: Date.now() };
    const parsed = JSON.parse(raw);
    return {
      xp: parsed.xp || 0,
      scans: parsed.scans || 0,
      // Older saves could hold hand-typed entries; the index is the index now.
      entries: Object.fromEntries(
        Object.entries(parsed.entries || {}).filter(([id]) => CARS_BY_ID.has(id)),
      ),
      achievements: parsed.achievements || [],
      created: parsed.created || Date.now(),
    };
  } catch {
    return { ...EMPTY, entries: {}, achievements: [], created: Date.now() };
  }
}

/**
 * Persist, shedding photos oldest-first if the browser quota is hit. Photos are
 * the only large thing in the save, so progress always survives a full store.
 */
function save() {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      if (!evictOldestPhoto()) {
        console.warn('carscan: could not save progress', err);
        return false;
      }
    }
  }
  return false;
}

function evictOldestPhoto() {
  const withPhotos = Object.values(state.entries).filter((e) => e.photos?.length);
  if (!withPhotos.length) return false;
  withPhotos.sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0));
  withPhotos[0].photos.pop();
  return true;
}

export function getState() {
  return state;
}

export function entryFor(carId) {
  return state.entries[carId] || null;
}

export function isDiscovered(carId) {
  return Boolean(state.entries[carId]);
}

/** Every car you have caught. */
export function knownIds() {
  return Object.keys(state.entries);
}

export function discoveredCount() {
  return knownIds().length;
}

/** What the player has caught, for weighting the shortlist toward likely cars. */
export function catchHistory() {
  const caughtIds = new Set(knownIds());
  const makeCounts = new Map();
  for (const id of caughtIds) {
    const make = CARS_BY_ID.get(id)?.make;
    if (make) makeCounts.set(make, (makeCounts.get(make) || 0) + 1);
  }
  return { caughtIds, makeCounts };
}

export function completion() {
  return discoveredCount() / CARS.length;
}

// ------------------------------------------------------------------- levels

/** Cumulative XP needed to reach a level. Growth is deliberately gentle early. */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(70 * Math.pow(level - 1, 1.65));
}

export function levelInfo(xp = state.xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1) && level < 99) level++;
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  return {
    level,
    into: xp - floor,
    needed: ceiling - floor,
    progress: (xp - floor) / (ceiling - floor),
  };
}

// -------------------------------------------------------------- recording

/**
 * Log a confirmed catch.
 * @returns {{isNew:boolean, xp:number, breakdown:{label:string,value:number}[], levelUp:number|null, unlocked:object[]}}
 */
export function recordCatch(carId, { photo = null, color = null } = {}) {
  const car = CARS_BY_ID.get(carId);
  if (!car) throw new Error(`unknown car ${carId}`);

  const before = levelInfo().level;
  const existing = state.entries[carId];
  const isNew = !existing;
  const tier = RARITY[car.rarity];
  const base = tier.xp;
  const breakdown = [];

  let gained;
  if (isNew) {
    gained = base * 3;
    breakdown.push({ label: `New ${tier.label} discovery`, value: gained });
  } else {
    gained = Math.round(base * 0.25);
    breakdown.push({ label: 'Repeat sighting', value: gained });
  }

  const now = Date.now();
  const entry = existing || { count: 0, firstSeen: now, photos: [], colors: [] };
  entry.count += 1;
  entry.lastSeen = now;
  if (color && !entry.colors.includes(color)) entry.colors.push(color);
  // The first photo you took of a car is the one the Cardex keeps.
  if (photo && !entry.photos.length) entry.photos = [photo];
  state.entries[carId] = entry;

  state.xp += gained;
  state.scans += 1;

  const unlocked = checkAchievements();
  save();

  const after = levelInfo().level;
  return { isNew, xp: gained, breakdown, levelUp: after > before ? after : null, unlocked, entry };
}

export function resetProgress() {
  state = { ...EMPTY, entries: {}, achievements: [], created: Date.now() };
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clear */
  }
}

// ---------------------------------------------------------------- achievements

export const ACHIEVEMENTS = [
  { id: 'ignition', name: 'Ignition', hint: 'Log your first car', test: () => discoveredCount() >= 1 },
  { id: 'spotter', name: 'Spotter', hint: 'Log 5 different cars', test: () => discoveredCount() >= 5 },
  { id: 'collector', name: 'Collector', hint: 'Log 25 different cars', test: () => discoveredCount() >= 25 },
  { id: 'curator', name: 'Curator', hint: 'Log 50 different cars', test: () => discoveredCount() >= 50 },
  {
    id: 'unicorn',
    name: 'Unicorn',
    hint: 'Catch a Legendary',
    test: () => knownIds().some((id) => CARS_BY_ID.get(id).rarity === 'legendary'),
  },
  {
    id: 'spectrum',
    name: 'Full Spectrum',
    hint: 'Catch one car of every rarity',
    test: () => {
      const seen = new Set(knownIds().map((id) => CARS_BY_ID.get(id).rarity));
      return Object.keys(RARITY).every((r) => seen.has(r));
    },
  },
  {
    id: 'bodywork',
    name: 'Body of Work',
    hint: 'Catch every body style',
    test: () => {
      const seen = new Set(knownIds().map((id) => CARS_BY_ID.get(id).body));
      return Object.keys(BODIES).every((b) => seen.has(b));
    },
  },
  {
    id: 'rising-sun',
    name: 'Rising Sun',
    hint: 'Catch 5 Japanese cars',
    test: () => knownIds().filter((id) => CARS_BY_ID.get(id).country === 'Japan').length >= 5,
  },
  {
    id: 'grand-tour',
    name: 'Grand Tour',
    hint: 'Catch cars from 6 countries',
    test: () => new Set(knownIds().map((id) => CARS_BY_ID.get(id).country)).size >= 6,
  },
  { id: 'odometer', name: 'Odometer', hint: 'Complete 100 scans', test: (s) => s.scans >= 100 },
  {
    id: 'cardex-complete',
    name: 'Cardex Complete',
    hint: 'Catch every car in the index',
    test: () => discoveredCount() >= CARS.length,
  },
];

function checkAchievements() {
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id)) continue;
    if (a.test(state)) {
      state.achievements.push(a.id);
      unlocked.push(a);
    }
  }
  return unlocked;
}

export function hasAchievement(id) {
  return state.achievements.includes(id);
}
