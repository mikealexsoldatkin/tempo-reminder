/**
 * Чистая часть подключения Tempo по OAuth: адреса, сборка ссылки на экран
 * согласия, арифметика срока жизни токена и проверки колбэка. Всё, что ходит в
 * KVS и в Tempo, лежит в tempoOAuth.js — так эти правила проверяются обычными
 * тестами (test/tempoOAuth.test.js), без запущенного приложения.
 *
 * Слак-версия этого файла (slackOAuthState.js) рядом, и общего у них меньше, чем
 * кажется: у Tempo нет scope'ов, зато есть срок жизни токена, ротация refresh'а и
 * свой набор ошибок. Сводить их в один модуль пришлось бы через параметры на
 * каждое отличие — читать стало бы тяжелее обоих.
 */

/**
 * Рекомендованный Tempo адрес: он сам решает, куда отправить браузер — на старый
 * экран согласия Atlassian Connect или на новый, форджевый. Прежний адрес вида
 * `https://{site}.atlassian.net/plugins/servlet/ac/io.tempo.jira/oauth-authorize/`
 * ещё работает, но помечен в документации как подлежащий выключению после
 * миграции Tempo на Forge.
 */
export const TEMPO_AUTHORIZE_URL = 'https://api.tempo.io/oauth/authorize/redirect';
export const TEMPO_TOKEN_URL = 'https://api.tempo.io/oauth/token/';
export const TEMPO_REVOKE_URL = 'https://api.tempo.io/oauth/revoke_token/';

/**
 * Раздел настроек Tempo, где заводится OAuth-приложение, — сразу нужная вкладка,
 * без блужданий по меню. Хост у каждого свой, путь — общий.
 *
 * Два UUID в пути — это id приложения Tempo и id его окружения на Forge, а не
 * что-то, свойственное конкретной Jira: у приложения из Marketplace они одни на
 * все установки, поэтому путь можно держать константой. Прежний адрес
 * Connect-сервлета (`/plugins/servlet/ac/io.tempo.jira/tempo-app#!/configuration`)
 * ещё работает, но приводит в корень настроек и редиректом — Tempo переехала на
 * Forge, и вкладка `identity-service` живёт уже по этому адресу.
 *
 * Если Tempo однажды сменит окружение и ссылка приведёт в никуда, мастер от этого
 * не развалится: шаги называют раздел словами, и найти его по меню можно и так.
 */
export const TEMPO_OAUTH_APPS_PATH =
  '/jira/apps/fa75e928-007a-4af4-9530-76503bcd4cba/ea7fda46-2015-4367-bd93-992fbf0c58ca/configuration/identity-service';

/**
 * Чьи реквизиты OAuth-приложения Tempo брать.
 *
 * Их два источника, и это не дублирование, а два разных способа поставить
 * приложение. `installation` — приложение, заведённое админом в своём Tempo:
 * иначе никак, потому что OAuth-приложение Tempo принадлежит инстансу, где его
 * создали, и вендорское значение чужому клиенту просто не подойдёт («Invalid
 * client id»). `deployment` — переменные окружения сборки: так живёт своя сборка
 * и так же ляжет вендорский клиент, если Tempo его когда-нибудь выдаст.
 *
 * Пара берётся только целиком. Половина от одного приложения с половиной от
 * другого дала бы `invalid_client` в момент обмена кода — то есть после того, как
 * админ уже прошёл экран согласия, и в месте, где причину не видно.
 */
export function pickTempoOAuthClient({ stored, deployment } = {}) {
  const whole = (source) => {
    const clientId = String(source?.clientId ?? '').trim();
    const clientSecret = String(source?.clientSecret ?? '').trim();
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  };

  const installation = whole(stored);
  if (installation) return { ...installation, available: true, source: 'installation' };
  const vendor = whole(deployment);
  if (vendor) return { ...vendor, available: true, source: 'deployment' };
  return { clientId: null, clientSecret: null, available: false, source: null };
}

/**
 * Сколько живёт начатое подключение: администратор за это время должен нажать
 * Authorize. Всё, что дольше, — брошенная вкладка, и записывать по ней токен не за чем.
 */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * За сколько до конца срока обновляем токен. Tempo выдаёт access на 60 дней
 * (`expires_in: 5184000`), так что неделя запаса — это примерно «обновимся на
 * ближайшем же прогоне»: рассылка ходит ежедневно, и попасть в окно, где токен
 * протух между двумя прогонами, невозможно даже с недельным отпуском расписания.
 */
