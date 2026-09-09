// Shortlist for the player to confirm from. The on-device model can only
// guess a body style, never an exact make and model, so ranking is simple:
// cars matching that body style first, then the ones you're actually most
// likely to see on the road — the shape is the one clue, commonness settles
// the rest.

import { CARS, RARITY } from './cars.js';

const RARITY_ORDER = Object.keys(RARITY);

/**
 * @param {string|null} body one of the keys in BODIES, or null if the model
 *   couldn't tell — in which case every car is ranked by commonness alone.
 * @param {number} limit how many to return
 */
export function candidatesForBody(body, limit = 8) {
  return [...CARS]
    .sort((a, b) => {
      const aMatch = body && a.body === body;
      const bMatch = body && b.body === body;
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
      return RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
    })
    .slice(0, limit);
}
