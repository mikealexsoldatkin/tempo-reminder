import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, isWeekend, workingDayWindow } from '../src/backend/workdays.js';

test('выходные распознаются', () => {
  assert.equal(isWeekend('2026-08-08'), true); // суббота
  assert.equal(isWeekend('2026-08-09'), true); // воскресенье
  assert.equal(isWeekend('2026-08-10'), false); // понедельник
});

test('сдвиг дат переживает границы месяца', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('в середине недели окно 2 рабочих дней — это 2 календарных дня', () => {
  assert.deepEqual(workingDayWindow('2026-08-12', 2), { from: '2026-08-10', to: '2026-08-12' });
});

test('в понедельник и вторник окно перепрыгивает через выходные', () => {
  assert.deepEqual(workingDayWindow('2026-08-10', 2), { from: '2026-08-06', to: '2026-08-10' });
  assert.deepEqual(workingDayWindow('2026-08-11', 2), { from: '2026-08-07', to: '2026-08-11' });
});

test('окно произвольной длины считает только рабочие дни', () => {
  assert.deepEqual(workingDayWindow('2026-08-14', 5), { from: '2026-08-07', to: '2026-08-14' });
  assert.deepEqual(workingDayWindow('2026-08-14', 1), { from: '2026-08-13', to: '2026-08-14' });
});
