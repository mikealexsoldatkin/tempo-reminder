import assert from 'node:assert/strict';
import test from 'node:test';
import { eventDays, parseIcs } from '../src/backend/ics.js';

const feed = (...lines) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Americor vacations', ...lines, 'END:VCALENDAR'].join('\r\n');

const vevent = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

/* ------------------------------ разбор ------------------------------ */

test('событие на весь день: DTEND исключительный, как в формате', () => {
  const { events, calendarName } = parseIcs(
    feed(
      ...vevent(
        'UID:abc@google.com',
        'SUMMARY:[vacation] Aleksandr Bugrov',
        'DTSTART;VALUE=DATE:20260810',
        'DTEND;VALUE=DATE:20260815'
      )
    )
  );

  assert.equal(calendarName, 'Americor vacations');
  assert.deepEqual(events, [
    {
      uid: 'abc@google.com',
      summary: '[vacation] Aleksandr Bugrov',
      allDay: true,
      start: '2026-08-10',
      end: '2026-08-15',
      recurring: false,
    },
  ]);
});

test('однодневный отпуск без DTEND занимает один день', () => {
  const { events } = parseIcs(
    feed(...vevent('SUMMARY:[dayoff] Anna Ivanova', 'DTSTART;VALUE=DATE:20260812'))
  );
  assert.equal(events[0].end, '2026-08-13');
  assert.deepEqual(eventDays(events[0], { from: '2026-08-01', to: '2026-08-31' }), ['2026-08-12']);
});

test('перенесённая строка склеивается — имя в заголовке не рвётся', () => {
  const { events } = parseIcs(
    feed(
      ...vevent(
        'SUMMARY:[vacation] Aleksandr',
        // Сворачивание добавляет к строке продолжения свой пробел, поэтому пробел
        // из самого заголовка приезжает вторым: снимаем ровно один.
        '  Bugrov',
        'DTSTART;VALUE=DATE:20260810',
        'DTEND;VALUE=DATE:20260811'
      )
    )
  );
  assert.equal(events[0].summary, '[vacation] Aleksandr Bugrov');
});

test('экранированные символы в SUMMARY разворачиваются', () => {
  const { events } = parseIcs(
    feed(...vevent('SUMMARY:[vacation] Ann Lee\\, Bob Ray\\; PTO', 'DTSTART;VALUE=DATE:20260810'))
  );
  assert.equal(events[0].summary, '[vacation] Ann Lee, Bob Ray; PTO');
});

test('отменённые события не возвращаются, но считаются', () => {
  const { events, cancelled } = parseIcs(
    feed(
      ...vevent('SUMMARY:[vacation] Anna Ivanova', 'DTSTART;VALUE=DATE:20260810', 'STATUS:CANCELLED'),
      ...vevent('SUMMARY:[vacation] Boris Petrov', 'DTSTART;VALUE=DATE:20260810', 'STATUS:CONFIRMED')
    )
  );
  assert.equal(cancelled, 1);
  assert.deepEqual(events.map((e) => e.summary), ['[vacation] Boris Petrov']);
});

test('VALARM внутри события не закрывает его и не подменяет свойства', () => {
  const { events } = parseIcs(
    feed(
      ...vevent(
        'SUMMARY:[vacation] Anna Ivanova',
        'DTSTART;VALUE=DATE:20260810',
        'DTEND;VALUE=DATE:20260812',
        'BEGIN:VALARM',
        'TRIGGER:-PT30M',
        'SUMMARY:Reminder',
        'END:VALARM'
      )
    )
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, '[vacation] Anna Ivanova');
  assert.equal(events[0].end, '2026-08-12');
});

test('событие со временем отмечается как не-all-day', () => {
  const { events } = parseIcs(
    feed(
      ...vevent(
        'SUMMARY:Standup',
        'DTSTART;TZID=Europe/Lisbon:20260810T090000',
        'DTEND;TZID=Europe/Lisbon:20260810T091500'
      )
    )
  );
  assert.equal(events[0].allDay, false);
  assert.deepEqual(eventDays(events[0], { from: '2026-08-01', to: '2026-08-31' }), []);
});

test('RRULE отмечается, чтобы такое событие можно было не потерять молча', () => {
  const { events } = parseIcs(
    feed(
      ...vevent(
        'SUMMARY:[dayoff] Anna Ivanova',
        'DTSTART;VALUE=DATE:20260810',
        'RRULE:FREQ=WEEKLY;BYDAY=FR'
      )
    )
  );
  assert.equal(events[0].recurring, true);
});

test('параметр в кавычках с двоеточием не сбивает разбор строки', () => {
  const { events } = parseIcs(
    feed(...vevent('SUMMARY;X-NOTE="a:b":[vacation] Anna Ivanova', 'DTSTART;VALUE=DATE:20260810'))
  );
  assert.equal(events[0].summary, '[vacation] Anna Ivanova');
});

test('мусор вместо фида не роняет парсер', () => {
  assert.deepEqual(parseIcs('<html lang="en">login</html>').events, []);
  assert.deepEqual(parseIcs('').events, []);
  assert.deepEqual(parseIcs(undefined).events, []);
});

/* --------------------------- дни события --------------------------- */

const vacation = { allDay: true, start: '2026-08-10', end: '2026-08-15' };

test('дни отпуска — от DTSTART до DTEND, последний день не входит', () => {
  assert.deepEqual(eventDays(vacation, { from: '2026-08-01', to: '2026-08-31' }), [
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
  ]);
});

test('дни обрезаются по окну с обеих сторон', () => {
  assert.deepEqual(eventDays(vacation, { from: '2026-08-12', to: '2026-08-13' }), [
    '2026-08-12',
    '2026-08-13',
  ]);
});

test('отпуск целиком вне окна не даёт дней', () => {
  assert.deepEqual(eventDays(vacation, { from: '2026-09-01', to: '2026-09-30' }), []);
  assert.deepEqual(eventDays(vacation, { from: '2026-07-01', to: '2026-07-31' }), []);
});
