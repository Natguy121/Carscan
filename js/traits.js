// Thirty things that tell one car from another, and the logic for choosing
// which one to ask about next.
//
// Every trait is derived from a field already in the database — nothing here is
// a new claim about a car, it is the same verified spec asked as a question you
// can answer by looking at one.
//
// The shape ones answer themselves from what the model saw. The rest are there
// for the player to tick when they can see something the model can't.

const startYear = (car) => Number(String(car.years).match(/(\d{4})/)?.[1]) || 0;
const engine = (car) => String(car.engine).toLowerCase();

export const TRAIT_GROUPS = [
  ['shape', 'Shape'],
  ['badge', 'Badge'],
  ['sound', 'Engine & sound'],
  ['inside', 'Size & seats'],
  ['era', 'Age'],
];

export const TRAITS = [
  // ------------------------------------------------------------------ shape
  { id: 'two-doors', group: 'shape', label: 'Coupe or convertible shape', test: (c) => c.body === 'coupe' || c.body === 'convertible' },
  { id: 'open-top', group: 'shape', label: 'Roof comes off', test: (c) => c.body === 'convertible' },
  { id: 'tall', group: 'shape', label: 'Sits up high', test: (c) => c.body === 'suv' || c.body === 'pickup' },
  { id: 'bed', group: 'shape', label: 'Has a bed', test: (c) => c.body === 'pickup' },
  { id: 'boxy', group: 'shape', label: 'Van shaped', test: (c) => c.body === 'van' || c.body === 'minivan' },
  { id: 'estate', group: 'shape', label: 'Long wagon tail', test: (c) => c.body === 'wagon' },

  // ------------------------------------------------------------------ badge
  { id: 'jp', group: 'badge', label: 'Japanese', test: (c) => c.country === 'Japan' },
  { id: 'de', group: 'badge', label: 'German', test: (c) => c.country === 'Germany' },
  { id: 'us', group: 'badge', label: 'American', test: (c) => c.country === 'USA' },
  { id: 'uk', group: 'badge', label: 'British', test: (c) => c.country === 'United Kingdom' },
  { id: 'it', group: 'badge', label: 'Italian', test: (c) => c.country === 'Italy' },
  { id: 'fr', group: 'badge', label: 'French', test: (c) => c.country === 'France' },
  { id: 'kr', group: 'badge', label: 'Korean', test: (c) => c.country === 'South Korea' },
  { id: 'se', group: 'badge', label: 'Swedish', test: (c) => c.country === 'Sweden' },

  // ------------------------------------------------------------------ sound
  { id: 'electric', group: 'sound', label: 'Silent — electric', test: (c) => c.fuel === 'electric' },
  { id: 'hybrid', group: 'sound', label: 'Hybrid', test: (c) => /hybrid/.test(engine(c)) },
  { id: 'diesel', group: 'sound', label: 'Diesel clatter', test: (c) => /diesel/.test(engine(c)) },
  { id: 'v8', group: 'sound', label: 'V8 rumble', test: (c) => /\bv8\b/.test(engine(c)) },
  { id: 'v6', group: 'sound', label: 'V6', test: (c) => /\bv6\b/.test(engine(c)) },
  { id: 'four-pot', group: 'sound', label: 'Small four-cylinder', test: (c) => /\bi4\b|flat-4/.test(engine(c)) },
  { id: 'six-cyl', group: 'sound', label: 'Six cylinders', test: (c) => /\bi6\b|flat-6/.test(engine(c)) },
  { id: 'exotic-engine', group: 'sound', label: 'V10, V12 or bigger', test: (c) => /\bv10\b|\bv12\b|\bw12\b|\bw16\b/.test(engine(c)) },
  { id: 'rotary', group: 'sound', label: 'Rotary buzz', test: (c) => /rotary/.test(engine(c)) },

  // ----------------------------------------------------------------- inside
  { id: 'two-seats', group: 'inside', label: 'Only two seats', test: (c) => c.seats <= 2 },
  { id: 'seven-seats', group: 'inside', label: 'Seven seats or more', test: (c) => c.seats >= 7 },
  { id: 'heavy', group: 'inside', label: 'Big and heavy', test: (c) => c.weight >= 4500 },
  { id: 'light', group: 'inside', label: 'Small and light', test: (c) => c.weight <= 2500 },

  // -------------------------------------------------------------------- era
  { id: 'classic', group: 'era', label: 'Classic — before 1990', test: (c) => startYear(c) < 1990 },
  { id: 'nineties', group: 'era', label: 'From the 90s or 2000s', test: (c) => startYear(c) >= 1990 && startYear(c) < 2010 },
  { id: 'new', group: 'era', label: 'Looks new — 2010 on', test: (c) => startYear(c) >= 2010 },
];

export const TRAITS_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));

/**
 * Does this car fit every answer given? Answers is a Map of trait id to true
 * ("yes, it has this") or false ("no, it doesn't") — a no is as narrowing as a
 * yes, which is most of why asking beats picking from a list.
 */
export function matchesAnswers(car, answers) {
  for (const [id, expected] of answers) {
    const trait = TRAITS_BY_ID.get(id);
    if (trait && trait.test(car) !== expected) return false;
  }
  return true;
}

/**
 * Everything the shape of the car already settles. All the shape traits read
 * nothing but `body`, so the model's own guess answers them without asking.
 */
export function answersForBody(body) {
  const answers = new Map();
  if (!body) return answers;
  for (const trait of TRAITS) {
    if (trait.group === 'shape') answers.set(trait.id, trait.test({ body }));
  }
  return answers;
}

/**
 * Traits worth showing on the manual panel: one that would rule out everything
 * left is a dead end, and one every remaining car shares tells you nothing.
 */
export function usefulTraits(cars, answered = new Set()) {
  return TRAITS.filter((trait) => {
    if (answered.has(trait.id)) return true;
    let hits = 0;
    for (const car of cars) if (trait.test(car)) hits++;
    return hits > 0 && hits < cars.length;
  });
}
