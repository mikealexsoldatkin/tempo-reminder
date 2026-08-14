import { fetch } from '@forge/api';

const TEMPO_API = 'https://api.tempo.io/4';
const PAGE_LIMIT = 1000; // максимум страницы Tempo v4

/**
 * За какие дни окна [from..to] у кого есть записи: accountId → множество дат
 * (`startDate` worklog'а, то есть день, за который списано время, а не день ввода).
 *
 * Один пагинированный запрос на всё окно, а не запрос на человека или на день:
 * шлюз Tempo режет на ~5 req/s и отдаёт 429.
 *
 * @returns {Promise<Map<string, Set<string>>>}
 */
export async function getWorklogDaysByAuthor(from, to, token) {
  const daysByAuthor = new Map();
  let offset = 0;

  while (true) {
    const data = await tempoGet(
      `${TEMPO_API}/worklogs?from=${from}&to=${to}&limit=${PAGE_LIMIT}&offset=${offset}`,
      token
    );
    const results = data?.results ?? [];
    for (const worklog of results) {
      const accountId = worklog?.author?.accountId;
      const day = worklog?.startDate;
      if (!accountId || !day) continue;
      if (!daysByAuthor.has(accountId)) daysByAuthor.set(accountId, new Set());
      daysByAuthor.get(accountId).add(day);
    }
    if (results.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    await sleep(250); // держимся ниже 5 req/s
  }
  return daysByAuthor;
}

/**
 * Дешёвая проверка токена для кнопки «Проверить подключение».
 */
export async function testTempoToken(token) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const data = await tempoGet(`${TEMPO_API}/worklogs?from=${today}&to=${today}&limit=1`, token, 2);
    return { ok: true, message: `Tempo responds (worklogs today: ${data?.metadata?.count ?? 0})` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * GET в Tempo с ретраями на 429/5xx: уважаем Retry-After, иначе экспонента.
 */
async function tempoGet(url, token, attempts = 5) {
  if (!token) throw new Error('Tempo API token is not set');

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) return res.json();

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Tempo ${res.status}: token rejected (check the Tempo API token)`);
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= attempts) {
      const body = await res.text().catch(() => '');
      throw new Error(`Tempo ${res.status}: ${body.slice(0, 300)}`);
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1);
    console.warn(`Tempo ${res.status}, retry ${attempt}/${attempts - 1} через ${waitMs}ms`);
    await sleep(waitMs);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
