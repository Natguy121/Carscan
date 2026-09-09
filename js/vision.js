// Identification via Google Cloud Vision WEB_DETECTION — the same reverse-image
// machinery behind Lens-style "best guess" labels. One photo, one request.

const KEY_STORAGE = 'carscan.googleKey';
const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

export function hasApiKey() {
  return getApiKey().length > 0;
}

/** Words that describe a photo but never identify a specific car. */
const NOISE = new Set([
  'car', 'cars', 'auto', 'autos', 'automobile', 'automotive', 'vehicle', 'vehicles',
  'motor', 'motors', 'wheel', 'wheels', 'tire', 'tires', 'alloy', 'rim', 'rims',
  'bumper', 'grille', 'headlamp', 'headlight', 'taillight', 'windshield', 'hood',
  'door', 'mirror', 'spoiler', 'hubcap', 'personal', 'luxury', 'compact', 'mid',
  'coupe', 'saloon', 'estate',
  'size', 'full', 'family', 'sports', 'sport', 'performance', 'supercar',
  'hypercar', 'muscle', 'exotic', 'classic', 'vintage', 'antique', 'concept',
  'sedan', 'coupe', 'convertible', 'hatchback', 'wagon', 'estate', 'suv',
  'crossover', 'pickup', 'truck', 'van', 'minivan', 'roadster', 'cabriolet',
  'photo', 'photograph', 'image', 'stock', 'wallpaper', 'hd', 'png', 'jpg',
  'design', 'rental', 'dealership', 'dealer', 'sale', 'price', 'used',
  'new', 'review', 'test', 'drive', 'the', 'and', 'for', 'with', 'of', 'a', 'in',
  'edition', 'trim', 'series', 'generation', 'gen', 'model', 'facelift',
  'black', 'white', 'silver', 'grey', 'gray', 'red', 'blue', 'green', 'yellow',
  'orange', 'brown', 'beige', 'gold', 'purple',
]);

/** Normalise a label into comparable tokens, dropping years and filler words. */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !NOISE.has(t))
    .filter((t) => !/^(19|20)\d{2}$/.test(t))
    // A lone letter ("R" from GT-R, "S" from Turbo S) carries no signal on its
    // own; the bigram pass below recovers it as part of "gtr"/"turbos".
    .filter((t) => !/^[a-z]$/.test(t));
}

/** Tokens plus concatenated adjacent pairs, so "gt r" also yields "gtr". */
export function tokenKeys(text) {
  const toks = tokenize(text);
  const keys = [...toks];
  for (let i = 0; i < toks.length - 1; i++) keys.push(toks[i] + toks[i + 1]);
  return keys;
}

/** Model year mentioned anywhere in the returned labels, if any. */
function extractYear(text) {
  const m = String(text || '').match(/\b(19[3-9]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Run WEB_DETECTION on the captured photo.
 * @param {string} base64 JPEG bytes, no data: prefix.
 * @returns {Promise<{bestGuess: string|null, entities: {name:string,score:number}[], pages: string[], year: number|null}>}
 */
export async function detectCar(base64, { signal } = {}) {
  const key = getApiKey();
  if (!key) throw new VisionError('no-key', 'No Google Cloud Vision API key set.');

  let res;
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: 'WEB_DETECTION', maxResults: 25 }],
          },
        ],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new VisionError('network', 'Could not reach Google Vision. Check your connection.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400) throw new VisionError('bad-key', `Google rejected the request: ${reason}`);
    if (res.status === 403) {
      throw new VisionError(
        'forbidden',
        'Google returned 403. Enable the Cloud Vision API for your project, and check any referrer restrictions on the key.',
      );
    }
    if (res.status === 429) throw new VisionError('quota', 'Google Vision quota exceeded for this key.');
    throw new VisionError('api', reason);
  }

  const payload = await res.json();
  const apiError = payload?.responses?.[0]?.error;
  if (apiError) throw new VisionError('api', apiError.message || 'Vision API error');

  const web = payload?.responses?.[0]?.webDetection || {};
  const bestGuess = web.bestGuessLabels?.[0]?.label || null;
  const entities = (web.webEntities || [])
    .filter((e) => e.description && e.score > 0)
    .map((e) => ({ name: e.description, score: e.score }));
  const pages = (web.pagesWithMatchingImages || [])
    .map((p) => p.pageTitle)
    .filter(Boolean)
    .slice(0, 8);

  const year =
    extractYear(bestGuess) ??
    entities.map((e) => extractYear(e.name)).find((y) => y != null) ??
    pages.map((p) => extractYear(p)).find((y) => y != null) ??
    null;

  return { bestGuess, entities, pages, year };
}

export class VisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VisionError';
    this.code = code;
  }
}

/**
 * Turn one Vision response into a ranked view of what the car is.
 *
 * A response carries Google's single best-guess label plus a spread of web
 * entities; both are folded into phrase and token tallies the matcher scores
 * against. The best guess is Google's own answer, so it carries the most weight,
 * and entity weights decay by rank.
 */
export function analyseDetection(result) {
  if (!result) return { phrases: [], tokens: new Map(), year: null };

  const phrases = new Map(); // normalised phrase -> aggregate
  const tokens = new Map(); // token (and adjacent-pair) -> aggregate weight

  const addTokens = (text, weight) => {
    for (const t of tokenKeys(text)) {
      const cur = tokens.get(t) || { token: t, weight: 0 };
      cur.weight += weight;
      tokens.set(t, cur);
    }
  };

  const addPhrase = (text, weight) => {
    const key = tokenize(text).join(' ');
    if (!key) return;
    const cur = phrases.get(key) || { key, display: text, weight: 0 };
    cur.weight += weight;
    phrases.set(key, cur);
  };

  if (result.bestGuess) {
    addPhrase(result.bestGuess, 3.0);
    addTokens(result.bestGuess, 3.0);
  }

  result.entities.forEach((entity, rank) => {
    // Entity scores are unbounded and rank-ordered; damp by position.
    const w = Math.min(entity.score, 2.5) * (1 / (1 + rank * 0.25));
    addPhrase(entity.name, w);
    addTokens(entity.name, w);
  });

  const rank = (map) =>
    [...map.values()].map((v) => ({ ...v, score: v.weight })).sort((a, b) => b.score - a.score);

  return {
    phrases: rank(phrases),
    tokens: new Map(rank(tokens).map((t) => [t.token, t])),
    year: result.year ?? null,
  };
}
