import assert from 'node:assert/strict';
import test from 'node:test';
import { isWeekend, workingDayWindow } from '../src/backend/workdays.js';

const utc = (iso) => new Date(`${iso}T12:00:00Z`);

test('выходные распознаются', () => {
  assert.equal(isWeekend(utc('2026-08-08')), true); // суббота
  assert.equal(isWeekend(utc('2026-08-09')), true); // воскресенье
  assert.equal(isWeekend(utc('2026-08-10')), false); // понедельник
});

test('в середине недели окно 2 рабочих дней — это 2 календарных дня', () => {
  assert.deepEqual(workingDayWindow(utc('2026-08-12'), 2), { from: '2026-08-10', to: '2026-08-12' });
});

test('в понедельник и вторник окно перепрыгивает через выходные', () => {
  assert.deepEqual(workingDayWindow(utc('2026-08-10'), 2), { from: '2026-08-06', to: '2026-08-10' });
  assert.deepEqual(workingDayWindow(utc('2026-08-11'), 2), { from: '2026-08-07', to: '2026-08-11' });
});

test('окно произвольной длины считает только рабочие дни', () => {
  assert.deepEqual(workingDayWindow(utc('2026-08-14'), 5), { from: '2026-08-07', to: '2026-08-14' });
  assert.deepEqual(workingDayWindow(utc('2026-08-14'), 1), { from: '2026-08-13', to: '2026-08-14' });
});
