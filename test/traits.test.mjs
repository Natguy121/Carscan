import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRAITS, TRAIT_GROUPS, matchesAnswers, answersForBody, bestQuestion, usefulTraits,
} from '../js/traits.js';
import { CARS, CARS_BY_ID } from '../js/cars.js';

const narrow = (answers) => CARS.filter((car) => matchesAnswers(car, answers));

test('there are thirty things to look for', () => {
  assert.equal(TRAITS.length, 30);
});

test('every trait is uniquely identified, asks a question, and belongs to a real group', () => {
  const groups = new Set(TRAIT_GROUPS.map(([key]) => key));
  const ids = new Set();
  for (const trait of TRAITS) {
    assert.ok(!ids.has(trait.id), `duplicate trait ${trait.id}`);
    ids.add(trait.id);
    assert.ok(trait.label, `${trait.id} needs a label`);
    assert.ok(trait.question?.endsWith('?'), `${trait.id} needs a question to ask`);
    assert.ok(trait.ease >= 1 && trait.ease <= 3, `${trait.id} needs an ease of 1-3`);
    assert.ok(groups.has(trait.group), `${trait.id} has unknown group "${trait.group}"`);
    assert.equal(typeof trait.test, 'function');
  }
});

test('every trait actually splits the index — none matches nothing or everything', () => {
  for (const trait of TRAITS) {
    const hits = CARS.filter(trait.test).length;
    assert.ok(hits > 0, `${trait.id} matches no car, so it can only ever be a dead end`);
    assert.ok(hits < CARS.length, `${trait.id} matches every car, so it narrows nothing`);
  }
});

test('no answers matches every car', () => {
  assert.equal(narrow(new Map()).length, CARS.length);
});

test('a "no" narrows just as a "yes" does', () => {
  const yes = narrow(new Map([['electric', true]]));
  const no = narrow(new Map([['electric', false]]));
  assert.ok(yes.every((c) => c.fuel === 'electric'));
  assert.ok(no.every((c) => c.fuel !== 'electric'));
  assert.equal(yes.length + no.length, CARS.length);
});

test('answers combine — every one has to hold', () => {
  const matched = narrow(new Map([['tall', true], ['jp', true], ['diesel', true]]));
  assert.ok(matched.length > 0);
  assert.ok(matched.every((c) => (c.body === 'suv' || c.body === 'pickup') && c.country === 'Japan'));
  assert.ok(matched.some((c) => c.id === 'toyota-fortuner'));
});

test('an unknown trait id is ignored rather than rejecting everything', () => {
  assert.ok(matchesAnswers(CARS[0], new Map([['not-a-real-trait', true]])));
});

// ------------------------------------------------------- answering from shape

test('the guessed body style answers every shape question by itself', () => {
  const answers = answersForBody('suv');
  const shape = TRAITS.filter((t) => t.group === 'shape');
  assert.equal(answers.size, shape.length);
  assert.equal(answers.get('tall'), true);
  assert.equal(answers.get('bed'), false);
  assert.equal(answers.get('two-doors'), false);
});

test('answering from the shape keeps every car of that shape and drops the rest', () => {
  const pool = narrow(answersForBody('suv'));
  assert.ok(pool.every((c) => c.body === 'suv'));
  assert.ok(pool.some((c) => c.id === 'toyota-fortuner'));
});

test('an unknown body style answers nothing rather than guessing', () => {
  assert.equal(answersForBody(null).size, 0);
});

// -------------------------------------------------------- choosing questions

test('the question asked is one that actually splits what is left', () => {
  const q = bestQuestion(CARS, new Set());
  assert.ok(q, 'there should always be a question worth asking about 898 cars');
  const yes = CARS.filter(q.test).length;
  assert.ok(yes > 0 && yes < CARS.length);
});

test('a question already dealt with is never asked again', () => {
  const asked = new Set(TRAITS.map((t) => t.id));
  assert.equal(bestQuestion(CARS, asked), null);
});

test('a question every remaining car answers the same way is not asked', () => {
  const pool = CARS.filter((c) => c.country === 'Japan');
  for (let i = 0; i < 5; i++) {
    const q = bestQuestion(pool, new Set());
    if (!q) break;
    assert.notEqual(q.id, 'jp', 'they are all Japanese — asking tells you nothing');
    break;
  }
});

test('easy questions are preferred over ones needing car knowledge', () => {
  // Both split the field; the badge is readable, the cylinder count is not.
  const pool = CARS.filter((c) => c.country === 'Japan' || c.country === 'Germany');
  const q = bestQuestion(pool, new Set());
  assert.ok(q.ease >= 2, `expected an easy question first, got "${q.label}" (ease ${q.ease})`);
});

test('a handful of questions finds a specific car in the index', () => {
  const target = CARS_BY_ID.get('toyota-fortuner');
  const answers = answersForBody('suv');
  const asked = new Set(answers.keys());

  let pool = narrow(answers);
  let questions = 0;
  while (pool.length > 5 && questions < 10) {
    const q = bestQuestion(pool, asked);
    if (!q) break;
    answers.set(q.id, q.test(target)); // the player answers truthfully
    asked.add(q.id);
    pool = pool.filter((car) => matchesAnswers(car, answers));
    questions++;
  }

  assert.ok(questions <= 6, `expected to get there in a few questions, took ${questions}`);
  assert.ok(pool.length <= 5, `expected a short list, got ${pool.length}`);
  assert.ok(pool.some((c) => c.id === target.id), 'truthful answers must never lose the car');
});

test('truthful answers never lose the car, whichever car it is', () => {
  for (const target of [CARS_BY_ID.get('honda-civic'), CARS_BY_ID.get('ford-f150'), CARS_BY_ID.get('bugatti-chiron')]) {
    const answers = answersForBody(target.body);
    const asked = new Set(answers.keys());
    let pool = narrow(answers);

    for (let i = 0; i < 8 && pool.length > 5; i++) {
      const q = bestQuestion(pool, asked);
      if (!q) break;
      answers.set(q.id, q.test(target));
      asked.add(q.id);
      pool = pool.filter((car) => matchesAnswers(car, answers));
    }
    assert.ok(pool.some((c) => c.id === target.id), `lost the ${target.model}`);
  }
});

// ------------------------------------------------------------ manual panel

test('traits that would empty the list are not offered', () => {
  const pool = CARS.filter((c) => c.fuel === 'electric');
  const offered = usefulTraits(pool, new Set());
  assert.ok(!offered.some((t) => t.id === 'diesel'), 'no electric car is a diesel');
  assert.ok(offered.some((t) => t.id === 'tall'), 'some electric cars are tall, so it still helps');
});

test('an already-answered trait stays on the panel so it can be taken back', () => {
  const answers = new Map([['jp', true]]);
  const offered = usefulTraits(narrow(answers), new Set(answers.keys()));
  assert.ok(offered.some((t) => t.id === 'jp'));
});
