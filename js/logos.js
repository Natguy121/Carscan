// Teaching the app what a badge looks like — same trick as memory.js, but the
// fingerprint is filed under a make instead of a specific car, from a close-up
// photo of just the badge rather than the whole car.
//
// Gated by a password so a stranger who finds this on the live site can't fill
// it with junk. Be clear about what that gate actually is: there's no server,
// so the password's hash lives in this browser's own localStorage, set the
// first time anyone opens the trainer here. It stops a casual tap-through; it
// does not stop someone who opens devtools. Training only ever affects this
// device — export it if you want to hand a trained set to someone else.

import { toUnit, pack, unpack, similarity } from './memory.js';

const KEY = 'carscan.logos.v1';
const AUTH_KEY = 'carscan.logos.auth.v1';
const MAX_SAMPLES = 300;

// Badge photos are close-ups of a small, visually similar object (a shiny
// badge against blurred metal), and they get compared against whatever a
// scan happens to be — often a photo of the whole car, not a badge at all.
// That's a much weaker signal than memory.js's whole-car-to-whole-car match,
// so a badge needs to be a clear stand-out, not just the nearest of a
// mediocre bunch, before it's trusted enough to auto-narrow the shortlist.
const MATCH_THRESHOLD = 0.93;
const MIN_MARGIN = 0.03;

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hasPassword() {
  return Boolean(localStorage.getItem(AUTH_KEY));
}

export async function setPassword(password) {
  if (!password || password.length < 4) throw new Error('Use at least 4 characters.');
  localStorage.setItem(AUTH_KEY, await sha256Hex(password));
}

export async function checkPassword(password) {
  const stored = localStorage.getItem(AUTH_KEY);
  return Boolean(stored) && stored === await sha256Hex(password || '');
}

export function clearPassword() {
  localStorage.removeItem(AUTH_KEY);
}

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{"samples":[]}');
    return Array.isArray(parsed.samples) ? parsed.samples : [];
  } catch {
    return [];
  }
}

function write(samples) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ samples }));
    return true;
  } catch {
    return false;
  }
}

function evict(samples) {
  const counts = new Map();
  for (const s of samples) counts.set(s.make, (counts.get(s.make) || 0) + 1);
  let fattest = null;
  let most = 0;
  for (const [make, n] of counts) if (n > most) { most = n; fattest = make; }
  const i = samples.findIndex((s) => s.make === fattest);
  if (i >= 0) samples.splice(i, 1);
  else samples.shift();
}

/** File this badge photo's fingerprint under the make the trainer chose. */
export function teachLogo(make, embedding) {
  if (!make || !embedding || !embedding.length) return false;
  const samples = read();
  samples.push({ make, v: pack(toUnit(embedding)) });
  while (samples.length > MAX_SAMPLES) evict(samples);
  return write(samples);
}

/**
 * The best-matching make for a badge photo, or null when nothing trained is
 * close enough. Only ever used to suggest a make in the badge picker — never
 * to select one outright, so a bad match costs a dismissed suggestion, not a
 * wrong catch.
 */
export function recallLogo(embedding, threshold = MATCH_THRESHOLD) {
  if (!embedding || !embedding.length) return null;
  const unit = toUnit(embedding);
  const byMake = new Map();

  for (const sample of read()) {
    let score;
    try {
      score = similarity(unit, unpack(sample.v));
    } catch {
      continue;
    }
    const scores = byMake.get(sample.make) || [];
    scores.push(score);
    byMake.set(sample.make, scores);
  }

  const ranked = [];
  for (const [make, scores] of byMake) {
    scores.sort((a, b) => b - a);
    const top = scores.slice(0, 2);
    const score = top.reduce((a, b) => a + b, 0) / top.length;
    ranked.push({ make, score });
  }
  ranked.sort((a, b) => b.score - a.score);

  const [best, runnerUp] = ranked;
  if (!best || best.score < threshold) return null;
  // A narrow win over the next-best make means it isn't really reading a
  // badge, just picking whichever trained make happens to be least
  // dissimilar — that's the "random" result, not a found logo.
  if (runnerUp && best.score - runnerUp.score < MIN_MARGIN) return null;
  return best;
}

export function logoStats() {
  const samples = read();
  const perMake = new Map();
  for (const s of samples) perMake.set(s.make, (perMake.get(s.make) || 0) + 1);
  return { samples: samples.length, makes: perMake.size, perMake };
}

export function forgetLogos() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* the trained set is a nicety, not the save file */
  }
}

export function exportLogos() {
  return JSON.stringify({ samples: read() }, null, 0);
}

const SEED_URL = './data/logos.seed.json';
const SEED_FLAG = 'carscan.logos.seed-loaded.v1';

/**
 * Load the badges shipped with the app itself — data/logos.seed.json, built by
 * exporting a trained set from this same trainer and committing it to the
 * repo, so every player starts with those badges known rather than each
 * device training from nothing. Same-origin static file, not a CDN, so it
 * works wherever the app is hosted with no extra network dependency.
 *
 * Runs once per device: a flag in localStorage remembers it happened, so
 * re-loading the app doesn't keep re-importing the same samples, and it never
 * touches anything a player has taught themselves.
 */
export async function loadSeedLogos() {
  if (localStorage.getItem(SEED_FLAG)) return 0;
  let added = 0;
  try {
    const res = await fetch(SEED_URL);
    if (res.ok) added = importLogos(await res.text());
  } catch {
    /* no seed file yet, or offline on first load — nothing to import */
  }
  localStorage.setItem(SEED_FLAG, '1');
  return added;
}

/** Merge in previously exported samples rather than replacing what's here. */
export function importLogos(json) {
  const parsed = JSON.parse(json);
  const incoming = Array.isArray(parsed.samples) ? parsed.samples : [];
  const valid = incoming.filter((s) => s && s.make && s.v);
  const samples = read().concat(valid);
  while (samples.length > MAX_SAMPLES) evict(samples);
  return write(samples) ? valid.length : 0;
}
