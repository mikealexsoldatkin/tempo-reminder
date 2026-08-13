# Forge-приложение: напоминание в Slack о незалогированном времени

Приложение сверяет **явно выбранный список пользователей Jira** с worklog'ами Tempo и шлёт **DM в Slack**
тем, кто не репортился за последние N рабочих дней. Всё настраивается через UI — **env-переменные не используются**.

## Что где лежит

| Файл | Назначение |
| --- | --- |
| `manifest.yml` | модули (adminPage, scheduledTrigger, consumer, function), scopes, egress-домены |
| `src/index.js` | точки входа: резолвер страницы, плановый триггер, консьюмер очереди |
| `src/backend/store.js` | всё состояние в Forge KVS, токены — в секретном хранилище |
| `src/backend/reminder.js` | сам прогон проверки |
| `src/backend/jira.js` / `tempo.js` / `slack.js` | интеграции |
| `src/frontend/admin.jsx` | страница настроек (UI Kit) |
| `test/workdays.test.js` | тесты расчёта окна рабочих дней (`npm test`) |

---

## Страница настроек

Jira → **Настройки** → **Приложения** → **Tempo Reminders**. Доступна только администраторам Jira
(резолверы дополнительно проверяют право `ADMINISTER` — adminPage лишь прячет пункт меню).

### 1. Вкладка «Users»
Вместо прежнего `getProjectPeople()` список отслеживаемых людей задаётся вручную:

- **Поиск по имени** — вводите First + Last name (Jira ищет и по email), отмечаете нужных
  галочками и добавляете **батчем**.
- **Добавить участников проекта** — по ключу проекта подтягивает актёров ролей проекта
  (Administrators, Members, Developers…), ещё не отслеживаемые отмечаются автоматически.
  В таблице видно, из какой роли пришёл человек.
- **Таблица отслеживаемых** — удаление по одному и батчем, плюс ручная правка email.

> **Про email.** Slack ищется по email, а Jira отдаёт его только если профиль не скрыт настройками
> приватности. Для таких людей в таблице будет «set an email» — впишите его вручную, иначе
> напоминание не уйдёт. Найденный Slack-id кэшируется, чтобы не звать `users.lookupByEmail` каждый прогон.

### 2. Вкладка «Tokens and settings»
- **Tempo API token** и **Slack bot token** — password-поля. Значения кладутся в секретное хранилище
  Forge (`kvs.setSecret`) и наружу **никогда не возвращаются**: UI видит только «set / not set»,
  последние 4 символа и дату обновления.
- **Test connection** — дёргает Tempo и Slack `auth.test` текущими токенами.
- Параметры: глубина окна в рабочих днях, пропуск выходных, «не повторять за день», шаблон
  сообщения с плейсхолдерами `{name}`, `{from}`, `{to}`, `{days}`.

### 3. Вкладка «Run check»
Кнопка **«Start check»** запускает тот же прогон, что и расписание, но немедленно и в обход
`scheduledTrigger`. Ограничения «выходной» и «раз в день» на ручной запуск не действуют. Перед отправкой
показывается подтверждение — уходят **реальные** сообщения в Slack. Ниже — отчёт последнего прогона
(кто залогировал, кому ушло напоминание, где ошибка).

Прогон выполняется не в резолвере, а в **очереди** (`@forge/events`): у резолвера лимит ~10 секунд,
а Tempo и Slack приходится опрашивать с паузами. Поэтому UI поллит статус, пока job в работе.

---

## Пререквизиты

1. Node.js 18+ и Forge CLI:
   ```bash
   npm install -g @forge/cli
   forge login          # email + Atlassian API token
   ```
