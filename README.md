# Forge-приложение: напоминание в Slack о незалогированном времени

Scheduled-триггер Forge раз в день перебирает участников проекта, проверяет в Tempo,
репортились ли они за последние **2 рабочих дня**, и тем, кто не репортился, шлёт **DM в Slack**.

Файлы:
- `manifest.yml` — модули (scheduledTrigger, function), scopes, egress-домены, env-переменные.
- `src/index.js` — вся логика.
- `package.json` — зависимость `@forge/api`.

---

## Ограничения
У scheduled-триггера **нет cron**, только `fiveMinute | hour | day | week`.
Поэтому запускаем `day`, а «только будни» и окно рабочих дней считаем в коде (`src/index.js`).
---

## Пререквизиты

1. Node.js 18+ и Forge CLI:
   ```bash
   npm install -g @forge/cli
   forge login          # ввести email + Atlassian API token
   ```
2. **Tempo API token**: Tempo → Settings → API integration → New token.
3. **Slack App (Bot token)** со scope'ами: `users:read`, `users:read.email`, `chat:write`, `im:write`.
   Установить в workspace, скопировать `xoxb-...`.

---

## Установка и деплой

```bash
cd forge-tempo-reminder

# 1. Зарегистрировать приложение (подставит app.id в manifest.yml)
forge register

# 2. Поставить зависимости
npm install

# 3. Задать секреты и переменные (шифруются, доступны как process.env.*)
forge variables set --encrypt TEMPO_TOKEN      "<ваш Tempo token>"
forge variables set --encrypt SLACK_BOT_TOKEN  "xoxb-..."
forge variables set          PROJECT_KEY       "ABC"     # ключ вашего проекта

# 4. Собрать и задеплоить
forge deploy

# 5. Установить в инстанс
forge install        # выбрать Jira и указать сайт
```
---

## Как проверить, не дожидаясь расписания

Scheduled-триггеры удобно гонять в туннеле с ручным событием:

```bash
forge tunnel
# в другом терминале:
forge webtrigger        # (если добавите web-trigger — см. ниже)
```

Проще всего для теста временно поменять хендлер на **web trigger** или вызвать функцию через
`forge tunnel` + инвок. Логи смотрите так:

```bash
forge logs
```

Быстрый чек по шагам (до деплоя тоже полезно прогнать вручную через curl):

- Tempo: `GET https://api.tempo.io/4/worklogs/user/<accountId>?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=1`
  с `Authorization: Bearer <TEMPO_TOKEN>` — убедиться в форме ответа (`metadata.count` / `results`).
- Slack: `users.lookupByEmail`, затем `chat.postMessage` с `channel = <user id>`.

---

## Известные подводные камни

1. **Email скрыт настройками приватности** → `assignable/search` не вернёт `emailAddress`,
   Slack-поиск по email не сработает. Решение: статичный маппинг accountId → Slack ID.
2. **Egress**: любой внешний домен обязан быть в `permissions.external.fetch.backend`,
   иначе `fetch` отклонят (`REQUEST_EGRESS_ALLOWLIST_ERR`). Домены уже прописаны в manifest.
3. **Нет cron** → выходные и окно считаем в коде (учтено). Часовой пояс запуска — UTC,
   при необходимости сместите расчёт дня недели/дат под свой TZ.
4. **Rate limits** Slack/Tempo — для больших команд добавьте паузы между итерациями.
5. `scheduledTrigger` стартует примерно через 5 минут после первого деплоя/установки.

---

## Источники

- [Scheduled trigger (manifest) — Forge](https://developer.atlassian.com/platform/forge/manifest-reference/modules/scheduled-trigger/)
- [Scheduled trigger events — Forge](https://developer.atlassian.com/platform/forge/events-reference/scheduled-trigger/)
- [Runtime egress permissions — Forge](https://developer.atlassian.com/platform/forge/runtime-egress-permissions/)
- [Permissions (manifest) — Forge](https://developer.atlassian.com/platform/forge/manifest-reference/permissions/)
- [Worklog REST APIs for Jira Cloud — Tempo](https://help.tempo.io/cloudmigration/latest/worklog-rest-apis-for-jira-cloud)
- [Slack users.lookupByEmail](https://docs.slack.dev/reference/methods/users.lookupByEmail/)
