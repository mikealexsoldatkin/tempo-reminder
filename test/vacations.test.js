import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cacheableEvents,
  collectVacationDays,
  excludeVacationDays,
  indexPeople,
  matchPeople,
  mergeVacationEvents,
  normalize,
  pruneVacationEvents,
  rememberedVacationEvents,
  restoreEvents,
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

/* ------------------------ память о событиях ------------------------ */

const uidEvent = (uid, summary, start, end) => ({ ...allDay(summary, start, end), uid });

test('запоминаем только события на весь день без повторов, в урезанной форме', () => {
  const stored = cacheableEvents([
    uidEvent('a@g', '[vacation] Aleksandr Bugrov', '2026-09-01', '2026-09-15'),
    { summary: '[vacation] Anna Ivanova', allDay: false, start: '2026-09-02', end: '2026-09-03', recurring: false },
    { summary: '[every friday] Ann Lee', allDay: true, start: '2026-09-04', end: '2026-09-05', recurring: true },
  ]);

  assert.deepEqual(stored, [
    { uid: 'a@g', summary: '[vacation] Aleksandr Bugrov', start: '2026-09-01', end: '2026-09-15' },
  ]);
});

test('событие без DTEND запоминается как один день', () => {
  const stored = cacheableEvents([{ summary: '[dayoff] X', allDay: true, start: '2026-09-04', recurring: false }]);
  assert.equal(stored[0].end, '2026-09-05');
});

test('восстановленное событие снова на весь день и без повтора', () => {
  const [event] = restoreEvents([
    { uid: 'a@g', summary: '[vacation] X', start: '2026-09-01', end: '2026-09-15' },
  ]);
  assert.equal(event.allDay, true);
  assert.equal(event.recurring, false);
});

test('из памяти уходит то, что закончилось раньше горизонта', () => {
  const kept = pruneVacationEvents(
    [
      { uid: 'old', summary: 'X', start: '2026-01-05', end: '2026-01-10' },
      { uid: 'new', summary: 'Y', start: '2026-09-01', end: '2026-09-15' },
    ],
    '2026-09-17',
    120
  );
  assert.deepEqual(kept.map((e) => e.uid), ['new']);
});

/*
 * Собственно тот случай, ради которого память и появилась: человек был в отпуске
 * 1–14 сентября, 15-го вышел, а фид в этот прогон ничего не отдал.
 */
test('фид не прочитан — отпуск берётся из памяти, и дни остаются прощёнными', () => {
  const cached = cacheableEvents([
    uidEvent('a@g', '[vacation] Aleksandr Bugrov', '2026-09-01', '2026-09-15'),
  ]);
  const events = rememberedVacationEvents(cached, '2026-09-15');
  const collected = collectVacationDays(events, [bugrov], { from: '2026-09-08', to: '2026-09-15' });

  const missing = new Map([['u1', ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']]]);
  const result = excludeVacationDays(missing, collected.daysByPerson);
  assert.deepEqual(result.missingDaysByUser.get('u1'), []);
});

test('закончившийся отпуск, пропавший из фида, остаётся в памяти', () => {
  const cached = cacheableEvents([
    uidEvent('a@g', '[vacation] Aleksandr Bugrov', '2026-09-01', '2026-09-15'),
  ]);
  const merged = mergeVacationEvents({ fresh: [], cached, today: '2026-09-17' });

  assert.equal(merged.remembered, 1);
  assert.equal(merged.cache.length, 1);
  const collected = collectVacationDays(merged.events, [bugrov], { from: '2026-09-08', to: '2026-09-17' });
  assert.ok(collected.daysByPerson.get('u1').has('2026-09-10'));
});

test('ещё не закончившийся отпуск, удалённый из календаря, забывается', () => {
  const cached = cacheableEvents([
    uidEvent('a@g', '[vacation] Aleksandr Bugrov', '2026-09-20', '2026-09-25'),
  ]);
  const merged = mergeVacationEvents({ fresh: [], cached, today: '2026-09-17' });

  assert.equal(merged.remembered, 0);
  assert.deepEqual(merged.cache, []);
});

test('подрезанный в календаре отпуск обновляется по UID, а не удваивается', () => {
  const cached = cacheableEvents([
    uidEvent('a@g', '[vacation] Aleksandr Bugrov', '2026-09-01', '2026-09-15'),
  ]);
  const fresh = [uidEvent('a@g', '[vacation] Aleksandr Bugrov', '2026-09-01', '2026-09-10')];
  const merged = mergeVacationEvents({ fresh, cached, today: '2026-09-17' });

  assert.equal(merged.remembered, 0);
  assert.deepEqual(merged.cache, [
    { uid: 'a@g', summary: '[vacation] Aleksandr Bugrov', start: '2026-09-01', end: '2026-09-10' },
  ]);
});

test('свежие события отдаются как есть — счётчики пропущенных не врут', () => {
  const fresh = [
    { summary: '[vacation] Anna Ivanova', allDay: false, start: '2026-09-16', end: '2026-09-17', recurring: false },
  ];
  const merged = mergeVacationEvents({ fresh, cached: [], today: '2026-09-17' });
  const collected = collectVacationDays(merged.events, [anna], { from: '2026-09-08', to: '2026-09-17' });

  assert.equal(collected.timedSkipped, 1);
  assert.deepEqual(merged.cache, []);
});

test('имя, исправленное в настройках, подхватывается и для запомненных отпусков', () => {
  const cached = cacheableEvents([uidEvent('a@g', '[отпуск] Бугров Александр', '2026-09-01', '2026-09-15')]);
  const events = rememberedVacationEvents(cached, '2026-09-17');
  const renamed = person('u1', 'Aleksandr Bugrov', 'Бугров Александр');

  const collected = collectVacationDays(events, [renamed], { from: '2026-09-08', to: '2026-09-17' });
  assert.ok(collected.daysByPerson.get('u1').has('2026-09-09'));
});

test('пустая или битая память никого не роняет', () => {
  assert.deepEqual(rememberedVacationEvents(null, '2026-09-17'), []);
  assert.deepEqual(rememberedVacationEvents([{ summary: 'X' }], '2026-09-17'), []);
  assert.deepEqual(mergeVacationEvents({ fresh: null, cached: null, today: '2026-09-17' }).cache, []);
});
