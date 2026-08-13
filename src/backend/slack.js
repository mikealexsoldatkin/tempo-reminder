import { fetch } from '@forge/api';

const SLACK_API = 'https://slack.com/api';

/**
 * Ищет Slack-пользователя по email. Возвращает null, если пользователя нет
 * (это ожидаемая ситуация, а не ошибка прогона).
 */
export async function lookupSlackUserByEmail(email, token) {
  const data = await slackGet(`users.lookupByEmail?email=${encodeURIComponent(email)}`, token);
  if (!data.ok) {
    if (data.error === 'users_not_found') return null;
    throw new Error(`Slack users.lookupByEmail: ${data.error}`);
  }
  return data.user?.id ?? null;
}

export async function sendSlackDm(slackUserId, text, token) {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: slackUserId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack chat.postMessage: ${data.error}`);
}

/**
 * Проверка bot-токена для кнопки «Проверить подключение».
 */
export async function testSlackToken(token) {
  try {
    const data = await slackGet('auth.test', token);
    if (!data.ok) return { ok: false, message: `Slack auth.test: ${data.error}` };
    return { ok: true, message: `Slack OK: bot ${data.user} in workspace ${data.team}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function slackGet(path, token) {
  if (!token) throw new Error('Slack bot token is not set');
  const res = await fetch(`${SLACK_API}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
  return res.json();
}
