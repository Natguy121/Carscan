// The part of the app that actually learns.
//
// MobileNet's second-to-last layer turns a photo into ~1,280 numbers — a
// fingerprint where two photos of the same car land close together, even though
// the model has no idea what a Fortuner is. Confirm a car and its fingerprint is
// filed under that car's id. Scan something similar later and the nearest stored
// fingerprint is recognised on the spot.
//
// It learns only from you, on your device, from cars you actually scan — no
// dataset to download, no training run, no server.

const KEY = 'carscan.memory.v1';

// ~1.3 KB per sample once quantised, so this sits comfortably inside the
// localStorage budget alongside saved photos.
const MAX_SAMPLES = 240;

// Cosine similarity between two unit vectors. Same car from a similar angle
// lands around 0.85–0.95; unrelated cars sit well below 0.7.
const MATCH_THRESHOLD = 0.82;

/** Scale a vector to length 1 so cosine similarity is just a dot product. */
export function toUnit(values) {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!norm) return new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / norm;
  return out;
}

export function similarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// Fingerprints are stored as one byte per number. Cosine similarity is robust
// to that much rounding, and it keeps a full memory under a third of a megabyte.
export function pack(unit) {
  const bytes = new Uint8Array(unit.length);
  for (let i = 0; i < unit.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round((unit[i] + 1) * 127.5)));
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function unpack(text) {
  const binary = atob(text);
  const out = new Float32Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) / 127.5 - 1;
  return out;
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

/**
 * Drop the oldest sample of whichever car has the most, so a car you scan on
 * every walk can't crowd out the one you have seen once.
 */
function evict(samples) {
  const counts = new Map();
  for (const s of samples) counts.set(s.carId, (counts.get(s.carId) || 0) + 1);
  let fattest = null;
  let most = 0;
  for (const [carId, n] of counts) {
    if (n > most) { most = n; fattest = carId; }
  }
  const index = samples.findIndex((s) => s.carId === fattest);
  if (index >= 0) samples.splice(index, 1);
  else samples.shift();
}

/** File this photo's fingerprint under the car the player confirmed. */
export function remember(carId, embedding) {
  if (!carId || !embedding || !embedding.length) return false;
  const samples = read();
  samples.push({ carId, v: pack(toUnit(embedding)) });
  while (samples.length > MAX_SAMPLES) evict(samples);
  return write(samples);
}

/**
 * The best match for a photo, or null when nothing stored is close enough.
 * Averaging a car's two best samples rewards a car seen from several angles
 * without letting one lucky near-duplicate decide it.
 */
export function recall(embedding, threshold = MATCH_THRESHOLD) {
  if (!embedding || !embedding.length) return null;
  const unit = toUnit(embedding);
  const byCar = new Map();

  for (const sample of read()) {
    let score;
    try {
      score = similarity(unit, unpack(sample.v));
    } catch {
      continue;
    }
    const scores = byCar.get(sample.carId) || [];
    scores.push(score);
    byCar.set(sample.carId, scores);
  }

  let best = null;
  for (const [carId, scores] of byCar) {
    scores.sort((a, b) => b - a);
    const top = scores.slice(0, 2);
    const score = top.reduce((a, b) => a + b, 0) / top.length;
    if (!best || score > best.score) best = { carId, score, samples: scores.length };
  }

  return best && best.score >= threshold ? best : null;
}

export function memoryStats() {
  const samples = read();
  return { samples: samples.length, cars: new Set(samples.map((s) => s.carId)).size };
}

export function forgetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing worth reporting — the memory is a nicety, not the save file */
  }
}
