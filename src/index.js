import api, { route, fetch } from '@forge/api';

/**
 * Scheduled trigger handler.
 * Логика:
 *  1. Пропускаем выходные (Forge умеет только "раз в день", cron нет).
 *  2. Считаем окно "последние 2 рабочих дня" [from .. today].
 *  3. Берём участников проекта из Jira REST.
 *  4. Для каждого спрашиваем Tempo: есть ли worklog в окне.
 *  5. Если нет — шлём личное сообщение в Slack.
 */
export async function run() {
  const PROJECT_KEY = process.env.PROJECT_KEY;
  const TEMPO_TOKEN = process.env.TEMPO_TOKEN;
  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

  if (!PROJECT_KEY || !TEMPO_TOKEN || !SLACK_BOT_TOKEN) {
    console.error('Missing env vars: PROJECT_KEY / TEMPO_TOKEN / SLACK_BOT_TOKEN');
    return;
  }

  const today = new Date();
  const dow = today.getUTCDay(); // 0=Вс, 1=Пн ... 6=Сб

  // 1. Выходные пропускаем.
  if (dow === 0 || dow === 6) {
    console.log('Weekend — skip.');
    return;
  }

  // 2. Окно "2 рабочих дня назад": в Пн/Вт перепрыгиваем через выходные.
  //    Пн(1)/Вт(2) -> 4 календарных дня назад; Ср–Пт -> 2 дня назад.
  const backDays = dow === 1 || dow === 2 ? 4 : 2;
  const from = isoDate(addDays(today, -backDays));
  const to = isoDate(today);

  console.log(`Checking window ${from}..${to} for project ${PROJECT_KEY}`);

  // 3. Участники проекта (постранично).
  const people = await getProjectPeople(PROJECT_KEY);
  console.log(`Found ${people.length} people`);

  // 3b. Один bulk-запрос в Tempo на всё окно вместо запроса на каждого человека:
  //     иначе упираемся в лимит шлюза 5 req/s и получаем 429.
  const authorsWithWorklogs = await getWorklogAuthors(from, to, TEMPO_TOKEN);
  console.log(`Tempo: ${authorsWithWorklogs.size} authors logged time in window`);

  let reminded = 0;
  for (const person of people) {
    try {
      if (authorsWithWorklogs.has(person.accountId)) continue;

      // 4. Нет репорта — ищем в Slack и шлём DM.
      if (!person.email) {
        console.warn(`No email for ${person.displayName} (${person.accountId}) — skip.`);
        continue;
      }

      //TODO: убрать, это только для теста
      if (person.email != 'mikhail.soldatkin@americor.com') {
        console.warn(`Inappropriate email ${person.email} for ${person.displayName} — skip.`);
        continue;
      }

      const slackId = await slackLookupByEmail(person.email, SLACK_BOT_TOKEN);
      if (!slackId) {
        console.warn(`Slack user not found for ${person.email}`);
        continue;
      }
      await slackSendDM(slackId, reminderText(from, to), SLACK_BOT_TOKEN);
      reminded++;
    } catch (e) {
      console.error(`Failed for ${person.accountId}: ${e.message}`);
    }
  }

  console.log(`Done. Reminders sent: ${reminded}`);
}

/* ----------------------------- Jira ----------------------------- */

async function getProjectPeople(projectKey) {
  const people = [];
  let startAt = 0;
  const maxResults = 100;

  // /rest/api/3/user/assignable/search отдаёт назначаемых на проект пользователей.
  // emailAddress приходит только если не скрыт настройками приватности профиля.
  while (true) {
    const res = await api
      .asApp()
      .requestJira(
        route`/rest/api/3/user/assignable/search?project=${projectKey}&startAt=${startAt}&maxResults=${maxResults}`,
        { headers: { Accept: 'application/json' } }
      );
    if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    for (const u of batch) {
      if (u.accountType && u.accountType !== 'atlassian') continue; // пропускаем ботов/app-юзеров
      people.push({
        accountId: u.accountId,
        displayName: u.displayName,
        email: u.emailAddress || null,
      });
    }
    if (batch.length < maxResults) break;
    startAt += maxResults;
  }
  return people;
}

/* ----------------------------- Tempo ----------------------------- */

/**
 * Все авторы, у которых есть worklog в окне [from..to].
 * Один пагинированный запрос на всё окно, а не по запросу на человека:
 * шлюз Tempo режет на 5 req/s и отдаёт 429.
 */
async function getWorklogAuthors(from, to, token) {
  const authors = new Set();
  const limit = 1000; // максимум страницы Tempo v4
  let offset = 0;

  while (true) {
    const url = `https://api.tempo.io/4/worklogs?from=${from}&to=${to}&limit=${limit}&offset=${offset}`;
    const data = await tempoFetch(url, token);
    const results = data?.results ?? [];

    for (const wl of results) {
      const accountId = wl?.author?.accountId;
      if (accountId) authors.add(accountId);
    }

    if (results.length < limit) break;
    offset += limit;
    await sleep(250); // держимся ниже 5 req/s
  }
  return authors;
}

/**
 * GET в Tempo с ретраями на 429/5xx: уважаем Retry-After, иначе экспонента.
 */
async function tempoFetch(url, token, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= attempts) {
      throw new Error(`Tempo ${res.status}: ${await res.text()}`);
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s, 8s
    console.warn(`Tempo ${res.status}, retry ${attempt}/${attempts - 1} in ${waitMs}ms`);
    await sleep(waitMs);
  }
}

/* ----------------------------- Slack ----------------------------- */

async function slackLookupByEmail(email, token) {
  const url = `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!data.ok) {
    console.warn(`slack lookup error for ${email}: ${data.error}`);
    return null;
  }
  return data.user.id;
}

async function slackSendDM(slackUserId, text, token) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: slackUserId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack postMessage error: ${data.error}`);
}

function reminderText(from, to) {
  return (
    ':clock3: Привет! Похоже, в Tempo нет твоих записей времени за последние 2 рабочих дня ' +
    `(${from} — ${to}). Загляни и зарепортись, пожалуйста 🙏`
  );
}

/* ----------------------------- utils ----------------------------- */

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
