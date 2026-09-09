// On-device car recognition — TensorFlow.js + MobileNet, running entirely in
// the browser. No account, no API key, no cost, no server.
//
// MobileNet only knows the 1,000 general ImageNet categories, so it can spot
// "pickup truck" or "sports car" and never an exact make and model. That is
// the honest limit of a free, local model — the player confirms the exact
// car from a shortlist instead of the app claiming a certainty it doesn't have.

const TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
const MOBILENET_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';

export class ClassifyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClassifyError';
    this.code = code;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

let modelPromise = null;

function ensureModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        await loadScript(TFJS_URL);
        await loadScript(MOBILENET_URL);
      } catch {
        throw new ClassifyError('load-failed', 'Could not load the recognition model. Check your connection and try again.');
      }
      try {
        return await window.mobilenet.load({ version: 2, alpha: 1.0 });
      } catch {
        throw new ClassifyError('model-failed', 'The recognition model failed to start.');
      }
    })().catch((err) => {
      modelPromise = null; // let a retry try loading again instead of replaying the same failure forever
      throw err;
    });
  }
  return modelPromise;
}

/** Start loading the model without waiting on it, so the first real scan is faster. */
export function warmUp() {
  ensureModel().catch(() => {});
}

/**
 * Classify an already-drawn <img>, <canvas> or <video>.
 * @returns {Promise<{className:string, probability:number}[]>}
 */
export async function classifyImage(el) {
  const model = await ensureModel();
  return model.classify(el, 8);
}

/**
 * The photo's fingerprint — the model's second-to-last layer rather than its
 * 1,000 category guesses. Two photos of the same car land close together here
 * even though the model cannot name either of them, which is what lets the app
 * learn a car from you confirming it once.
 *
 * Returns null rather than throwing: recognition still works without it, so a
 * model build that can't produce embeddings should cost the memory, not the scan.
 */
export async function embedImage(el) {
  try {
    const model = await ensureModel();
    if (typeof model.infer !== 'function') return null;
    const tensor = model.infer(el, true);
    const values = await tensor.data();
    tensor.dispose();
    return values;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- mapping
//
// ImageNet's vehicle-shaped classes, mapped to this app's body styles. Listed
// most-specific first so, e.g., "minivan" is checked before the generic "van"
// words that would otherwise also match a school bus.

const BODY_KEYWORDS = [
  ['minivan', 'minivan'],
  ['moving van', 'van'],
  ['police van', 'van'],
  ['garbage truck', 'van'],
  ['fire engine', 'van'],
  ['school bus', 'van'],
  ['minibus', 'van'],
  ['trolleybus', 'van'],
  ['ambulance', 'van'],
  ['recreational vehicle', 'van'],
  ['tow truck', 'pickup'],
  ['pickup', 'pickup'],
  ['beach wagon', 'wagon'],
  ['station wagon', 'wagon'],
  ['jeep', 'suv'],
  ['landrover', 'suv'],
  ['convertible', 'convertible'],
  ['limousine', 'sedan'],
  ['cab, hack, taxi', 'sedan'],
  ['model t', 'sedan'],
  ['sports car', 'coupe'],
  ['racer, race car', 'coupe'],
  ['go-kart', 'coupe'],
];

/** Any ImageNet class that means "this photo has a road vehicle in it". */
const VEHICLE_HINTS = [
  'car wheel', 'grille', 'disk brake', 'car mirror', 'convertible', 'jeep',
  'limousine', 'minivan', 'model t', 'racer', 'sports car', 'pickup',
  'beach wagon', 'station wagon', 'cab, hack, taxi', 'trailer truck',
  'tow truck', 'garbage truck', 'fire engine', 'moving van', 'police van',
  'recreational vehicle', 'amphibian', 'snowplow', 'streetcar', 'school bus',
  'half track', 'go-kart', 'golfcart', 'ambulance', 'minibus', 'trolleybus',
  'seat belt', 'bumper', 'hubcap', 'sunroof',
];

/**
 * Whether the photo has a car in it at all, not e.g. a dog.
 *
 * Every vehicle class contributes, so a car seen as a bit of grille, a bit of
 * wheel and a bit of bumper still counts. That spread is what a real photo of a
 * car in traffic actually looks like, and demanding a single confident class
 * turned too many of them away.
 */
export function looksLikeVehicle(predictions, threshold = 0.12) {
  let mass = 0;
  for (const p of predictions) {
    const name = p.className.toLowerCase();
    if (VEHICLE_HINTS.some((hint) => name.includes(hint))) mass += p.probability;
  }
  return mass >= threshold;
}

/**
 * Body style the predictions point to, weighted by confidence.
 *
 * MobileNet returns several vehicle classes at once — "sports car" and
 * "convertible" and "beach wagon" all at some probability. Taking whichever
 * matched first threw that away; adding each class's probability to its body
 * style and picking the heaviest uses all of it, so two weak agreeing guesses
 * can outweigh one slightly stronger disagreeing one.
 *
 * @returns {{body: string|null, confidence: number}} confidence is the winner's
 *   share of all vehicle probability seen, 0–1.
 */
export function inferBody(predictions) {
  const scores = new Map();
  let total = 0;
  for (const p of predictions) {
    const name = p.className.toLowerCase();
    for (const [keyword, body] of BODY_KEYWORDS) {
      if (name.includes(keyword)) {
        scores.set(body, (scores.get(body) || 0) + p.probability);
        total += p.probability;
        break; // most specific keyword only — "minivan" must not also count as "van"
      }
    }
  }
  if (!scores.size) return { body: null, confidence: 0 };
  const [body, score] = [...scores].sort((a, b) => b[1] - a[1])[0];
  return { body, confidence: total ? score / total : 0 };
}

/** Body style only, for callers that do not need the confidence. */
export function inferBodyFromPredictions(predictions) {
  return inferBody(predictions).body;
}

/** A short, human label for the top prediction — descriptive only, never a car name. */
export function topLabel(predictions) {
  const p = predictions[0];
  if (!p) return null;
  return p.className
    .split(',')[0]
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
