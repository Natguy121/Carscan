// Resolve fused Google Vision detections onto a car in the spec database.
// Google says "porsche 911 carrera"; the Cardex needs an entry with specs.

import { CARS, displayName } from './cars.js';
import { tokenize, tokenKeys } from './vision.js';

// Names people (and the web) use that make+model alone will not produce.
const ALIASES = {
  'mazda-mx5': ['miata', 'mx5', 'roadster'],
  'corvette-c8': ['vette', 'stingray', 'c8'],
  'corvette-z06-c8': ['vette', 'z06', 'c8'],
  'vw-beetle-classic': ['beetle', 'bug', 'kafer', 'kaefer', 'vocho'],
  'vw-bus-t2': ['bus', 'kombi', 'microbus', 'transporter', 'type2', 'westfalia'],
  'nissan-gtr-r35': ['gtr', 'godzilla', 'r35'],
  'nissan-skyline-r34': ['gtr', 'skyline', 'r34', 'bnr34'],
  'toyota-ae86': ['ae86', 'hachiroku', 'trueno', 'levin', 'sprinter'],
  'mazda-rx7-fd': ['rx7', 'fd', 'fd3s', 'rotary'],
  'honda-nsx-na1': ['nsx', 'acura'],
  'toyota-supra-a90': ['supra', 'a90', 'mk5'],
  'honda-civic-type-r': ['typer', 'fl5', 'ctr'],
  'ford-f150': ['f150'],
  'honda-crv': ['crv'],
  'amg-c63': ['amg', 'c63', 'w205'],
  'bmw-m3': ['m3', 'g80'],
  'audi-rs6-avant': ['rs6', 'avant'],
  'audi-rs5': ['rs5'],
  'audi-r8-v10': ['r8'],
  'dodge-hellcat': ['hellcat', 'srt'],
  'tesla-model-3': ['model3'],
  'tesla-model-s-plaid': ['models', 'plaid'],
  'porsche-911-carrera': ['911', 'carrera', '992'],
  'porsche-911-turbo-s': ['911', 'turbo', '992'],
  'porsche-718-cayman': ['cayman', '718', 'boxster'],
  'porsche-918': ['918', 'spyder'],
  'ferrari-488-gtb': ['488', 'gtb'],
  'ferrari-laferrari': ['laferrari', 'theferrari'],
  'lamborghini-huracan': ['huracan', 'lambo'],
  'lamborghini-countach': ['countach', 'lambo', 'lp400'],
  'mclaren-720s': ['720s'],
  'mclaren-p1': ['p1'],
  'bugatti-chiron': ['chiron'],
  'koenigsegg-jesko': ['jesko', 'absolut'],
  'pagani-huayra': ['huayra'],
  'ford-gt-2017': ['fordgt'],
  'dodge-viper-acr': ['viper', 'acr'],
  'jaguar-ftype-r': ['ftype', 'jag'],
  'range-rover': ['rangerover', 'rangie'],
  'mini-cooper-s': ['mini', 'cooper'],
  'vw-golf-gti': ['gti', 'mk8'],
  'subaru-wrx': ['wrx', 'sti', 'rex'],
  'toyota-gr86': ['gr86', 'brz', '86', 'frs'],
  'chevy-silverado': ['silverado'],
  'mercedes-c300': ['cclass', 'c300'],
  'bmw-330i': ['3series', '330i', 'g20'],
  'aston-db11-v12': ['db11', 'aston'],
  'bentley-continental-gt': ['continental', 'conti'],
  'rolls-royce-ghost': ['rolls', 'royce', 'ghost'],
};

const keySet = (text) => new Set(tokenKeys(text));

const MAKE_WEIGHT = 0.7;

function parseYears(years) {
  const nums = String(years).match(/\d{4}/g);
  if (!nums) return null;
  return { from: Number(nums[0]), to: Number(nums[1] ?? nums[0]) };
}

// Precomputed per-car search profile and token rarity across the database.
const PROFILES = CARS.map((car) => {
  const makeKeys = keySet(car.make);
  const modelKeys = keySet(car.model.replace(/\(.*?\)/g, ' '));
  const codeKeys = keySet((car.model.match(/\((.*?)\)/) || [, ''])[1]);
  const aliasKeys = new Set(ALIASES[car.id] || []);
  return {
    car,
    makeKeys,
    modelKeys,
    codeKeys,
    aliasKeys,
    all: new Set([...makeKeys, ...modelKeys, ...codeKeys, ...aliasKeys]),
    keyWeights: bestWeights(makeKeys, [
      [modelKeys, 2.2],
      [codeKeys, 2.0],
      [aliasKeys, 2.0],
    ]),
    canonical: tokenize(`${car.make} ${car.model.replace(/\(.*?\)/g, ' ')}`).join(' '),
    years: parseYears(car.years),
  };
});

