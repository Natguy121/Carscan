// Shortlist for the player to confirm from. The on-device model can only
// guess a body style, never an exact make and model, so ranking leans on three
// things in order: does the body style match, have you seen this car before,
// and how common is it on the road.

import { CARS, RARITY } from './cars.js';

const RARITY_ORDER = Object.keys(RARITY);

/**
 * @param {string|null} body one of the keys in BODIES, or null if the model
 *   couldn't tell — in which case every car is ranked on the other signals.
 * @param {number} limit how many to return
 * @param {{caughtIds?: Set<string>, makeCounts?: Map<string, number>}} history
 *   what the player has caught before. Their own scan record is real evidence
 *   about what is parked near them: the same car reappears, and someone who has
 *   logged six Toyotas is likely looking at a seventh.
 */
export function candidatesForBody(body, limit = 8, history = {}) {
  const caughtIds = history.caughtIds || new Set();
  const makeCounts = history.makeCounts || new Map();

  const rank = (car) => [
    body && car.body === body ? 0 : 1,
    caughtIds.has(car.id) ? 0 : 1,
    -Math.min(makeCounts.get(car.make) || 0, 5),
    RARITY_ORDER.indexOf(car.rarity),
  ];

  return [...CARS]
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
