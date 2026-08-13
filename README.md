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

Jira → **Настройки** → **Приложения** → **Напоминания о Tempo**. Доступна только администраторам Jira
(резолверы дополнительно проверяют право `ADMINISTER` — adminPage лишь прячет пункт меню).

### 1. Вкладка «Пользователи»
Вместо прежнего `getProjectPeople()` список отслеживаемых людей задаётся вручную:

- **Поиск по имени** — вводите First + Last name (Jira ищет и по email), отмечаете нужных
  галочками и добавляете **батчем**.
- **Добавить участников проекта** — по ключу проекта подтягивает всех назначаемых на задачи
  (прежнее поведение), ещё не отслеживаемые отмечаются автоматически.
- **Таблица отслеживаемых** — удаление по одному и батчем, плюс ручная правка email.

> **Про email.** Slack ищется по email, а Jira отдаёт его только если профиль не скрыт настройками
> приватности. Для таких людей в таблице будет «укажите email» — впишите его вручную, иначе
> напоминание не уйдёт. Найденный Slack-id кэшируется, чтобы не звать `users.lookupByEmail` каждый прогон.

### 2. Вкладка «Токены и настройки»
- **Tempo API token** и **Slack bot token** — password-поля. Значения кладутся в секретное хранилище
  Forge (`kvs.setSecret`) и наружу **никогда не возвращаются**: UI видит только «задан / не задан»,
  последние 4 символа и дату обновления.
- **Проверить подключение** — дёргает Tempo и Slack `auth.test` текущими токенами.
- Параметры: глубина окна в рабочих днях, пропуск выходных, «не повторять за день», шаблон
  сообщения с плейсхолдерами `{name}`, `{from}`, `{to}`, `{days}`.

### 3. Вкладка «Запуск проверки»
Кнопка **«Инициировать проверку»** запускает тот же прогон, что и расписание, но немедленно и в обход
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

`PROJECT_KEY` заменён вкладкой «Пользователи»: тот же список подтягивается кнопкой
«Загрузить участников» по ключу проекта, но дальше хранится явно и правится руками.

---

## Как проверить

- **Из UI** — кнопка «Инициировать проверку», результат сразу в отчёте под ней.
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

---

## Источники

- [Scheduled trigger (manifest) — Forge](https://developer.atlassian.com/platform/forge/manifest-reference/modules/scheduled-trigger/)
- [Admin page module — Forge](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-admin-page/)
- [Async events API — Forge](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/)
- [Key-value store — Forge](https://developer.atlassian.com/platform/forge/runtime-reference/key-value-store/)
- [Runtime egress permissions — Forge](https://developer.atlassian.com/platform/forge/runtime-egress-permissions/)
- [Worklog REST APIs for Jira Cloud — Tempo](https://help.tempo.io/cloudmigration/latest/worklog-rest-apis-for-jira-cloud)
- [Slack users.lookupByEmail](https://docs.slack.dev/reference/methods/users.lookupByEmail/)
