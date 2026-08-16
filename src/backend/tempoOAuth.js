import { randomUUID } from 'node:crypto';
import { fetch, webTrigger } from '@forge/api';
import { getJiraBaseUrl } from './jira.js';
import { page } from './oauthPage.js';
import {
  clearCredential,
  clearPendingTempoConnect,
  clearTempoConnectionError,
  getCredentials,
  getCredentialsStatus,
  getPendingTempoConnect,
  getTempoConnection,
  getTempoRefreshToken,
  markTempoConnectionBroken,
  saveTempoOAuthTokens,
  startPendingTempoConnect,
} from './store.js';
import {
  STATE_TTL_MS,
  TEMPO_REVOKE_URL,
  TEMPO_TOKEN_URL,
  buildTempoAuthorizeUrl,
  checkPendingTempoConnect,
  expiresAtFrom,
  isTempoAuthError,
  needsRefresh,
  tempoErrorHint,
} from './tempoOAuthState.js';

/**
 * Подключение Tempo одной кнопкой — то же, что уже сделано для Slack, и по тем же
 * причинам: администратор нажимает «Connect Tempo», Tempo спрашивает согласие,
 * приложение само получает токен и кладёт его туда же, куда клали вставленный
 * руками, — в секретное хранилище Forge. Остальное приложение разницы не замечает.
 *
 * Зачем это нужно сверх удобства: токен из «Tempo → Settings → API integration»
 * живёт по умолчанию 30 дней. Раз в месяц кто-то должен вспомнить, выпустить
 * новый и вставить его сюда, а если не вспомнил — рассылка молча останавливается.
 * OAuth-доступ приложение продлевает себе само, refresh-токеном.
 *
 * Путь целиком:
 *
 *   Jira → резолвер startTempoConnect: nonce в KVS, ссылка на экран согласия
 *        → api.tempo.io/oauth/authorize/redirect: Tempo спрашивает согласие
 *          против этого инстанса Jira (jira_url) и ведёт на Authorize
 *        → веб-триггер tempoOAuthCallback: сверяет начатое подключение, меняет
 *          code на пару access+refresh, пишет их в секретное хранилище и
 *          показывает страницу «готово».
 *
 * Промежуточная страница, как у Slack, здесь не нужна — и не может быть
 * использована: Tempo обещает вернуть на redirect_uri только `code`, без `state`,
 * так что переслать код «куда сказано» такой странице было бы неоткуда узнать.
 * Поэтому redirect_uri — сразу адрес веб-триггера этой установки; он стабилен, и
 * именно его администратор вписывает в OAuth-приложение Tempo при развёртывании.
 */

const CLIENT_ID = 'TEMPO_CLIENT_ID';
const CLIENT_SECRET = 'TEMPO_CLIENT_SECRET';
const CALLBACK_MODULE_KEY = 'tempo-oauth-callback';

/**
 * Настройки OAuth живут в зашифрованных переменных окружения Forge — они общие на
 * все установки и наружу не отдаются. Своя сборка без них тоже должна работать:
 * просто без кнопки, со вставкой токена руками, поэтому их отсутствие — не ошибка,
 * а выключенная возможность.
 */
export function tempoOAuthConfig() {
  const clientId = process.env[CLIENT_ID];
  const clientSecret = process.env[CLIENT_SECRET];
  return { clientId, clientSecret, available: Boolean(clientId && clientSecret) };
}

/** Состояние подключения для страницы настроек. Токен наружу не отдаётся никогда. */
export async function getTempoStatus() {
  const [stored, credentials] = await Promise.all([getTempoConnection(), getCredentialsStatus()]);
  const token = credentials.tempoToken;
  // Установки, где токен вставили руками ещё до появления кнопки, записи о
  // подключении не имеют, а показывать их как «не подключено» нельзя: worklog'и
  // у них читаются. Описываем такое подключение по тому, что известно о токене.
  const connection =
    stored ?? (token.isSet ? { method: 'token', connectedAt: token.updatedAt ?? null } : null);

  return { connection, oauthAvailable: tempoOAuthConfig().available };
}

/**
 * Первый шаг: ссылка на экран согласия Tempo. Возвращаем именно ссылку, а не
 * редирект, — открывает её фронтенд через router.open, в соседней вкладке.
 */