export const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Ссылка на экран согласия Tempo.
 *
 * `jira_url` обязателен: Tempo принимает согласие не «вообще», а против
 * конкретного инстанса Jira — по нему он и находит, чьи данные показывать.
 * `redirect_uri` обязан совпадать с одним из зарегистрированных в OAuth-приложении
 * Tempo; в отличие от Slack, промежуточная страница здесь не нужна и невозможна —
 * см. комментарий про `state` в checkPendingTempoConnect.
 */
export function buildTempoAuthorizeUrl({ clientId, redirectUri, jiraUrl, state }) {
  if (!clientId) throw new Error('client id is required');
  if (!redirectUri) throw new Error('redirect uri is required');
  const site = normalizeJiraUrl(jiraUrl);

  const url = new URL(TEMPO_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('jira_url', site);
  // `state` документацией Tempo не обещан — вернётся, и хорошо: тогда колбэк
  // проверяется строго. Не вернётся — проверка обопрётся на начатое подключение.
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/** Адрес инстанса без хвостового слэша и без пути: Tempo сверяет его как строку. */
export function normalizeJiraUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error(`Not a Jira site URL: ${value}`);
  }
  if (url.protocol !== 'https:') throw new Error(`Not a Jira site URL: ${value}`);
  return url.origin;
}

/**
 * Совпадает ли пришедший колбэк с начатым подключением.
 *
 * У Slack та же проверка держится на одноразовом nonce в `state`. Tempo в
 * документации обещает вернуть на redirect_uri только `code`, поэтому здесь nonce
 * — уточнение, а не основание: если `state` доехал, он обязан сойтись; если нет,
 * единственной преградой остаётся сам факт начатого подключения и его срок.
 *
 * Этого достаточно ровно потому, что адрес веб-триггера Forge сам по себе секрет
 * (в нём случайный токен) и живёт он у каждой установки свой: чтобы дойти сюда,
 * нужно знать адрес и попасть в те десять минут, пока администратор подключается.
 *
 * @param {{nonce: string, expiresAt: string}|null} pending что лежит в KVS
 * @param {string|null} nonce что приехало в state (null — Tempo его не вернул)
 * @param {Date} now
 */
export function checkPendingTempoConnect(pending, nonce, now = new Date()) {
  if (!pending?.nonce) {
    return {
      ok: false,
      reason:
        'No Tempo connection was started from this Jira site — open the app settings and press “Connect Tempo”.',
    };
  }
  if (nonce && pending.nonce !== nonce) {
    return {
      ok: false,
      reason: 'This link belongs to a different connection attempt — start again from the app settings.',
    };
  }
  if (!(Date.parse(pending.expiresAt) > now.getTime())) {
    return { ok: false, reason: 'The connection link has expired — start again from the app settings.' };
  }
  return { ok: true, reason: null };
}

/** Момент, когда выданный токен перестанет работать. */
export function expiresAtFrom(expiresIn, now = new Date()) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/**
 * Пора ли обновлять токен. Неизвестный срок считаем истекающим: лучше лишний
 * обмен refresh'а, чем прогон, упавший на 401 посреди рассылки.
 */
export function needsRefresh(connection, now = new Date()) {
  if (connection?.method !== 'oauth') return false;
  const expiresAt = Date.parse(connection.expiresAt ?? '');
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - now.getTime() <= REFRESH_BEFORE_MS;
}

/**
 * Коды ошибок OAuth, о которых есть что сказать сверх самого кода: администратор
 * читает эту строку вместо «invalid_grant» и должен понимать, что чинить.
 */
const TEMPO_ERROR_HINTS = {
  access_denied: 'You denied access on the Tempo screen. Nothing was changed.',
  invalid_grant:
    'Tempo rejected the authorization code or the refresh token — it was already used or has expired. Start the connection again.',
  invalid_client:
    'Tempo does not recognise this OAuth application. Most often it was created in a different Jira site’s Tempo — the application has to live in the Tempo of this very site — or its client secret was copied incompletely.',
  invalid_request:
    'Tempo rejected the request. Usually the redirect URL differs from the one registered in Tempo → Settings → OAuth 2.0 Applications.',
  unauthorized_client: 'This OAuth application is not allowed to use the authorization code grant — check its settings in Tempo.',
  unsupported_grant_type: 'Tempo rejected the grant type — the app is asking for the wrong OAuth flow.',
};

export function tempoErrorHint(error) {
  return TEMPO_ERROR_HINTS[String(error ?? '')] ?? null;
}

/**
 * Ответ Tempo, означающий «этот токен больше не работает»: доступ отозвали в
 * настройках Tempo, у человека забрали права, приложение удалили. Отличать это от
 * прочих ошибок нужно, чтобы страница настроек сказала «подключитесь заново», а не
 * показывала «подключено» рядом с молчащей рассылкой.
 */
export function isTempoAuthError(message) {
  return /\bTempo (401|403)\b/.test(String(message ?? ''));
}
