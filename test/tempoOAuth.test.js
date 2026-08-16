import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_BEFORE_MS,
  TEMPO_AUTHORIZE_URL,
  buildTempoAuthorizeUrl,
  checkPendingTempoConnect,
  expiresAtFrom,
  isTempoAuthError,
  needsRefresh,
  normalizeJiraUrl,
  tempoErrorHint,
} from '../src/backend/tempoOAuthState.js';

const CALLBACK = 'https://abc123.webtrigger.atlassian.app/public/token-value';
const JIRA = 'https://acme.atlassian.net';

/* ---------------------------------- ссылка ---------------------------------- */

test('ссылка на согласие несёт client_id, redirect_uri, адрес инстанса и state', () => {
  const url = new URL(
    buildTempoAuthorizeUrl({
      clientId: 'client-1',
      redirectUri: CALLBACK,
      jiraUrl: JIRA,
      state: 'nonce-1',
    })
  );

  assert.equal(url.origin + url.pathname, TEMPO_AUTHORIZE_URL);
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
  // Без jira_url Tempo не знает, чьи данные показывать на экране согласия.
  assert.equal(url.searchParams.get('jira_url'), JIRA);
  assert.equal(url.searchParams.get('state'), 'nonce-1');
});

test('ссылка не собирается без обязательных частей', () => {
  const complete = { clientId: 'client-1', redirectUri: CALLBACK, jiraUrl: JIRA, state: 'n' };
  assert.throws(() => buildTempoAuthorizeUrl({ ...complete, clientId: undefined }));
  assert.throws(() => buildTempoAuthorizeUrl({ ...complete, redirectUri: '' }));
  assert.throws(() => buildTempoAuthorizeUrl({ ...complete, jiraUrl: 'acme.atlassian.net' }));
  assert.throws(() => buildTempoAuthorizeUrl({ ...complete, jiraUrl: 'http://acme.atlassian.net' }));
});

test('адрес инстанса приводится к тому виду, в каком его сверяет Tempo', () => {
  assert.equal(normalizeJiraUrl('https://acme.atlassian.net/'), JIRA);
  assert.equal(normalizeJiraUrl('https://acme.atlassian.net/jira/software'), JIRA);
  // Собственный домен организации — такой же законный адрес инстанса.
  assert.equal(normalizeJiraUrl('https://jira.acme.com/'), 'https://jira.acme.com');
});

/* ------------------------- проверка начатого подключения ------------------------- */

const pending = (over = {}) => ({
  nonce: 'nonce-1',
  expiresAt: new Date('2026-08-16T12:10:00Z').toISOString(),
  ...over,
});
const before = new Date('2026-08-16T12:05:00Z');
const after = new Date('2026-08-16T12:11:00Z');

test('колбэк принимается, пока живо начатое подключение', () => {
  assert.equal(checkPendingTempoConnect(pending(), 'nonce-1', before).ok, true);
});

test('колбэк принимается и без state — Tempo не обещает его вернуть', () => {
  assert.equal(checkPendingTempoConnect(pending(), null, before).ok, true);
});

test('колбэк без начатого подключения отвергается', () => {
  // Веб-триггер анонимен: сюда приходит кто угодно, и это единственная преграда.
  assert.equal(checkPendingTempoConnect(null, 'nonce-1', before).ok, false);
  assert.equal(checkPendingTempoConnect(null, null, before).ok, false);
});

test('чужой и протухший state не принимаются', () => {
  assert.equal(checkPendingTempoConnect(pending(), 'nonce-2', before).ok, false);
  assert.equal(checkPendingTempoConnect(pending(), 'nonce-1', after).ok, false);
  assert.equal(checkPendingTempoConnect(pending({ expiresAt: 'мусор' }), 'nonce-1', before).ok, false);
});

test('у каждого отказа есть объяснение', () => {
  for (const result of [
    checkPendingTempoConnect(null, 'nonce-1', before),
    checkPendingTempoConnect(pending(), 'nonce-2', before),
    checkPendingTempoConnect(pending(), 'nonce-1', after),
  ]) {
    assert.ok(result.reason.length > 0, 'отказ без причины оставит администратора ни с чем');
  }
});

/* ------------------------------- срок жизни ------------------------------- */

const now = new Date('2026-08-16T12:00:00Z');

test('срок токена считается от момента выдачи', () => {
  // 5184000 секунд — то, что Tempo отдаёт в expires_in: шестьдесят дней.
  assert.equal(expiresAtFrom(5184000, now), new Date('2026-10-15T12:00:00Z').toISOString());
  // Ответ без срока или с мусором — не повод записать «истёк в 1970-м».
  assert.equal(expiresAtFrom(undefined, now), null);
  assert.equal(expiresAtFrom('скоро', now), null);
  assert.equal(expiresAtFrom(0, now), null);
});

test('токен обновляется заранее, а не в последний день', () => {
  const oauth = (expiresAt) => ({ method: 'oauth', expiresAt });
  const inDays = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(needsRefresh(oauth(inDays(30)), now), false);
  assert.equal(needsRefresh(oauth(inDays(3)), now), true);
  assert.equal(needsRefresh(oauth(inDays(-1)), now), true);
  // Неизвестный срок считаем истекающим: обмен дешевле упавшего прогона.
  assert.equal(needsRefresh(oauth(undefined), now), true);
});

test('вставленный руками токен не обновляется — обновлять его нечем', () => {
  assert.equal(needsRefresh({ method: 'token' }, now), false);
  assert.equal(needsRefresh(null, now), false);
});

test('запас на обновление больше суток: между прогонами токен протухнуть не должен', () => {
  assert.ok(REFRESH_BEFORE_MS > 24 * 60 * 60 * 1000);
});

/* ---------------------------------- ошибки ---------------------------------- */

test('известные ошибки OAuth объясняются словами, незнакомые — нет', () => {
  assert.match(tempoErrorHint('invalid_client'), /TEMPO_CLIENT_ID/);
  assert.match(tempoErrorHint('invalid_request'), /redirect/i);
  assert.equal(tempoErrorHint('something_new'), null);
  assert.equal(tempoErrorHint(undefined), null);
});

test('отказ в доступе отличается от прочих бед Tempo', () => {
  assert.equal(isTempoAuthError('Tempo 401: token rejected (check the Tempo API token)'), true);
  assert.equal(isTempoAuthError('Tempo 403: forbidden'), true);
  // Пятисотая и таймаут — это «Tempo сегодня не отвечает», подключение цело.
  assert.equal(isTempoAuthError('Tempo 500: gateway'), false);
  assert.equal(isTempoAuthError('Tempo 429: too many requests'), false);
  assert.equal(isTempoAuthError(undefined), false);
});
