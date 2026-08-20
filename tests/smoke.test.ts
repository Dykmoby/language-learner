import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ru, minutesRu } from '../src/ru.ts';

test('the central dictionary is reachable from node --test', () => {
  assert.equal(ru.appName, 'Языковой тренажёр');
});

test('Russian plurals agree with the number', () => {
  assert.equal(minutesRu(1), '1 минуту');
  assert.equal(minutesRu(3), '3 минуты');
  assert.equal(minutesRu(5), '5 минут');
  assert.equal(minutesRu(11), '11 минут');
  assert.equal(minutesRu(21), '21 минуту');
});