export async function startTempoConnect(requestedBy = null) {
  const { clientId, available } = tempoOAuthConfig();
  if (!available) {
    throw new Error(
      `Tempo OAuth is not configured for this deployment — ${CLIENT_ID} and ${CLIENT_SECRET} must be set. Paste an API token manually instead.`
    );
  }

  const [redirectUri, jiraUrl] = await Promise.all([callbackUrl(), getJiraBaseUrl()]);
  const nonce = randomUUID();
  await startPendingTempoConnect({
    nonce,
    requestedBy,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  return {
    url: buildTempoAuthorizeUrl({ clientId, redirectUri, jiraUrl, state: nonce }),
    expiresInMs: STATE_TTL_MS,
  };
}

/**
 * Второй шаг: сюда приходит браузер администратора с экрана согласия Tempo.
 *
 * Адрес веб-триггера платформа не проверяет никак, поэтому первым делом сверяем
 * начатое подключение — см. checkPendingTempoConnect, там же объяснено, почему
 * без `state` этого достаточно.
 */
export async function handleTempoOAuthCallback(request) {
  const query = request?.queryParameters ?? {};
  const first = (name) => query[name]?.[0] ?? null;

  const pending = await getPendingTempoConnect();
  const checked = checkPendingTempoConnect(pending, first('state'));
  if (!checked.ok) return page(400, 'Tempo was not connected', checked.reason);
  // Начатое подключение одноразовое, и гасится оно до похода в Tempo: повторно
  // открытая вкладка колбэка второй попытки давать не должна.
  await clearPendingTempoConnect();

  // Отказ на экране согласия — не ошибка приложения: администратор передумал.
  const denied = first('error');
  if (denied) {
    return page(400, 'Tempo was not connected', tempoErrorHint(denied) ?? `Tempo returned: ${denied}`);
  }

  const code = first('code');
  if (!code) return page(400, 'Tempo was not connected', 'Tempo did not return an authorization code.');

  let exchanged;
  try {
    exchanged = await requestToken({ grant_type: 'authorization_code', code });
  } catch (e) {
    console.error(`Обмен кода Tempo не удался: ${e.stack ?? e.message}`);
    return page(502, 'Tempo was not connected', e.message);
  }

  await saveTempoOAuthTokens({
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    connection: {
      method: 'oauth',
      scope: exchanged.scope,
      expiresAt: exchanged.expiresAt,
      connectedBy: pending.requestedBy ?? null,
      connectedAt: new Date().toISOString(),
    },
  });
  console.log(`Tempo подключён по OAuth, токен живёт до ${exchanged.expiresAt ?? 'неизвестно когда'}`);

  return page(
    200,
    'Connected to Tempo',
    'You can close this tab and go back to the Tempo Reminders settings in Jira — the connection shows up there within a few seconds.'
  );
}

/**
 * Действующий токен Tempo для всех, кто ходит в его API.
 *
 * Единственная точка, где приложение берёт токен: вставленный руками отдаётся как
 * есть, а полученный по OAuth здесь же продлевается, если срок подходит к концу.
 * Обновление умеет работать без пользователя в сессии (это server-to-server обмен
 * refresh'а), поэтому одинаково годится и для ночного прогона, и для консьюмера.
 *
 * @returns {Promise<string|null>} null — доступа к Tempo нет вовсе
 */
export async function getTempoAccessToken() {
  const [{ tempoToken }, connection] = await Promise.all([getCredentials(), getTempoConnection()]);
  if (!needsRefresh(connection)) return tempoToken;

  try {
    return await refreshAccessToken(tempoToken);
  } catch (e) {
    // Ещё живой токен не выбрасываем: до конца его срока прогоны продолжат
    // работать, и у администратора есть время подключиться заново.
    console.error(`Обновление токена Tempo не удалось: ${e.message}`);
    await markTempoConnectionBroken(e.message);
    if (!tempoToken) throw e;
    return tempoToken;
  }
}

/**
 * Обмен refresh-токена на новую пару. Tempo гасит и прежний access, и прежний
 * refresh, поэтому пара пишется целиком и сразу.
 *
 * Гонка здесь возможна: прогон и открытая страница настроек могут схватиться за
 * обновление одновременно, и второй придёт с refresh'ем, который первый уже
 * погасил. Именно это и распознаётся ниже: если в хранилище появился токен новее
 * нашего, обновление уже сделал кто-то другой — берём его результат.
 */
async function refreshAccessToken(previousAccessToken) {
  const refreshToken = await getTempoRefreshToken();
  if (!refreshToken) throw new Error('There is no Tempo refresh token — connect Tempo again');

  let exchanged;
  try {
    exchanged = await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  } catch (e) {
    const { tempoToken } = await getCredentials();
    if (tempoToken && tempoToken !== previousAccessToken) {
      console.log('Токен Tempo обновил параллельный вызов — берём его');
      return tempoToken;
    }
    throw e;
  }

  // Обновление удалось — значит прежняя пометка о сломанном доступе устарела и
  // в новую запись не переезжает.
  const { brokenError, brokenAt, ...connection } = (await getTempoConnection()) ?? {};
  await saveTempoOAuthTokens({
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    connection: {
      ...connection,
      method: 'oauth',
      scope: exchanged.scope ?? connection.scope ?? null,
      expiresAt: exchanged.expiresAt,
      refreshedAt: new Date().toISOString(),
    },
  });
  console.log(`Токен Tempo обновлён, живёт до ${exchanged.expiresAt ?? 'неизвестно когда'}`);
  return exchanged.accessToken;
}

/**
 * Продление доступа в холостом часовом срабатывании триггера.
 *
 * Без него токен продлевался бы только на прогоне, а прогонов может не быть:
 * расписание пустое, отпуск, праздники подряд. Шестьдесят дней тишины — и
 * подключение мертво, хотя приложение всё это время работало. Проверка стоит
 * ровно одного чтения KVS в час, а обмен случается раз в семь недель.
 */
export async function keepTempoConnectionFresh() {
  const connection = await getTempoConnection();
  if (!needsRefresh(connection)) return false;
  await getTempoAccessToken();
  return true;
}

/**
 * Отключение: сначала гасим токены в Tempo, потом стираем у себя. Обратный
 * порядок оставил бы на той стороне живой доступ, который уже нечем отозвать.
 *
 * Отказ Tempo не отменяет удаления: доступ могли отозвать и там, и тогда
 * единственным следствием осечки стала бы невозможность отключиться.
 */
export async function disconnectTempo() {
  const [{ tempoToken }, refreshToken, connection] = await Promise.all([
    getCredentials(),
    getTempoRefreshToken(),
    getTempoConnection(),
  ]);

  // Отзывать в Tempo есть что только у подключения по кнопке: токен из
  // «API integration» этой ручкой не гасится — его выпускали не мы, и убрать его
  // можно только там же, где выпускали.
  const revoked = [];
  if (connection?.method === 'oauth') {
    if (refreshToken) revoked.push(await revokeToken(refreshToken, 'refresh_token'));
    if (tempoToken) revoked.push(await revokeToken(tempoToken, 'access_token'));
  }

  // Стирает и токен, и refresh, и запись о подключении — см. clearCredential.
  await clearCredential('tempoToken');

  if (connection && connection.method !== 'oauth') {
    return {
      ok: true,
      message: 'The pasted token was removed here — revoke it in Tempo → Settings → API integration',
    };
  }
  if (revoked.length === 0) return { ok: false, message: 'There was no Tempo access to revoke' };
  const failed = revoked.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.warn(`Доступ Tempo не отозван: ${failed.map((f) => f.message).join('; ')}`);
    return { ok: false, message: `Removed here, but Tempo did not confirm the revocation: ${failed[0].message}` };
  }
  return { ok: true, message: 'Tempo access revoked and removed' };
}

/**
 * Итог проверки подключения со страницы настроек: кроме прогона, узнать об
 * отзыве доступа неоткуда, поэтому пометка ставится и снимается здесь же.
 * Отличаем отказ в доступе от прочих бед Tempo — пятисотые и таймауты подключение
 * сломанным не делают.
 */
export async function noteTempoCheck(result) {
  if (result?.ok) await clearTempoConnectionError();
  else if (isTempoAuthError(result?.message)) await markTempoConnectionBroken(result.message);
  return result;
}

/* ------------------------------- запросы в Tempo ------------------------------- */

/**
 * Обмен на токен. client_id и client_secret Tempo принимает только полями формы —
 * заголовок Basic, как у Slack, здесь не предусмотрен.
 */
async function requestToken(params) {
  const { clientId, clientSecret, available } = tempoOAuthConfig();
  if (!available) throw new Error(`Tempo OAuth is not configured — ${CLIENT_ID} and ${CLIENT_SECRET} are missing`);

  const body = new URLSearchParams({
    ...params,
    client_id: clientId,
    client_secret: clientSecret,
    // redirect_uri требуется обоим грантам: Tempo сверяет его с зарегистрированным.
    redirect_uri: await callbackUrl(),
  });

  const res = await fetch(TEMPO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });

  const text = await res.text();
  const data = parseJson(text);
  if (!res.ok) {
    const code = data?.error ?? `HTTP ${res.status}`;
    const hint = tempoErrorHint(data?.error);
    throw new Error(hint ? `${hint} (${code})` : `Tempo ${TEMPO_TOKEN_URL}: ${code}`);
  }
  if (!data?.access_token) throw new Error('Tempo did not return an access token');

  return {
    accessToken: data.access_token,
    // На обновлении Tempo обязан прислать новый refresh; страхуемся от ответа без
    // него — тогда в хранилище останется прежний, и следующая попытка это покажет.
    refreshToken: data.refresh_token ?? null,
    scope: data.scope ?? null,
    expiresAt: expiresAtFrom(data.expires_in),
  };
}

async function revokeToken(token, hint) {
  const { clientId, clientSecret, available } = tempoOAuthConfig();
  if (!available) return { ok: false, message: 'Tempo OAuth is not configured in this deployment' };

  try {
    const res = await fetch(TEMPO_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        token,
        token_type_hint: hint,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) return { ok: false, message: `Tempo ${res.status} on revoking the ${hint}` };
    return { ok: true, message: `The ${hint} was revoked in Tempo` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/** Адрес возврата один на все три места: ссылку, обмен и обновление. */
function callbackUrl() {
  return webTrigger.getUrl(CALLBACK_MODULE_KEY);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
