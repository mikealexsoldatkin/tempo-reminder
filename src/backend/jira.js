import api, { assumeTrustedRoute, route } from '@forge/api';

// Сколько accountId кладём в один запрос за email'ами.
const BULK_CHUNK = 100;

// /rest/api/3/group отдаёт максимум 50 участников за раз; остальные — сдвигом окна expand.
const GROUP_PAGE = 50;
const GROUP_MAX_PAGES = 40; // до 2000 человек в одной группе

/**
 * Поиск пользователей Jira по имени (First + Last name) или email.
 * /rest/api/3/user/search?query= ищет по displayName и emailAddress.
 */
export async function searchUsersByName(query, { maxResults = 50 } = {}) {
  const trimmed = String(query ?? '').trim();
  if (trimmed.length < 2) throw new Error('Enter at least 2 characters to search');

  const res = await api
    .asApp()
    .requestJira(
      route`/rest/api/3/user/search?query=${trimmed}&maxResults=${String(maxResults)}`,
      { headers: { Accept: 'application/json' } }
    );
  if (!res.ok) throw new Error(await jiraError(res, 'user search'));

  return (await res.json()).filter(isRealUser).map(toPerson);
}

/**
 * Участники проекта — актёры ролей проекта (Administrators, Members, Developers…).
 *
 * Раньше здесь был /user/assignable/search?project=, но он отдаёт всех, у кого в проекте
 * есть право «Assignable User». Если оно выдано широко (например, на «Any logged in user»),
 * возвращается весь инстанс — скоуп по проекту фактически ничего не отсекает.
 * Роли же — это явно добавленные в проект люди, они не зависят от схемы прав.
 *
 * @returns {Promise<{users: object[], warnings: string[]}>}
 */
