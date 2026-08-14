import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_HOLIDAYS,
  describeHoliday,
  holidayDate,
  makeHolidayChecker,
  nextHolidayDate,
  normalizeHoliday,
} from '../src/backend/holidays.js';
import { lastWorkingDays } from '../src/backend/workdays.js';

const byId = (id) => DEFAULT_HOLIDAYS.find((holiday) => holiday.id === id);

/* ------------------------------ развёртка дат ------------------------------ */

test('праздник с фиксированной датой одинаков во всех годах', () => {
  assert.equal(holidayDate(byId('new-year'), 2026), '2026-01-01');
  assert.equal(holidayDate(byId('orthodox-christmas'), 2027), '2027-01-07');
  assert.equal(holidayDate(byId('victory-day'), 2026), '2026-05-09');
  assert.equal(holidayDate(byId('independence-day'), 2026), '2026-07-04');
  assert.equal(holidayDate(byId('catholic-christmas'), 2026), '2026-12-25');
});

test('29 февраля в невисокосном году сдвигается на 28-е, а не теряется', () => {
  const leapDay = { id: 'x', name: 'Leap day', type: 'fixed', month: 2, day: 29 };
  assert.equal(holidayDate(leapDay, 2028), '2028-02-29');
  assert.equal(holidayDate(leapDay, 2026), '2026-02-28');
});

test('последний понедельник мая — Memorial Day', () => {
  assert.equal(holidayDate(byId('memorial-day'), 2026), '2026-05-25');
  assert.equal(holidayDate(byId('memorial-day'), 2027), '2027-05-31');
});

test('первый понедельник сентября — Labor Day', () => {
  assert.equal(holidayDate(byId('labor-day'), 2026), '2026-09-07');
  assert.equal(holidayDate(byId('labor-day'), 2027), '2027-09-06');
});

test('День благодарения — четвёртый четверг ноября, а следующий день считается сдвигом', () => {
  assert.equal(holidayDate(byId('thanksgiving'), 2026), '2026-11-26');
  assert.equal(holidayDate(byId('thanksgiving-friday'), 2026), '2026-11-27');
});

test('«четвёртая пятница ноября» — не то же самое, что день после Дня благодарения', () => {
  // В 2025-м ноябрь начинается с субботы, а в 2030-м — с пятницы: во втором
  // случае четвёртая пятница оказывается раньше четвёртого четверга.
  const fourthFriday = { id: 'x', name: 'x', type: 'nth-weekday', month: 11, weekday: 5, nth: 4 };
  assert.equal(holidayDate(byId('thanksgiving'), 2030), '2030-11-28');
  assert.equal(holidayDate(byId('thanksgiving-friday'), 2030), '2030-11-29');
  assert.equal(holidayDate(fourthFriday, 2030), '2030-11-22');
});

test('пятого понедельника в месяце может не быть', () => {
  const fifthMonday = { id: 'x', name: 'x', type: 'nth-weekday', month: 5, weekday: 1, nth: 5 };
  assert.equal(holidayDate(fifthMonday, 2027), '2027-05-31');
  assert.equal(holidayDate(fifthMonday, 2026), null);
});

/* ------------------------------ проверка дня ------------------------------ */

test('проверка находит праздник в любом году, включая перенос через границу года', () => {
  const isHoliday = makeHolidayChecker([
    ...DEFAULT_HOLIDAYS,
    { id: 'ny-eve-shift', name: 'New Year shift', type: 'fixed', month: 12, day: 31 },
    // 31 декабря + 1 день попадает уже в следующий год.
    { id: 'crossing', name: 'Crossing', type: 'nth-weekday', month: 12, weekday: 4, nth: -1, offsetDays: 6 },
  ]);

  assert.equal(isHoliday('2026-01-01').name, 'New Year');
  assert.equal(isHoliday('2027-05-31').name, 'Memorial Day');
  assert.equal(isHoliday('2026-08-12'), null);
  // Последний четверг декабря 2026 — 31-е, +6 дней = 6 января 2027.
  assert.equal(isHoliday('2027-01-06').name, 'Crossing');
});

test('ближайшая дата праздника перескакивает в следующий год, когда в этом он уже прошёл', () => {
  assert.equal(nextHolidayDate(byId('new-year'), '2026-08-14'), '2027-01-01');
  assert.equal(nextHolidayDate(byId('catholic-christmas'), '2026-08-14'), '2026-12-25');
});

/* ------------------------------ окно проверки ------------------------------ */

test('праздник не попадает в окно рабочих дней', () => {
  const isHoliday = makeHolidayChecker(DEFAULT_HOLIDAYS);
  // 2026-07-04 — суббота, поэтому берём год, где 4 июля рабочий день: 2028-07-04 — вторник.
  assert.equal(isHoliday('2028-07-04').name, 'Independence Day');
  assert.deepEqual(lastWorkingDays('2028-07-05', 3, isHoliday), [
    '2028-06-30',
    '2028-07-03',
    '2028-07-05',
  ]);
});

test('окно без учёта праздников остаётся прежним', () => {
  assert.deepEqual(lastWorkingDays('2028-07-05', 3), ['2028-07-03', '2028-07-04', '2028-07-05']);
});

test('календарь «каждый день праздник» не вешает отсчёт, а падает с понятной ошибкой', () => {
  assert.throws(() => lastWorkingDays('2026-08-14', 3, () => ({ name: 'Always' })), /working days/);
});

/* -------------------------------- разбор ввода -------------------------------- */

test('правило без имени не принимается', () => {
  assert.throws(() => normalizeHoliday({ type: 'fixed', month: 1, day: 1 }), /name/);
});

test('несуществующая дата не принимается', () => {
  assert.throws(() => normalizeHoliday({ name: 'x', type: 'fixed', month: 4, day: 31 }), /30 days/);
  assert.throws(() => normalizeHoliday({ name: 'x', type: 'fixed', month: 13, day: 1 }), /month/);
});

test('29 февраля принимается — это законное правило', () => {
  const holiday = normalizeHoliday({ name: 'Leap', type: 'fixed', month: 2, day: 29 });
  assert.equal(holiday.day, 29);
});

test('нулевая позиция в правиле «N-й день недели» не принимается', () => {
  assert.throws(
    () => normalizeHoliday({ name: 'x', type: 'nth-weekday', month: 5, weekday: 1, nth: 0 }),
    /zero/
  );
});

test('id генерируется из имени, если его не передали', () => {
  const holiday = normalizeHoliday({ name: 'Company day off', type: 'fixed', month: 6, day: 1 });
  assert.match(holiday.id, /^company-day-off-/);
  assert.equal(normalizeHoliday({ ...holiday }).id, holiday.id);
});

/* -------------------------------- расшифровка -------------------------------- */

test('правило читается словами', () => {
  assert.equal(describeHoliday(byId('new-year')), 'January 1');
  assert.equal(describeHoliday(byId('memorial-day')), 'Last Monday of May');
  assert.equal(describeHoliday(byId('labor-day')), '1st Monday of September');
  assert.equal(describeHoliday(byId('thanksgiving-friday')), '4th Thursday of November + 1 day');
});
