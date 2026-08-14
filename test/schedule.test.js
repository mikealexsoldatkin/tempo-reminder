import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATCH_UP_MINUTES,
  dayParts,
  dueRunTimes,
  formatClock,
  nextRunTime,
  parseRunTimes,
} from '../src/backend/schedule.js';
import { isWeekend } from '../src/backend/workdays.js';

/* ------------------------------ разбор ввода ------------------------------ */

test('времена приводятся к HH:MM, сортируются и дедуплицируются', () => {
  assert.deepEqual(parseRunTimes('9, 15:30, 09:00').times, ['09:00', '15:30']);
  assert.deepEqual(parseRunTimes('18:05\n7').times, ['07:00', '18:05']);
  assert.deepEqual(parseRunTimes(['15:00', '09:00']).times, ['09:00', '15:00']);
});

test('пустой ввод — это пустое расписание, а не ошибка', () => {
  assert.deepEqual(parseRunTimes('').times, []);
  assert.deepEqual(parseRunTimes(null).times, []);
  assert.deepEqual(parseRunTimes('').invalid, []);
});

test('непонятые куски возвращаются отдельно, а не подменяются дефолтом', () => {
  const { times, invalid } = parseRunTimes('09:00, 25:00, полдень, 12:60');
  assert.deepEqual(times, ['09:00']);
  assert.deepEqual(invalid, ['25:00', 'полдень', '12:60']);
});

/* --------------------------- момент → сутки (UTC) --------------------------- */

test('момент времени раскладывается на дату и минуты с начала суток', () => {
  assert.deepEqual(dayParts(new Date('2026-08-14T07:20:00Z')), {
    date: '2026-08-14',
    minutes: 7 * 60 + 20,
  });
  assert.deepEqual(dayParts(new Date('2026-08-14T23:59:00Z')), {
    date: '2026-08-14',
    minutes: 23 * 60 + 59,
  });
});

test('полночь — это 00:00 следующих суток, а не 24:00 предыдущих', () => {
  assert.deepEqual(dayParts(new Date('2026-08-15T00:00:00Z')), {
    date: '2026-08-15',
    minutes: 0,
  });
  assert.equal(formatClock(0), '00:00');
});

test('местное время рантайма на расклад не влияет', () => {
  // Момент задан в UTC явно, поэтому результат не зависит от TZ процесса.
  assert.equal(dayParts(new Date(Date.UTC(2026, 7, 14, 3, 5))).date, '2026-08-14');
  assert.equal(dayParts(new Date(Date.UTC(2026, 7, 14, 3, 5))).minutes, 3 * 60 + 5);
});

/* --------------------------- наступившие слоты --------------------------- */

const times = ['09:00', '15:00'];

test('слот наступает, когда его время прошло', () => {
  assert.deepEqual(dueRunTimes({ runTimes: times, nowMinutes: 8 * 60 + 59 }), []);
  assert.deepEqual(dueRunTimes({ runTimes: times, nowMinutes: 9 * 60 }), ['09:00']);
  assert.deepEqual(dueRunTimes({ runTimes: times, nowMinutes: 9 * 60 + 47 }), ['09:00']);
});

test('слот сгорает, если триггер опоздал больше чем на окно догона', () => {
  const late = 9 * 60 + CATCH_UP_MINUTES + 1;
  assert.deepEqual(dueRunTimes({ runTimes: times, nowMinutes: late }), []);
});

test('уже отработавший слот повторно не наступает', () => {
  assert.deepEqual(
    dueRunTimes({ runTimes: times, nowMinutes: 9 * 60 + 30, handledTimes: ['09:00'] }),
    []
  );
});

test('пропущенный час отдаёт оба слота сразу — прогон один, закрываются оба', () => {
  const due = dueRunTimes({
    runTimes: ['14:00', '15:00'],
    nowMinutes: 15 * 60 + 10,
    catchUpMinutes: CATCH_UP_MINUTES,
  });
  assert.deepEqual(due, ['14:00', '15:00']);
});

/* --------------------------- ближайший запуск --------------------------- */

// Какие дни пропускать, решает вызывающий: здесь — выходные, как при включённой
// настройке skipWeekends.
const skipWeekends = (day) => isWeekend(day);

test('ближайший запуск — следующий слот в тех же сутках', () => {
  assert.deepEqual(
    nextRunTime({ runTimes: times, isSkippedDay: skipWeekends, today: '2026-08-13', nowMinutes: 10 * 60 }),
    { date: '2026-08-13', time: '15:00' }
  );
});

test('после последнего слота ближайший запуск переезжает на следующий рабочий день', () => {
  // 14.08.2026 — пятница, значит следующий запуск в понедельник 17-го.
  assert.deepEqual(
    nextRunTime({ runTimes: times, isSkippedDay: skipWeekends, today: '2026-08-14', nowMinutes: 20 * 60 }),
    { date: '2026-08-17', time: '09:00' }
  );
});

test('в выходной ближайший запуск не назначается на тот же день', () => {
  assert.deepEqual(
    nextRunTime({ runTimes: times, isSkippedDay: skipWeekends, today: '2026-08-15', nowMinutes: 6 * 60 }),
    { date: '2026-08-17', time: '09:00' }
  );
  // А без пропуска выходных — назначается.
  assert.deepEqual(
    nextRunTime({ runTimes: times, today: '2026-08-15', nowMinutes: 6 * 60 }),
    { date: '2026-08-15', time: '09:00' }
  );
});

test('праздник тоже пропускается — запуск переезжает через него', () => {
  // Пятница 3 июля 2026 объявлена нерабочей: ближайший запуск — понедельник 6-го.
  const skipped = (day) => isWeekend(day) || day === '2026-07-03';
  assert.deepEqual(
    nextRunTime({ runTimes: times, isSkippedDay: skipped, today: '2026-07-02', nowMinutes: 20 * 60 }),
    { date: '2026-07-06', time: '09:00' }
  );
});

test('пустое расписание не имеет ближайшего запуска', () => {
  assert.equal(
    nextRunTime({ runTimes: [], isSkippedDay: skipWeekends, today: '2026-08-14', nowMinutes: 0 }),
    null
  );
});
