import { randomUUID } from 'node:crypto';
import { fetch, webTrigger } from '@forge/api';
import {
  clearCredential,
  clearPendingSlackConnect,
  getCredentials,
  getCredentialsStatus,
  getPendingSlackConnect,
  getSlackConnection,
  saveCredential,
  startPendingSlackConnect,
} from './store.js';
import { revokeSlackToken } from './slack.js';
import { page } from './oauthPage.js';
import {
  SLACK_SCOPES,
  SLACK_TOKEN_URL,
  STATE_TTL_MS,
  buildAuthorizeUrl,
  checkPendingConnect,
  decodeState,
  encodeState,
  slackErrorHint,
} from './slackOAuthState.js';

/**
 * Подключение Slack одной кнопкой.
 *
 * Почему не встроенный OAuth Forge (`providers.auth` + `asUser().withProvider`):
 * внешние провайдеры работают только в пользовательском контексте, а вся
 * рассылка идёт из scheduledTrigger и консьюмера очереди, где пользователя в
 * сессии нет. Кнопка бы работала, ночной прогон — нет. Поэтому токен приложение
 * получает само и кладёт туда же, куда клали вставленный руками, — в секретное
 * хранилище Forge; всё остальное приложение не замечает разницы.
 *
 * Как выглядит путь целиком:
 *
 *   Jira → resolver startSlackConnect: nonce в KVS, ссылка на экран согласия
 *        → slack.com: администратор выбирает workspace и жмёт Allow
 *        → статическая страница (SLACK_REDIRECT_URI): пересылает code на
 *          веб-триггер этой установки, адрес которого приехал в state
 *        → веб-триггер slackOAuthCallback: сверяет nonce, меняет code на токен,
 *          пишет его в секретное хранилище и показывает страницу «готово».
 *
 * Промежуточная страница нужна из-за Slack: redirect_uri обязан быть заранее
 * зарегистрирован, а адрес веб-триггера свой у каждой установки — зарегистрировать
 * их все нельзя. Страница статическая, ничего не хранит и никуда не ходит
 * (docs/slack-callback/index.html).
 */

const CLIENT_ID = 'SLACK_CLIENT_ID';
const CLIENT_SECRET = 'SLACK_CLIENT_SECRET';
const REDIRECT_URI = 'SLACK_REDIRECT_URI';
const CALLBACK_MODULE_KEY = 'slack-oauth-callback';

/**
 * Настройки OAuth живут в зашифрованных переменных окружения Forge: они одни на
 * все установки приложения и наружу не отдаются. Своя сборка приложения без них
 * тоже должна работать — просто без кнопки, с вставкой токена руками, поэтому
 * отсутствие переменных не ошибка, а выключенная возможность.
 */
export function slackOAuthConfig() {
  const clientId = process.env[CLIENT_ID];
  const clientSecret = process.env[CLIENT_SECRET];
  const redirectUri = process.env[REDIRECT_URI];
  const available = Boolean(clientId && clientSecret && redirectUri);
  return { clientId, clientSecret, redirectUri, available };
}

/** Состояние подключения для страницы настроек. Токен наружу не отдаётся никогда. */
export async function getSlackStatus() {
  const [stored, credentials] = await Promise.all([getSlackConnection(), getCredentialsStatus()]);
  const token = credentials.slackBotToken;
  // Установки, где токен вставили руками ещё до появления кнопки, записи о
  // подключении не имеют — а показывать их как «не подключено» нельзя: рассылка
  // у них работает. Описываем такое подключение по тому, что о токене известно.
  const connection =
    stored ?? (token.isSet ? { method: 'token', connectedAt: token.updatedAt ?? null } : null);

  return { connection, oauthAvailable: slackOAuthConfig().available, scopes: SLACK_SCOPES };
}

/**
 * Первый шаг: ссылка на экран согласия Slack. Возвращаем именно ссылку, а не
 * редирект, — открывает её фронтенд через router.open, в соседней вкладке.
 */