/**
 * One weight per key, so nothing is counted twice.
 *
 * The make scores lightly — every Land Rover shares it, so it places the car in
 * a family rather than picking one out — and it wins over any other role the
 * same word plays. Otherwise "Rover" would count as a model word for the Range
 * Rover and beat a Defender on the Defender's own name.
 */
function bestWeights(makeKeys, groups) {
  const weights = new Map();
  for (const [keys, weight] of groups) {
    for (const k of keys) weights.set(k, Math.max(weights.get(k) || 0, weight));
  }
  for (const k of makeKeys) weights.set(k, MAKE_WEIGHT);
  return weights;
}

const DF = new Map();
PROFILES.forEach((p) => p.all.forEach((k) => DF.set(k, (DF.get(k) || 0) + 1)));

/** Rare keys identify a car; keys shared by many cars barely narrow anything. */
function idf(key) {
  const df = DF.get(key) || 0;
  return Math.log(PROFILES.length / (1 + df)) + 0.25;
}

function weightOf(fused, key) {
  const t = fused.tokens.get(key);
  return t ? Math.min(t.score, 8) : 0;
}

/**
 * Rank database cars against fused detections.
 * @returns {{car:object, score:number, confidence:number, hits:string[]}[]}
 */
export function rankCandidates(fused) {
  if (!fused || !fused.phrases.length) return [];

  const phraseKeys = fused.phrases
    .slice(0, 12)
    .map((p) => ({ keys: keySet(p.display), score: p.score, key: p.key }));

  const scored = PROFILES.map((p) => {
    let score = 0;
    const hits = [];

    const makeHit = [...p.makeKeys].some((k) => weightOf(fused, k) > 0);
    for (const [k, multiplier] of p.keyWeights) {
      const w = weightOf(fused, k);
      if (w > 0) {
        score += w * idf(k) * multiplier;
        hits.push(k);
      }
    }

    // A single phrase carrying both the make and a model word is the strongest
    // evidence available — "porsche 911" beats "porsche" and "911" apart.
    for (const ph of phraseKeys) {
      const hasMake = [...p.makeKeys].some((k) => ph.keys.has(k));
      const hasModel = [...p.modelKeys, ...p.codeKeys, ...p.aliasKeys].some((k) => ph.keys.has(k));
      if (hasMake && hasModel) score += ph.score * 3.5;
      else if (hasModel) score += ph.score * 1.2;

      // A phrase equal to the car's whole name is the clearest evidence there
      // is: it separates "Toyota Corolla" from the Corolla AE86 Trueno, which
      // any token-overlap score alone rates identically.
      if (ph.key && ph.key === p.canonical) score += ph.score * 6;
    }

    if (!makeHit) score *= 0.45;

    if (fused.year && p.years) {
      const { from, to } = p.years;
      if (fused.year >= from && fused.year <= to) score *= 1.25;
      else if (fused.year < from - 3 || fused.year > to + 3) score *= 0.8;
    }

    return { car: p.car, score, hits: [...new Set(hits)] };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  const top = scored[0].score;
  return scored.slice(0, 6).map((r) => ({ ...r, confidence: Math.min(1, r.score / top) }));
}

/**
 * Turn ranked candidates into a verdict the UI can act on.
 * `identified` means one car clearly won; otherwise the player disambiguates.
 */
export function resolve(fused, candidates) {
  const label = fused.phrases[0]?.display || null;

  if (!candidates.length) {
    return { status: 'unknown', label, candidates: [], detectedName: label };
  }

  const [best, second] = candidates;
  const margin = second ? best.score / second.score : Infinity;
  const strong = best.score >= 6;

  // A confident win needs both an absolute score and a gap to second place.
  // Two trims of one nameplate share every word Vision returned and so tie
  // exactly at 1.0; any margin above that means one of them held a word the
  // other did not. The threshold sits in the empty ground between the two —
  // well clear of a tie, well below a genuine win — rather than hugging either.
  if (strong && margin >= 1.15) {
    return { status: 'identified', label, car: best.car, candidates, detectedName: displayName(best.car) };
  }
  if (best.score >= 2.5) {
    return { status: 'ambiguous', label, candidates, detectedName: label };
  }
  return { status: 'unknown', label, candidates, detectedName: label };
}
