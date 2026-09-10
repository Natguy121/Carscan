// Shortlist for the player to confirm from. The on-device model can only guess
// a shape, never an exact make and model, so ranking leans on four things in
// order: does the body style match, does the car's character match what the
// photo looked like, have you seen this car before, and how common is it.

import { CARS, RARITY } from './cars.js';

const RARITY_ORDER = Object.keys(RARITY);

/**
 * Does this car fit the character the photo read as? A body style says an SUV;
 * the character says whether it is a Urus or a RAV4.
 *
 * Deliberately generous — this only ever reorders a shortlist, so a car it
 * misjudges slips down a few places rather than disappearing.
 */
function fitsCharacter(car, character) {
  const engine = String(car.engine).toLowerCase();
  switch (character) {
    case 'sporty':
      return car.zeroToSixty <= 5.5 || car.seats <= 2 || car.topSpeed >= 165;
    case 'workhorse':
      return car.body === 'pickup' || car.body === 'van'
        || /diesel/.test(engine) || car.weight >= 4800;
    case 'family':
      return car.seats >= 6 || car.body === 'minivan' || car.body === 'van' || car.body === 'wagon';
    default:
      return false;
  }
}

/**
 * @param {string|null} body one of the keys in BODIES, or null if the model
 *   couldn't tell — in which case every car is ranked on the other signals.
 * @param {number} limit how many to return
 * @param {object} context
 * @param {Set<string>} [context.caughtIds] cars already caught
 * @param {Map<string, number>} [context.makeCounts] how often each make is caught.
 *   The player's own scan record is real evidence about what is parked near
 *   them: the same car reappears, and someone who has logged six Toyotas is
 *   likely looking at a seventh.
 * @param {string|null} [context.character] 'sporty' | 'workhorse' | 'family',
 *   read off the photo alongside the body style.
 * @param {Array} [pool] the cars to rank, already narrowed by the player's answers
 */
export function candidatesForBody(body, limit = 8, context = {}, pool = CARS) {
  const caughtIds = context.caughtIds || new Set();
  const makeCounts = context.makeCounts || new Map();
  const character = context.character || null;

  const rank = (car) => [
    body && car.body === body ? 0 : 1,
    character && fitsCharacter(car, character) ? 0 : 1,
    caughtIds.has(car.id) ? 0 : 1,
    -Math.min(makeCounts.get(car.make) || 0, 5),
    RARITY_ORDER.indexOf(car.rarity),
  ];

  return [...pool]
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return ra[i] - rb[i];
      }
      return 0;
    })
    .slice(0, limit);
}
