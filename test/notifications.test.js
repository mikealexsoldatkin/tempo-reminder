import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countManagedPeople,
  countWithoutManager,
  groupByManager,
  renderManagerAllClearMessage,
  renderManagerMessage,
  renderUserMessage,
} from '../src/backend/notifications.js';

const person = (accountId, displayName, managerIds = []) => ({ accountId, displayName, managerIds });

const anna = person('u1', 'Anna Ivanova', ['m1']);
const boris = person('u2', 'Boris Petrov', ['m1', 'm2']);
const clara = person('u3', 'Clara Sidorova');

const managers = [person('m1', 'Maria Head'), person('m2', 'Nikolai Lead'), person('m3', 'Olga Chief')];

const window = { from: '2026-08-12', to: '2026-08-14' };

/* ------------------------------ группировка ------------------------------ */

test('каждый менеджер получает своих подчинённых', () => {
  const groups = groupByManager([anna, boris], managers);
  assert.deepEqual(
    groups.map(({ manager, people }) => [manager.accountId, people.map((p) => p.accountId)]),
    [
      ['m1', ['u1', 'u2']],
      ['m2', ['u2']],
    ]
  );
});

test('менеджер без не отчитавшихся подчинённых в результат не попадает', () => {
  const groups = groupByManager([anna], managers);
  assert.deepEqual(groups.map(({ manager }) => manager.accountId), ['m1']);
});

test('сотрудник без менеджера не попадает никуда и считается отдельно', () => {
  assert.deepEqual(groupByManager([clara], managers), []);
  assert.equal(countWithoutManager([anna, boris, clara]), 1);
  assert.equal(countWithoutManager([anna, boris]), 0);
});

test('пустой список менеджеров не ломает группировку', () => {
  assert.deepEqual(groupByManager([anna, boris], []), []);
});

test('размер команды считается по всем отслеживаемым, а не по должникам', () => {
  const counts = countManagedPeople([anna, boris, clara]);
  assert.equal(counts.get('m1'), 2);
  assert.equal(counts.get('m2'), 1);
  assert.equal(counts.get('m3'), undefined);
});

/* -------------------------------- шаблоны -------------------------------- */

test('в напоминании сотруднику подставляются имя, окно и пропущенные дни', () => {
  const text = renderUserMessage(
    'Hi {name}, {missingCount} days missing ({missing}) out of {days} from {from} to {to}',
    { user: anna, missingDays: ['2026-08-12', '2026-08-13'], window, lookbackWorkingDays: 3 }
  );
  assert.equal(
    text,
    'Hi Anna, 2 days missing (2026-08-12, 2026-08-13) out of 3 from 2026-08-12 to 2026-08-14'
  );
});

test('в дайджесте менеджеру у каждого подчинённого свои пропущенные дни', () => {
  const text = renderManagerMessage('{name}: {count} people\n{list}\nwindow {from}—{to}', {
    manager: managers[0],
    people: [anna, boris],
    missingDaysByUser: new Map([
      ['u1', ['2026-08-12']],
      ['u2', ['2026-08-12', '2026-08-13']],
    ]),
    window,
    lookbackWorkingDays: 2,
  });
  assert.equal(
    text,
    'Maria: 2 people\n• Anna Ivanova — 2026-08-12\n• Boris Petrov — 2026-08-12, 2026-08-13\n' +
      'window 2026-08-12—2026-08-14'
  );
});

test('в сообщении «все отчитались» счётчик — это размер команды', () => {
  const text = renderManagerAllClearMessage('{name}: all {count} logged time, {from}—{to}', {
    manager: managers[0],
    managedCount: 4,
    window,
    lookbackWorkingDays: 2,
  });
  assert.equal(text, 'Maria: all 4 logged time, 2026-08-12—2026-08-14');
});

test('{list} в сообщении «все отчитались» остаётся как есть — списка должников нет', () => {
  const text = renderManagerAllClearMessage('{name}: {list}', {
    manager: managers[0],
    managedCount: 0,
    window,
    lookbackWorkingDays: 2,
  });
  assert.equal(text, 'Maria: {list}');
});

test('плейсхолдер, пришедший из данных, повторно не подставляется', () => {
  // Имя вида «{days}» не должно превратиться в число на следующем проходе.
  const text = renderUserMessage('Hi {name}, {days} days', {
    user: person('u9', '{days} Smith'),
    missingDays: [],
    window,
    lookbackWorkingDays: 3,
  });
  assert.equal(text, 'Hi {days}, 3 days');
});

test('неизвестный плейсхолдер остаётся в тексте как есть', () => {
  const text = renderUserMessage('Hi {name}, {unknown}', {
    user: anna,
    missingDays: [],
    window,
    lookbackWorkingDays: 2,
  });
  assert.equal(text, 'Hi Anna, {unknown}');
});