export async function startSlackConnect(requestedBy = null) {
  const { clientId, redirectUri, available } = slackOAuthConfig();
  if (!available) {
    throw new Error(
      `Slack OAuth is not configured for this deployment — ${CLIENT_ID}, ${CLIENT_SECRET} and ${REDIRECT_URI} must be set. Paste a bot token manually instead.`
    );
  }

  const callbackUrl = await webTrigger.getUrl(CALLBACK_MODULE_KEY);
  const nonce = randomUUID();
  await startPendingSlackConnect({
    nonce,
    requestedBy,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  return {
    url: buildAuthorizeUrl({
      clientId,
      redirectUri,
      state: encodeState({ callbackUrl, nonce }),
    }),
    expiresInMs: STATE_TTL_MS,
  };
}

/**
 * Второй шаг: сюда приходит браузер администратора со страницы-переходника.
 *
 * Адрес веб-триггера платформа не проверяет никак — знающий его может позвать
 * эту функцию с любыми параметрами. Единственное доказательство, что подключение
 * начал администратор этой Jira, — nonce: он рождается в резолвере, лежит в KVS
 * и сгорает при первой же проверке. Всё, что его не прошло, до Slack не доходит.
 */
export async function handleSlackOAuthCallback(request) {
  const query = request?.queryParameters ?? {};
  const first = (name) => query[name]?.[0] ?? null;

  let state;
  try {
    state = decodeState(first('state'));
  } catch (e) {
    return page(400, 'Slack was not connected', e.message);
  }

  // Сверяем nonce раньше всего остального: до этой строки запрос ничем не
  // отличается от постороннего, знающего адрес веб-триггера.
  const pending = await getPendingSlackConnect();
  const checked = checkPendingConnect(pending, state.nonce);
  if (!checked.ok) return page(400, 'Slack was not connected', checked.reason);
  // Nonce одноразовый, и гасится он до похода в Slack: повторно открытая вкладка
  // колбэка второй попытки давать не должна.
  await clearPendingSlackConnect();

  // Отказ на экране согласия — не ошибка приложения: администратор передумал.
  const denied = first('error');
  if (denied) {
    return page(400, 'Slack was not connected', slackErrorHint(denied) ?? `Slack returned: ${denied}`);
  }

  const code = first('code');
  if (!code) return page(400, 'Slack was not connected', 'Slack did not return an authorization code.');

  let exchanged;
  try {
    exchanged = await exchangeCode(code);
  } catch (e) {
    console.error(`Обмен кода Slack не удался: ${e.stack ?? e.message}`);
    return page(502, 'Slack was not connected', e.message);
  }

  await saveCredential('slackBotToken', exchanged.token, {
    method: 'oauth',
    teamId: exchanged.teamId,
    teamName: exchanged.teamName,
    botUserId: exchanged.botUserId,
    scopes: exchanged.scopes,
    isEnterpriseInstall: exchanged.isEnterpriseInstall,
    connectedBy: pending.requestedBy ?? null,
    connectedAt: new Date().toISOString(),
  });
  console.log(`Slack подключён: workspace ${exchanged.teamName} (${exchanged.teamId})`);

  return page(
    200,
    `Connected to ${exchanged.teamName ?? 'Slack'}`,
    'You can close this tab and go back to the Tempo Reminders settings in Jira — the connection shows up there within a few seconds.'
  );
}

/**
 * Обмен `code` на bot-токен. client_id и client_secret уходят заголовком Basic,
 * как рекомендует Slack, а не полями формы: так они не попадают в логи прокси.
 */
async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = slackOAuthConfig();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

  const res = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ code, redirect_uri: redirectUri }).toString(),
  });
  if (!res.ok) throw new Error(`Slack oauth.v2.access: HTTP ${res.status}`);

  const data = await res.json();
  if (!data.ok) {
    const hint = slackErrorHint(data.error);
    throw new Error(hint ? `${hint} (${data.error})` : `Slack oauth.v2.access: ${data.error}`);
  }
  // Токен пользователя приложение не запрашивает, так что прийти должен именно
  // бот. Если Slack вернул что-то другое, дальше идти незачем: рассылка молча
  // сломалась бы на первом же сообщении.
  if (!data.access_token || data.token_type !== 'bot') {
    throw new Error('Slack did not return a bot token — check the scopes of the Slack app.');
  }

  return {
    token: data.access_token,
    // При установке на всю организацию (Enterprise Grid) workspace в ответе нет —
    // остаётся только имя организации, и назвать подключение всё равно нужно.
    teamId: data.team?.id ?? data.enterprise?.id ?? null,
    teamName: data.team?.name ?? data.enterprise?.name ?? null,
    botUserId: data.bot_user_id ?? null,
    scopes: data.scope ? data.scope.split(',') : [],
    isEnterpriseInstall: Boolean(data.is_enterprise_install),
  };
}

/**
 * Отключение: сначала отзываем токен в Slack, потом стираем у себя. Обратный
 * порядок оставил бы в workspace живой токен, который уже нечем отозвать.
 *
 * Отказ Slack не отменяет удаления: токен могли отозвать и на той стороне, и
 * тогда единственным следствием осечки стала бы невозможность отключиться.
 */
export async function disconnectSlack() {
  const { slackBotToken } = await getCredentials();
  let revoked = { ok: false, message: 'There was no Slack token to revoke' };
  if (slackBotToken) revoked = await revokeSlackToken(slackBotToken);
  await clearCredential('slackBotToken');
  if (!revoked.ok && slackBotToken) console.warn(`Токен Slack не отозван: ${revoked.message}`);
  return revoked;
}