export async function searchProjectMembers(projectKey) {
  const key = String(projectKey ?? '').trim().toUpperCase();
  if (!key) throw new Error('Enter a project key');

  const roles = await getProjectRoles(key);
  const roleNames = Object.keys(roles);
  if (roleNames.length === 0) {
    return { users: [], warnings: [`Project ${key} has no project roles`] };
  }

  // accountId → { displayName, email, roles: Set }. Один человек может быть в нескольких ролях.
  const byAccountId = new Map();
  const warnings = [];
  // groupId → промис со списком участников: одна группа часто встречается в нескольких ролях.
  const groupCache = new Map();

  // Недоступная роль не должна ронять весь поиск — превращаем её в предупреждение.
  const details = await Promise.all(
    roleNames.map((name) =>
      getProjectRoleActors(key, roles[name], name).catch((e) => {
        warnings.push(`Role “${name}” couldn’t be read: ${e.message}`);
        return { roleName: name, actors: [], scope: null };
      })
    )
  );

  for (const { roleName, actors } of projectScopedRoles(details)) {
    for (const actor of actors) {
      if (actor.type === 'atlassian-user-role-actor') {
        const accountId = actor.actorUser?.accountId;
        if (accountId && accountId !== 'unknown') {
          collect(byAccountId, roleName, { accountId, displayName: actor.displayName });
        }
        continue;
      }

      if (actor.type === 'atlassian-group-role-actor' && actor.actorGroup) {
        const group = actor.actorGroup;
        try {
          for (const member of await membersOf(group, groupCache)) {
            if (isRealUser(member)) collect(byAccountId, roleName, toPerson(member));
          }
        } catch (e) {
          // Одна и та же группа может стоять в нескольких ролях — не дублируем предупреждение.
          const warning =
            `Role “${roleName}” includes group “${group.displayName ?? group.name}”, ` +
            `which couldn’t be expanded: ${e.message}`;
          if (!warnings.includes(warning)) warnings.push(warning);
        }
      }
    }
  }

  await fillMissingEmails(byAccountId);

  const users = [...byAccountId.values()]
    .map(({ roles: memberOf, ...person }) => ({ ...person, roles: [...memberOf].sort() }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { users, warnings };
}

/**
 * Оставляет только роли самого проекта — то, что видно в Project settings → People.
 *
 * У team-managed проекта собственные роли помечены scope.type === 'PROJECT', но эндпоинт
 * отдаёт вместе с ними и общие (инстансные) роли — их берём только если своих нет вовсе.
 * Так company-managed проект, где все роли по определению общие и при этом и есть People,
 * продолжает работать.
 */
export function projectScopedRoles(details) {
  const own = details.filter((role) => role.scope?.type === 'PROJECT');
  return own.length > 0 ? own : details;
}

/** Роли проекта: { "Administrators": "https://…/rest/api/3/project/ABC/role/10002", … } */
async function getProjectRoles(key) {
  const res = await api
    .asApp()
    .requestJira(route`/rest/api/3/project/${key}/role`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error(`Project ${key} was not found or is not available to the app`);
  if (!res.ok) throw new Error(await jiraError(res, `roles of project ${key}`));
  return (await res.json()) ?? {};
}

async function getProjectRoleActors(key, roleUrl, roleName) {
  // В ответе приходит только URL роли — id это его последний сегмент.
  const roleId = String(roleUrl).split('/').pop();
  if (!/^\d+$/.test(roleId)) return { roleName, actors: [], scope: null };

  const res = await api
    .asApp()
    .requestJira(
      route`/rest/api/3/project/${key}/role/${roleId}?excludeInactiveUsers=true`,
      { headers: { Accept: 'application/json' } }
    );
  if (!res.ok) throw new Error(await jiraError(res, `role ${roleName} of project ${key}`));

  const role = await res.json();
  // scope проставлен только у ролей, принадлежащих самому проекту (team-managed).
  return { roleName, actors: role?.actors ?? [], scope: role?.scope ?? null };
}

/** Участники группы с кэшем на один вызов — и успех, и ошибка запоминаются промисом. */
function membersOf(group, cache) {
  const cached = cache.get(group.groupId);
  if (cached) return cached;
  const pending = getGroupMembers(group.groupId);
  cache.set(group.groupId, pending);
  return pending;
}

/**
 * Участники группы через /rest/api/3/group?expand=users[start:end].
 *
 * Более новый /rest/api/3/group/member здесь не годится: он требует scope
 * manage:jira-configuration, а это право на изменение конфигурации Jira — непропорционально
 * для приложения, которое только читает. Этот эндпоинт помечен deprecated, но обходится
 * scope'ом read:jira-user, который у приложения уже есть.
 */
async function getGroupMembers(groupId) {
  if (!groupId) throw new Error('the group has no groupId');

  const members = [];
  let startIndex = 0;

  // Страховка от бесконечного цикла, если Jira вернёт неожиданную разметку страницы.
  for (let page = 0; page < GROUP_MAX_PAGES; page++) {
    const window = `users[${startIndex}:${startIndex + GROUP_PAGE - 1}]`;
    const res = await api
      .asApp()
      .requestJira(route`/rest/api/3/group?groupId=${groupId}&expand=${window}`, {
        headers: { Accept: 'application/json' },
      });
    if (res.status === 401 || res.status === 403) {
      throw new Error('the app is not allowed to browse users and groups');
    }
    if (res.status === 404) throw new Error('the group no longer exists');
    if (!res.ok) throw new Error(await jiraError(res, `members of group ${groupId}`));

    const users = (await res.json())?.users ?? {};
    const items = users.items ?? [];
    members.push(...items);
    if (items.length < GROUP_PAGE) break;

    // Границы окна в этом API инклюзивные, а нумерация в документации неоднозначна,
    // поэтому следующий старт берём из ответа, а не из собственного счётчика.
    const endIndex = users['end-index'];
    startIndex = Number.isInteger(endIndex) ? endIndex + 1 : startIndex + items.length;
  }

  // Окна могут перекрыться на границе — отдаём уникальных.
  return [...new Map(members.map((u) => [u.accountId, u])).values()];
}

/**
 * Добирает email'ы актёрам ролей — без них не найти человека в Slack.
 *
 * Берём именно Email API, а не /user/bulk: приложению видны только профильные поля с
 * видимостью «Anyone», а email обычно стоит «Only people in your organization» — коллега
 * его в профиле видит, приложение нет. Этот эндпоинт отдаёт адрес независимо от видимости,
 * требует scope read:email-address:jira и в Forge работает только через asApp().
 */
async function fillMissingEmails(byAccountId) {
  const missing = [...byAccountId.values()].filter((p) => !p.email).map((p) => p.accountId);

  for (let i = 0; i < missing.length; i += BULK_CHUNK) {
    const chunk = missing.slice(i, i + BULK_CHUNK);
    // route-тег не умеет собирать повторяющийся accountId=…&accountId=…, поэтому строим
    // строку сами и явно кодируем каждый id.
    const query = chunk.map((id) => `accountId=${encodeURIComponent(id)}`).join('&');
    const res = await api
      .asApp()
      .requestJira(assumeTrustedRoute(`/rest/api/3/user/email/bulk?${query}`), {
        headers: { Accept: 'application/json' },
      });
    // Email не критичен для добавления: без него человек попадёт в список с пометкой
    // «set an email» и адрес можно вписать руками, поэтому ошибку только логируем.
    if (!res.ok) {
      console.warn(`Не удалось получить email'ы: ${await jiraError(res, 'user email bulk')}`);
      continue;
    }

    // В спецификации ответ описан как одиночный объект, хотя эндпоинт bulk — принимаем оба вида.
    const data = await res.json();
    const entries = Array.isArray(data) ? data : data?.values ?? (data?.accountId ? [data] : []);
    for (const { accountId, email } of entries) {
      const person = byAccountId.get(accountId);
      if (person && email) person.email = email;
    }
  }
}

function collect(byAccountId, roleName, person) {
  const existing = byAccountId.get(person.accountId);
  if (existing) {
    existing.roles.add(roleName);
    if (!existing.email && person.email) existing.email = person.email;
    return;
  }
  byAccountId.set(person.accountId, {
    accountId: person.accountId,
    displayName: person.displayName || person.accountId,
    email: person.email ?? null,
    avatarUrl: person.avatarUrl ?? null,
    roles: new Set([roleName]),
  });
}

/**
 * Проверяет, что вызывающий — администратор Jira.
 * adminPage прячет UI от обычных пользователей, но резолверы доступны любому
 * аутентифицированному пользователю, поэтому проверяем права явно.
 */
export async function isJiraAdmin() {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, {
      headers: { Accept: 'application/json' },
    });
  if (!res.ok) throw new Error(await jiraError(res, 'administrator permission check'));
  const data = await res.json();
  return Boolean(data?.permissions?.ADMINISTER?.havePermission);
}

function isRealUser(user) {
  // Отсекаем ботов и app-пользователей, а также деактивированные аккаунты.
  return user?.accountId && user.active !== false && (!user.accountType || user.accountType === 'atlassian');
}

function toPerson(user) {
  return {
    accountId: user.accountId,
    displayName: user.displayName ?? user.accountId,
    // emailAddress приходит только если не скрыт настройками приватности профиля.
    email: user.emailAddress || null,
    avatarUrl: user.avatarUrls?.['24x24'] ?? null,
  };
}

async function jiraError(res, what) {
  const body = await res.text().catch(() => '');
  return `Jira ${res.status} (${what}): ${body.slice(0, 300)}`;
}