2. **Tempo API token**: Tempo → Settings → API integration → New token (нужно чтение worklog'ов).
3. **Slack App (Bot token)** со scope'ами: `users:read`, `users:read.email`, `chat:write`, `im:write`.
   Установить в workspace, скопировать `xoxb-...`.

## Установка и деплой

```bash
npm install
forge register    # только если app.id ещё не ваш
forge deploy
forge install     # выбрать Jira и указать сайт
```

Токены и список пользователей **не задаются через CLI** — только на странице настроек после установки.

### Миграция со старой версии

Прежние env-переменные больше не читаются, их можно удалить:

```bash
forge variables unset TEMPO_TOKEN
forge variables unset SLACK_BOT_TOKEN
forge variables unset PROJECT_KEY
```

`PROJECT_KEY` заменён вкладкой «Users»: тот же список подтягивается кнопкой
«Load members» по ключу проекта, но дальше хранится явно и правится руками.

---

## Как проверить

- **Из UI** — кнопка «Start check», результат сразу в отчёте под ней.
- **Локально** — `npm test` (расчёт окна рабочих дней), `forge lint`, `forge tunnel` + `forge logs`.

---

## Известные подводные камни

1. **Нет cron** у scheduledTrigger — только `fiveMinute | hour | day | week`. Стоит `day`; выходные и
   окно рабочих дней считаются в коде (`src/backend/workdays.js`), защита от повторной рассылки —
   настройка «не повторять за день». Время запуска — UTC.
2. **Email скрыт настройками приватности** → Jira не отдаст `emailAddress`, Slack по нему не найдётся.
   Решение — вписать email вручную в таблице отслеживаемых.
3. **Egress**: любой внешний домен обязан быть в `permissions.external.fetch.backend`, иначе `fetch`
   отклонят (`REQUEST_EGRESS_ALLOWLIST_ERR`). `api.tempo.io` и `slack.com` уже прописаны.
4. **Rate limits**: Tempo режет на ~5 req/s — worklog'и тянутся одним пагинированным запросом на всё
   окно с ретраями на 429/5xx; между вызовами Slack стоят паузы.
5. **Размер значения в KVS** ограничен, поэтому отчёт о прогоне обрезается до 300 строк
   (сначала ошибки и пропуски); полный список — в `forge logs`.
6. `scheduledTrigger` стартует примерно через 5 минут после первого деплоя/установки.
7. **`@forge/events` v2+ сменил контракт консьюмера**: вместо `resolver: {function, method}` в
   манифесте пишется `function:`, а хендлер — обычная `export async function handler(event)`,
   где тело лежит в `event.body`. Старая форма **всё ещё проходит `forge lint`**, но рантайм
   отклоняет `queue.push()` с `400 Bad Request` без пояснений.
8. **Участники проекта берутся из ролей, а не из `/user/assignable/search`.** Тот эндпоинт отдаёт
   всех, у кого есть право «Assignable User»; если оно выдано на «Any logged in user», возвращается
   весь инстанс. Группы внутри ролей разворачиваются через устаревший `/rest/api/3/group?expand=users`:
   актуальный `/rest/api/3/group/member` требует scope `manage:jira-configuration` — право на изменение
   конфигурации Jira, непропорциональное для read-only приложения. Если Atlassian уберёт устаревший
   эндпоинт, альтернатива — добавить этот scope и перейти на `group/member`.
9. `"type": "module"` в package.json заставляет webpack считать наш код строгим ESM, из-за чего
   default-импорт CJS-пакета связывается со всем `module.exports`. Поэтому резолверы собираются
   через именованный `makeResolver()`, а не через `new Resolver()` (иначе — `out is not a constructor`).

---

## Источники

- [Scheduled trigger (manifest) — Forge](https://developer.atlassian.com/platform/forge/manifest-reference/modules/scheduled-trigger/)
- [Admin page module — Forge](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-admin-page/)
- [Async events API — Forge](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/)
- [Key-value store — Forge](https://developer.atlassian.com/platform/forge/runtime-reference/key-value-store/)
- [Runtime egress permissions — Forge](https://developer.atlassian.com/platform/forge/runtime-egress-permissions/)
- [Worklog REST APIs for Jira Cloud — Tempo](https://help.tempo.io/cloudmigration/latest/worklog-rest-apis-for-jira-cloud)
- [Slack users.lookupByEmail](https://docs.slack.dev/reference/methods/users.lookupByEmail/)
