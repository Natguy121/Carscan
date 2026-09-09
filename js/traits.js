// Thirty things that tell one car from another, and the logic for choosing
// which one to ask about next.
//
// Every trait is derived from a field already in the database — nothing here is
// a new claim about a car, it is the same verified spec asked as a question you
// can answer by looking at one.
//
// The player is not expected to know any of this up front. The app answers the
// shape questions itself from what the model saw, then asks one question at a
// time, always the one that splits the remaining cars most evenly. Twenty
// questions, except it rarely needs more than four.

const startYear = (car) => Number(String(car.years).match(/(\d{4})/)?.[1]) || 0;
const engine = (car) => String(car.engine).toLowerCase();

export const TRAIT_GROUPS = [
  ['shape', 'Shape'],
  ['badge', 'Badge'],
  ['sound', 'Engine & sound'],
  ['inside', 'Size & seats'],
  ['era', 'Age'],
];

// `ease` is how answerable the question is standing next to the car: 3 is
// obvious at a glance, 1 needs you to know something about cars. It weights
// which question gets asked, so the easy ones come first.
export const TRAITS = [
  // ------------------------------------------------------------------ shape
  { id: 'two-doors', group: 'shape', ease: 3, label: 'Coupe or convertible shape', question: 'Is it a low two-door shape — a coupe or convertible?', test: (c) => c.body === 'coupe' || c.body === 'convertible' },
  { id: 'open-top', group: 'shape', ease: 3, label: 'Roof comes off', question: 'Does the roof come off?', test: (c) => c.body === 'convertible' },
  { id: 'tall', group: 'shape', ease: 3, label: 'Sits up high', question: 'Does it sit up high, like an SUV or truck?', test: (c) => c.body === 'suv' || c.body === 'pickup' },
  { id: 'bed', group: 'shape', ease: 3, label: 'Has a bed', question: 'Does it have an open pickup bed at the back?', test: (c) => c.body === 'pickup' },
  { id: 'boxy', group: 'shape', ease: 3, label: 'Van shaped', question: 'Is it van shaped — tall and boxy all the way back?', test: (c) => c.body === 'van' || c.body === 'minivan' },
  { id: 'estate', group: 'shape', ease: 3, label: 'Long wagon tail', question: 'Is it a long estate or wagon, with the roof running to the back?', test: (c) => c.body === 'wagon' },

  // ------------------------------------------------------------------ badge
  { id: 'jp', group: 'badge', ease: 3, label: 'Japanese', question: 'Is the badge Japanese — Toyota, Honda, Nissan, Mazda, Subaru, Mitsubishi, Lexus?', test: (c) => c.country === 'Japan' },
  { id: 'de', group: 'badge', ease: 3, label: 'German', question: 'Is the badge German — VW, BMW, Mercedes, Audi, Porsche, Opel?', test: (c) => c.country === 'Germany' },
  { id: 'us', group: 'badge', ease: 3, label: 'American', question: 'Is the badge American — Ford, Chevrolet, Dodge, Jeep, Tesla, Cadillac?', test: (c) => c.country === 'USA' },
  { id: 'uk', group: 'badge', ease: 3, label: 'British', question: 'Is the badge British — Land Rover, Jaguar, Mini, Bentley, Aston Martin?', test: (c) => c.country === 'United Kingdom' },
  { id: 'it', group: 'badge', ease: 3, label: 'Italian', question: 'Is the badge Italian — Fiat, Ferrari, Lamborghini, Alfa Romeo, Maserati?', test: (c) => c.country === 'Italy' },
  { id: 'fr', group: 'badge', ease: 3, label: 'French', question: 'Is the badge French — Renault, Peugeot, Citroën, Bugatti?', test: (c) => c.country === 'France' },
  { id: 'kr', group: 'badge', ease: 3, label: 'Korean', question: 'Is the badge Korean — Hyundai, Kia, Genesis?', test: (c) => c.country === 'South Korea' },
  { id: 'se', group: 'badge', ease: 3, label: 'Swedish', question: 'Is the badge Swedish — Volvo, Saab, Koenigsegg, Polestar?', test: (c) => c.country === 'Sweden' },

  // ------------------------------------------------------------------ sound
  { id: 'electric', group: 'sound', ease: 3, label: 'Silent — electric', question: 'Is it electric — silent, and no exhaust pipe at the back?', test: (c) => c.fuel === 'electric' },
  { id: 'hybrid', group: 'sound', ease: 2, label: 'Hybrid', question: 'Does it say Hybrid on the back?', test: (c) => /hybrid/.test(engine(c)) },
  { id: 'diesel', group: 'sound', ease: 2, label: 'Diesel clatter', question: 'Does it sound like a diesel — rattly and clattery when idling?', test: (c) => /diesel/.test(engine(c)) },
  { id: 'v8', group: 'sound', ease: 2, label: 'V8 rumble', question: 'Does it have a deep V8 rumble?', test: (c) => /\bv8\b/.test(engine(c)) },
  { id: 'v6', group: 'sound', ease: 1, label: 'V6', question: 'Does it have a V6 — smoother and quieter than a V8, but not buzzy?', test: (c) => /\bv6\b/.test(engine(c)) },
  { id: 'four-pot', group: 'sound', ease: 1, label: 'Small four-cylinder', question: 'Does it have a small four-cylinder — the ordinary buzzy engine most cars have?', test: (c) => /\bi4\b|flat-4/.test(engine(c)) },
  { id: 'six-cyl', group: 'sound', ease: 1, label: 'Six cylinders', question: 'Does it have a straight-six or flat-six — smooth and hard-revving?', test: (c) => /\bi6\b|flat-6/.test(engine(c)) },
  { id: 'exotic-engine', group: 'sound', ease: 2, label: 'V10, V12 or bigger', question: 'Does it howl like a supercar — a V10, V12 or bigger?', test: (c) => /\bv10\b|\bv12\b|\bw12\b|\bw16\b/.test(engine(c)) },
  { id: 'rotary', group: 'sound', ease: 1, label: 'Rotary buzz', question: 'Is it a rotary — the odd buzzing engine only Mazda made?', test: (c) => /rotary/.test(engine(c)) },

  // ----------------------------------------------------------------- inside
  { id: 'two-seats', group: 'inside', ease: 2, label: 'Only two seats', question: 'Does it only have two seats inside?', test: (c) => c.seats <= 2 },
  { id: 'seven-seats', group: 'inside', ease: 2, label: 'Seven seats or more', question: 'Does it have a third row — seven seats or more?', test: (c) => c.seats >= 7 },
  { id: 'heavy', group: 'inside', ease: 2, label: 'Big and heavy', question: 'Is it big and heavy, the size of a large SUV or truck?', test: (c) => c.weight >= 4500 },
  { id: 'light', group: 'inside', ease: 2, label: 'Small and light', question: 'Is it small and light — a little city car?', test: (c) => c.weight <= 2500 },

  // -------------------------------------------------------------------- era
  { id: 'classic', group: 'era', ease: 2, label: 'Classic — before 1990', question: 'Does it look old — a classic from before 1990?', test: (c) => startYear(c) < 1990 },
  { id: 'nineties', group: 'era', ease: 1, label: 'From the 90s or 2000s', question: 'Does it look like a 90s or 2000s car — not new, but not a classic?', test: (c) => startYear(c) >= 1990 && startYear(c) < 2010 },
  { id: 'new', group: 'era', ease: 2, label: 'Looks new — 2010 on', question: 'Does it look modern — built in the last fifteen years?', test: (c) => startYear(c) >= 2010 },
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
 * The question worth asking next: the one that splits what's left most evenly,
 * preferring questions a person can actually answer standing on the pavement.
 *
 * A question every remaining car answers the same way is skipped — it cannot
 * narrow anything, so asking it would waste the player's only real currency,
 * which is patience.
 */
export function bestQuestion(pool, asked = new Set()) {
  let best = null;

  for (const trait of TRAITS) {
    if (asked.has(trait.id)) continue;

    let yes = 0;
    for (const car of pool) if (trait.test(car)) yes++;
    if (yes === 0 || yes === pool.length) continue;

    const p = yes / pool.length;
    const bits = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    const score = bits * (trait.ease || 1);
    if (!best || score > best.score) best = { trait, score };
  }

  return best?.trait || null;
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
