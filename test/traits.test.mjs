import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRAITS, TRAIT_GROUPS, matchesAnswers, answersForBody, usefulTraits,
} from '../js/traits.js';
import { CARS, CARS_BY_ID } from '../js/cars.js';

const narrow = (answers) => CARS.filter((car) => matchesAnswers(car, answers));

test('there are thirty things to look for', () => {
  assert.equal(TRAITS.length, 30);
});

test('every trait is uniquely identified and belongs to a real group', () => {
  const groups = new Set(TRAIT_GROUPS.map(([key]) => key));
  const ids = new Set();
  for (const trait of TRAITS) {
    assert.ok(!ids.has(trait.id), `duplicate trait ${trait.id}`);
    ids.add(trait.id);
    assert.ok(trait.label, `${trait.id} needs a label`);
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
