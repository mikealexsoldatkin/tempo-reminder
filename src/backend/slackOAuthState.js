/**
 * Чистая часть подключения Slack по OAuth: сборка ссылки на экран согласия,
 * упаковка `state` и проверки, которым не нужны ни Forge, ни сеть. Всё, что
 * ходит в KVS и в Slack, лежит в slackOAuth.js — так эти правила проверяются
 * обычными тестами (test/slackOAuth.test.js), без запущенного приложения.
 */

/**
 * Минимально необходимый набор прав: найти человека по email и написать ему в
 * личку. Лишние scope режут на ревью Slack в первую очередь, а добавить их
 * позже можно без потери установок — администратор увидит экран повторного
 * согласия. `im:write` здесь нет намеренно: chat.postMessage открывает личку
 * с ботом сам, по одному лишь chat:write.
 */
export const SLACK_SCOPES = ['chat:write', 'users:read', 'users:read.email'];

export const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
export const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

/**
 * Сколько живёт начатое подключение. Администратор за это время должен выбрать
 * workspace и нажать Allow; всё, что дольше, — почти наверняка брошенная вкладка,
 * и разрешать по ней запись токена не за чем.
 */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Куда странице-переходнику разрешено вернуть браузер: только на веб-триггеры
 * Forge. v2 — текущий формат адреса, v1 остаётся у окружений, созданных раньше.
 *
 * Проверка нужна и здесь, и в самой странице (docs/slack-callback/index.html):
 * `state` приходит из браузера, и без ограничения по домену страница
 * превратилась бы в открытый редиректор.
 */
export const CALLBACK_HOST_SUFFIXES = ['.webtrigger.atlassian.app', '.atlassian-dev.net'];

/** Адрес веб-триггера этой установки — единственное, куда можно отдать `code`. */
export function isForgeCallbackUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return CALLBACK_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
}

/**
 * `state` едет через Slack и страницу-переходник в открытом виде, поэтому в нём
 * лежит только то, что и так не секрет: куда вернуться и одноразовый nonce.
 * Подписывать его нечем и незачем — доказательством, что подключение начал
 * администратор, служит сам nonce: он рождается на бэкенде, лежит в KVS и
 * сгорает после первой же проверки.
 */
export function encodeState({ callbackUrl, nonce }) {
  if (!isForgeCallbackUrl(callbackUrl)) throw new Error(`Not a Forge web trigger URL: ${callbackUrl}`);
  if (!nonce) throw new Error('nonce is required');
  return Buffer.from(JSON.stringify({ cb: callbackUrl, n: nonce }), 'utf8').toString('base64url');
}

/** Разбор `state`, пришедшего с колбэка. Любой мусор — это ошибка подключения, а не падение. */
export function decodeState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(raw ?? ''), 'base64url').toString('utf8'));
  } catch {
    throw new Error('The state parameter is malformed');
  }
  if (!parsed?.n || !isForgeCallbackUrl(parsed?.cb)) {
    throw new Error('The state parameter is malformed');
  }
  return { callbackUrl: parsed.cb, nonce: String(parsed.n) };
}

/**
 * Ссылка на экран согласия Slack. redirect_uri обязан совпадать с одним из
 * зарегистрированных в настройках Slack-приложения — адрес веб-триггера туда не
 * вписать (он свой у каждой установки), поэтому Slack всегда возвращает браузер
 * на статическую страницу, а она уже пересылает `code` на веб-триггер.
 */
export function buildAuthorizeUrl({ clientId, redirectUri, state, scopes = SLACK_SCOPES }) {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', scopes.join(','));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  // user_scope не передаём: пользовательский токен приложению не нужен, пишет и
  // ищет людей бот. Пустой параметр Slack всё равно показал бы на экране согласия.
  return url.toString();
}

/**
 * Совпадает ли пришедший колбэк с начатым подключением. Отдельная функция, а не
 * пара `if` в обработчике: это единственная защита анонимного веб-триггера, и
 * её правила должны быть видны целиком.
 *
 * @param {{nonce: string, expiresAt: string}|null} pending что лежит в KVS
 * @param {string} nonce что приехало в state
 * @param {Date} now
 */
export function checkPendingConnect(pending, nonce, now = new Date()) {
  if (!pending?.nonce) {
    return { ok: false, reason: 'No Slack connection was started from this Jira site — open the app settings and press “Connect Slack”.' };
  }
  if (pending.nonce !== nonce) {
    return { ok: false, reason: 'This link belongs to a different connection attempt — start again from the app settings.' };
  }
  if (!(Date.parse(pending.expiresAt) > now.getTime())) {
    return { ok: false, reason: 'The connection link has expired — start again from the app settings.' };
  }
  return { ok: true, reason: null };
}

/**
 * Коды ошибок Slack, о которых есть что сказать сверх самого кода: администратор
 * читает эту строку вместо «bad_redirect_uri» и должен понимать, что чинить.
 */
const SLACK_ERROR_HINTS = {
  access_denied: 'You cancelled the installation in Slack. Nothing was changed.',
  invalid_code: 'The authorization code is no longer valid — start the connection again.',
  bad_redirect_uri:
    'Slack rejected the redirect URL. The address in SLACK_REDIRECT_URI must be listed in the Slack app under OAuth & Permissions → Redirect URLs.',
  invalid_client_id: 'Slack does not recognise the client id — check the SLACK_CLIENT_ID variable.',
  invalid_client_secret: 'Slack rejected the client secret — check the SLACK_CLIENT_SECRET variable.',
  invalid_grant_type: 'Slack rejected the grant type — the app is asking for the wrong OAuth flow.',
  team_not_authorized: 'This Slack workspace has not authorized the app.',
};

export function slackErrorHint(error) {
  return SLACK_ERROR_HINTS[error] ?? null;
}

/**
 * Ошибки Slack, означающие «токена больше нет»: приложение удалили из workspace,
 * токен отозвали, аккаунт бота отключили. Их видно только на прогоне — событий
 * Slack приложение не слушает (для этого нужен сервер), поэтому подключение
 * помечается разорванным по первому такому ответу.
 */
const REVOKED_ERRORS = new Set(['token_revoked', 'invalid_auth', 'account_inactive', 'not_authed']);

export function isRevokedTokenError(error) {
  return REVOKED_ERRORS.has(String(error ?? ''));
}
