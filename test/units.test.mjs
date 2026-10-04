import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLength, formatLength, lengthInputValue, formatArea } from '../js/units.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

test('metric input in any common form', () => {
  close(parseLength('3.45'), 3.45);
  close(parseLength('3,45'), 3.45);
  close(parseLength('345cm'), 3.45);
  close(parseLength('3450 mm'), 3.45);
  close(parseLength('3.45 m'), 3.45);
});

test('imperial input in any common form', () => {
  const ft = 0.3048;
  const inch = 0.0254;
  close(parseLength(`12' 6"`, 'imperial'), 12 * ft + 6 * inch);
  close(parseLength('12ft 6in', 'imperial'), 12 * ft + 6 * inch);
  close(parseLength('12 6', 'imperial'), 12 * ft + 6 * inch);
  close(parseLength('12.5', 'imperial'), 12.5 * ft);
  close(parseLength('150in'), 150 * inch);
  close(parseLength(`12′`, 'metric'), 12 * ft);
});

test('a bare number follows the chosen unit', () => {
  close(parseLength('10', 'metric'), 10);
  close(parseLength('10', 'imperial'), 3.048);
});

test('junk, zero and negatives are not lengths', () => {
  for (const s of ['', 'abc', '0', '-2', '3..4', null, undefined]) {
    assert.equal(parseLength(s), null, `"${s}" should not parse`);
  }
});

test('formatting', () => {
  assert.equal(formatLength(3.456), '3.46 m');
  assert.equal(formatLength(3.81, 'imperial'), `12′ 6″`);
  assert.equal(formatLength(3.6576, 'imperial'), `12′ 0″`);
  assert.equal(formatLength(null), '?');
  assert.equal(formatArea(12.34), '12.3 m²');
  assert.equal(formatArea(11.148, 'imperial'), '120 ft²');
});

test('inch rounding carries into the next foot', () => {
  assert.equal(formatLength(3.9615, 'imperial'), `13′ 0″`);
});

test('the input value round-trips through the parser', () => {
  for (const unit of ['metric', 'imperial']) {
    const text = lengthInputValue(3.81, unit);
    close(Math.round(parseLength(text, unit) * 100) / 100, 3.81);
  }
  assert.equal(lengthInputValue(null), '');
});
