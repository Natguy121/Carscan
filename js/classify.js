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
];

/** Any ImageNet class that means "this photo has a road vehicle in it". */
const VEHICLE_HINTS = [
  'car wheel', 'grille', 'disk brake', 'car mirror', 'convertible', 'jeep',
  'limousine', 'minivan', 'model t', 'racer', 'sports car', 'pickup',
  'beach wagon', 'station wagon', 'cab, hack, taxi', 'trailer truck',
  'tow truck', 'garbage truck', 'fire engine', 'moving van', 'police van',
  'recreational vehicle', 'amphibian', 'snowplow', 'streetcar', 'school bus',
  'half track', 'go-kart', 'golfcart',
];

/** Whether the photo plausibly contains a car at all, not e.g. a dog. */
export function looksLikeVehicle(predictions, threshold = 0.15) {
  return predictions.some(
    (p) => p.probability >= threshold && VEHICLE_HINTS.some((hint) => p.className.toLowerCase().includes(hint)),
  );
}

/** Best-guess body style from the predictions, or null if none maps cleanly. */
export function inferBodyFromPredictions(predictions) {
  for (const p of predictions) {
    const name = p.className.toLowerCase();
    for (const [keyword, body] of BODY_KEYWORDS) {
      if (name.includes(keyword)) return body;
    }
  }
  return null;
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
