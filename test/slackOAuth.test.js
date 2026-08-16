import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLACK_SCOPES,
  buildAuthorizeUrl,
  checkPendingConnect,
  decodeState,
  encodeState,
  isForgeCallbackUrl,
  isRevokedTokenError,
  slackErrorHint,
} from '../src/backend/slackOAuthState.js';

const CALLBACK = 'https://abc123.webtrigger.atlassian.app/public/token-value';

/* ------------------------------- адрес возврата ------------------------------- */

test('адресом возврата признаются только веб-триггеры Forge', () => {
  assert.equal(isForgeCallbackUrl(CALLBACK), true);
  assert.equal(isForgeCallbackUrl('https://abc.hello.atlassian-dev.net/x1/token'), true);
  // Чужой домен, http вместо https и домен-обманка — всё это не адрес установки.
  assert.equal(isForgeCallbackUrl('https://evil.example.com/public/x'), false);
  assert.equal(isForgeCallbackUrl('http://abc.webtrigger.atlassian.app/public/x'), false);
  assert.equal(isForgeCallbackUrl('https://webtrigger.atlassian.app.evil.com/public/x'), false);
  assert.equal(isForgeCallbackUrl('not a url'), false);
});

/* ----------------------------------- state ----------------------------------- */

test('state переживает дорогу через Slack без потерь', () => {
  const state = encodeState({ callbackUrl: CALLBACK, nonce: 'nonce-1' });
  assert.deepEqual(decodeState(state), { callbackUrl: CALLBACK, nonce: 'nonce-1' });
});

test('state безопасен в URL: только base64url без спецсимволов', () => {
  const state = encodeState({ callbackUrl: CALLBACK, nonce: 'nonce-1' });
  assert.match(state, /^[A-Za-z0-9_-]+$/);
});

test('state с чужим адресом возврата не собирается и не разбирается', () => {
  assert.throws(() => encodeState({ callbackUrl: 'https://evil.example.com/x', nonce: 'n' }));
  // Собранный вручную state с чужим адресом — попытка увести код подключения.
  const forged = Buffer.from(JSON.stringify({ cb: 'https://evil.example.com/x', n: 'n' })).toString(
    'base64url'
  );
  assert.throws(() => decodeState(forged), /malformed/);
});

test('битый state — это ошибка подключения, а не падение', () => {
  for (const raw of [undefined, '', 'not-base64!!', Buffer.from('{}').toString('base64url')]) {
    assert.throws(() => decodeState(raw), /malformed/);
  }
});

/* --------------------------------- ссылка --------------------------------- */

test('ссылка на согласие несёт client_id, scope, redirect_uri и state', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: '123.456',
      redirectUri: 'https://example.github.io/tempo-reminder/slack-callback/',
      state: 'state-value',
    })
  );

  assert.equal(url.origin + url.pathname, 'https://slack.com/oauth/v2/authorize');
  assert.equal(url.searchParams.get('client_id'), '123.456');
  assert.equal(url.searchParams.get('scope'), SLACK_SCOPES.join(','));
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://example.github.io/tempo-reminder/slack-callback/'
  );
  assert.equal(url.searchParams.get('state'), 'state-value');
  // Пользовательский токен не запрашивается — приложение всё делает ботом.
  assert.equal(url.searchParams.has('user_scope'), false);
});

test('приложение просит ровно то, что ему нужно для рассылки', () => {
  assert.deepEqual(SLACK_SCOPES, ['chat:write', 'users:read', 'users:read.email']);
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
  assert.equal(checkPendingConnect(pending(), 'nonce-1', before).ok, true);
});

test('колбэк без начатого подключения отвергается', () => {
  // Веб-триггер анонимен: сюда приходит кто угодно, и это единственная преграда.
  assert.equal(checkPendingConnect(null, 'nonce-1', before).ok, false);
});

test('чужой и протухший nonce не принимаются', () => {
  assert.equal(checkPendingConnect(pending(), 'nonce-2', before).ok, false);
  assert.equal(checkPendingConnect(pending(), 'nonce-1', after).ok, false);
  assert.equal(checkPendingConnect(pending({ expiresAt: 'какой-то мусор' }), 'nonce-1', before).ok, false);
});

test('у каждого отказа есть объяснение', () => {
  for (const result of [
    checkPendingConnect(null, 'nonce-1', before),
    checkPendingConnect(pending(), 'nonce-2', before),
    checkPendingConnect(pending(), 'nonce-1', after),
  ]) {
    assert.ok(result.reason.length > 0, 'отказ без причины оставит администратора ни с чем');
  }
});

/* ---------------------------------- ошибки ---------------------------------- */

test('известные ошибки Slack объясняются словами, незнакомые — нет', () => {
  assert.match(slackErrorHint('bad_redirect_uri'), /Redirect URLs/);
  assert.equal(slackErrorHint('something_new'), null);
});

test('отзыв токена отличается от прочих ошибок Slack', () => {
  assert.equal(isRevokedTokenError('token_revoked'), true);
  assert.equal(isRevokedTokenError('account_inactive'), true);
  // Человека нет в Slack — это про одного получателя, а не про подключение.
  assert.equal(isRevokedTokenError('users_not_found'), false);
  assert.equal(isRevokedTokenError(undefined), false);
});
