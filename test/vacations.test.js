import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectVacationDays,
  excludeVacationDays,
  indexPeople,
  matchPeople,
  normalize,
} from '../src/backend/vacations.js';

const person = (accountId, displayName, calendarName = null) => ({
  accountId,
  displayName,
  calendarName,
});

const bugrov = person('u1', 'Aleksandr Bugrov');
const anna = person('u2', 'Anna Ivanova');
const annLee = person('u3', 'Ann Lee');

const allDay = (summary, start, end) => ({ summary, allDay: true, start, end, recurring: false });

const range = { from: '2026-08-10', to: '2026-08-14' };

/* ------------------------------ матчинг ------------------------------ */

const match = (summary, people) => matchPeople(summary, indexPeople(people));

test('имя ищется подстрокой заголовка — тег и порядок слов вокруг не важны', () => {
  const people = [bugrov];
  assert.deepEqual(match('[vacation] Aleksandr Bugrov', people), ['u1']);
  assert.deepEqual(match('Vacation: aleksandr bugrov', people), ['u1']);
  assert.deepEqual(match('[pto] Aleksandr Bugrov (half day)', people), ['u1']);
  assert.deepEqual(match('[sick] Aleksandr Bugrov 🌴', people), ['u1']);
});

test('диакритика и пунктуация при сравнении не мешают', () => {
  assert.deepEqual(match('[vacation] Renée O’Brien', [person('u9', 'Renee OBrien')]), ['u9']);
});

test('совпадение только по границам слов: Ann Lee не находится внутри Joann Leeson', () => {
  assert.deepEqual(match('[vacation] Joann Leeson', [annLee]), []);
  assert.deepEqual(match('[vacation] Ann Lee', [annLee]), ['u3']);
});

test('другой порядок слов сам не матчится — для этого есть ручное написание', () => {
  assert.deepEqual(match('[vacation] Bugrov Aleksandr', [bugrov]), []);
  assert.deepEqual(
    match('[vacation] Bugrov Aleksandr', [person('u1', 'Aleksandr Bugrov', 'Bugrov Aleksandr')]),
    ['u1']
  );
});

test('ручных написаний может быть несколько — через запятую', () => {
  const people = [person('u1', 'Aleksandr Bugrov', 'Aleksandr Bugrov, Alex Bugrov, Александр Бугров')];
  assert.deepEqual(match('[vacation] Alex Bugrov', people), ['u1']);
  assert.deepEqual(match('[отпуск] Александр Бугров', people), ['u1']);
  assert.deepEqual(match('[vacation] Aleksandr Bugrov', people), ['u1']);
});

test('одно событие может назвать нескольких людей', () => {
  assert.deepEqual(match('[vacation] Ann Lee, Anna Ivanova', [anna, annLee]), ['u2', 'u3']);
});

test('человек без имени в индекс не попадает и ничему не матчится', () => {
  assert.deepEqual(indexPeople([{ accountId: 'u0', displayName: '' }]), []);
  assert.deepEqual(match('[vacation] anybody', [{ accountId: 'u0', displayName: '' }]), []);
});

test('normalize приводит заголовок к сравнимому виду', () => {
  assert.equal(normalize('  [VACATION]  Aleksandr   Bugrov! '), 'vacation aleksandr bugrov');
});

/* --------------------------- дни по людям --------------------------- */

test('дни отпуска раскладываются по людям и обрезаются окном', () => {
  const result = collectVacationDays(
    [
      allDay('[vacation] Aleksandr Bugrov', '2026-08-08', '2026-08-12'),
      allDay('[dayoff] Anna Ivanova', '2026-08-14', '2026-08-15'),
    ],
    [bugrov, anna],
    range
  );

  assert.deepEqual([...result.daysByPerson.get('u1')], ['2026-08-10', '2026-08-11']);
  assert.deepEqual([...result.daysByPerson.get('u2')], ['2026-08-14']);
  assert.equal(result.matchedEvents, 2);
});

test('несколько отпусков одного человека складываются', () => {
  const result = collectVacationDays(
    [
      allDay('[vacation] Anna Ivanova', '2026-08-10', '2026-08-11'),
      allDay('[sick] Anna Ivanova', '2026-08-13', '2026-08-14'),
    ],
    [anna],
    range
  );
  assert.deepEqual([...result.daysByPerson.get('u2')].sort(), ['2026-08-10', '2026-08-13']);
});

test('несматчившиеся заголовки собираются для диагностики, с числом повторов', () => {
  const result = collectVacationDays(
    [
      allDay('Team offsite', '2026-08-10', '2026-08-11'),
      allDay('Team offsite', '2026-08-12', '2026-08-13'),
      allDay('[vacation] Nobody Known', '2026-08-11', '2026-08-12'),
    ],
    [bugrov],
    range
  );

  assert.equal(result.matchedEvents, 0);
  assert.deepEqual(result.unmatched, [
    { title: 'Team offsite', count: 2 },
    { title: '[vacation] Nobody Known', count: 1 },
  ]);
});

test('события со временем и повторяющиеся в отпуска не идут, но считаются', () => {
  const result = collectVacationDays(
    [
      { summary: '[vacation] Anna Ivanova', allDay: false, start: '2026-08-11', end: '2026-08-11' },
      { ...allDay('[dayoff] Anna Ivanova', '2026-08-12', '2026-08-13'), recurring: true },
    ],
    [anna],
    range
  );

  assert.equal(result.daysByPerson.size, 0);
  assert.equal(result.timedSkipped, 1);
  assert.equal(result.recurringSkipped, 1);
});

/* ------------------------ вычёркивание дней ------------------------ */

test('отпускные дни исчезают из пропущенных, остальные остаются', () => {
  const missing = new Map([['u1', ['2026-08-10', '2026-08-11', '2026-08-12']]]);
  const vacation = new Map([['u1', new Set(['2026-08-11', '2026-08-12'])]]);

  const result = excludeVacationDays(missing, vacation);
  assert.deepEqual(result.missingDaysByUser.get('u1'), ['2026-08-10']);
  assert.deepEqual(result.excusedDaysByUser.get('u1'), ['2026-08-11', '2026-08-12']);
});

test('отпуск на всё окно оставляет человека без долгов — его не тронут и в дайджесте', () => {
  const missing = new Map([['u1', ['2026-08-10', '2026-08-11']]]);
  const vacation = new Map([['u1', new Set(['2026-08-10', '2026-08-11'])]]);

  const result = excludeVacationDays(missing, vacation);
  assert.deepEqual(result.missingDaysByUser.get('u1'), []);
  assert.deepEqual(result.excusedDaysByUser.get('u1'), ['2026-08-10', '2026-08-11']);
});

test('без отпусков список пропущенных не меняется', () => {
  const missing = new Map([
    ['u1', ['2026-08-10']],
    ['u2', []],
  ]);
  const result = excludeVacationDays(missing, new Map());
  assert.deepEqual(result.missingDaysByUser.get('u1'), ['2026-08-10']);
  assert.deepEqual(result.missingDaysByUser.get('u2'), []);
  assert.deepEqual(result.excusedDaysByUser.get('u1'), []);
});
