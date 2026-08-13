import assert from 'node:assert/strict';
import test from 'node:test';
import { projectScopedRoles } from '../src/backend/jira.js';

const role = (roleName, scope = null) => ({ roleName, actors: [], scope });

test('у team-managed проекта берём только собственные роли, общие отбрасываем', () => {
  const details = [
    role('Administrators'), // общая роль инстанса
    role('Developers'),
    role('Member', { type: 'PROJECT', project: { id: '10001' } }),
    role('Administrator', { type: 'PROJECT', project: { id: '10001' } }),
  ];

  assert.deepEqual(
    projectScopedRoles(details).map((r) => r.roleName),
    ['Member', 'Administrator']
  );
});

test('у company-managed проекта своих ролей нет — берём все, это и есть People', () => {
  const details = [role('Administrators'), role('Developers'), role('Service Desk Team')];

  assert.deepEqual(
    projectScopedRoles(details).map((r) => r.roleName),
    ['Administrators', 'Developers', 'Service Desk Team']
  );
});

test('роли с scope.type TEMPLATE не считаются проектными', () => {
  const details = [role('Template role', { type: 'TEMPLATE' }), role('Developers')];

  assert.deepEqual(
    projectScopedRoles(details).map((r) => r.roleName),
    ['Template role', 'Developers']
  );
});

test('нечитаемая роль (scope null) не проходит фильтр проектных ролей', () => {
  const details = [
    role('Broken'), // упала при чтении, scope неизвестен
    role('Member', { type: 'PROJECT', project: { id: '10001' } }),
  ];

  assert.deepEqual(
    projectScopedRoles(details).map((r) => r.roleName),
    ['Member']
  );
});
