# Напоминание в Slack о незалогированном времени (Jira Automation + Tempo + Slack)

Правило Jira Automation (Cloud), которое по расписанию перебирает участников проекта, проверяет
в Tempo, репортились ли они за последние **2 рабочих дня**, и тем, кто не репортился, отправляет
**личное сообщение (DM) в Slack**.

---

## 0. Ключевая идея (упрощение логики)

Не нужно вычислять «дату последнего репорта» и сравнивать её. Достаточно спросить у Tempo:
**есть ли хоть один worklog у этого человека в окне «последние 2 рабочих дня»?**

- worklogs есть → всё ок, ничего не делаем;
- worklogs пусто → человек не репортился → шлём DM.

Это убирает необходимость сортировать/находить максимум по датам внутри Automation (что в smart-values
неудобно) и делает правило надёжнее.

---

## 1. Что нужно подготовить заранее

**Tempo API token**
Tempo → Settings → API integration → New token. Даёт доступ к `https://api.tempo.io/4/...`.
Используется как `Authorization: Bearer <TEMPO_TOKEN>`.

**Slack App (Bot token)**
Создать app на api.slack.com, добавить Bot Token Scopes:

- `users:read`
- `users:read.email` — обязателен, чтобы искать пользователя по email;
- `chat:write`
- `im:write` (открыть личку).

Установить app в workspace, взять `xoxb-...` токен. Используется как `Authorization: Bearer xoxb-...`.

**Как правило будет получать email людей**
Для DM нужен Slack-пользователь, а его ищем по email. Есть две стратегии — выберите одну (раздел 4, шаг 2).

> ⚠️ В Jira Cloud email часто скрыт настройками приватности профиля, и API `assignable/search`
> может вернуть пользователей **без** поля `emailAddress`. Если у вас так — используйте вариант
> с ручной таблицей соответствия (accountId → Slack ID). Это самый предсказуемый путь.

---

## 2. Честно об ограничениях «строго Jira Automation»

Вы выбрали реализацию только на Automation — это работает, но держите в голове:

1. **Список участников проекта.** У Automation нет готового шага «взять всех членов проекта».
   Придётся либо дёргать Jira REST (`assignable/search` или members роли), либо вести список вручную.
2. **Лимиты цикла.** Advanced branching / Loop имеют ограничения на число итераций и на глубину
   вложенности (максимум 2 уровня вложенности Loop/Branch). Для команды в десятки человек — ок,
   для сотен — упрётесь.
3. **Пагинация.** Tempo отдаёт постранично (`limit`/`offset`). В нашем сценарии это неважно —
   нам нужен только факт «есть/нет worklog», поэтому берём `limit=1`.
4. **Приватность email** (см. выше).
5. **Один web-request на человека к Tempo + до двух к Slack** — следите за rate limit'ами
   (Slack Tier 3/4, Tempo ~5 req/s). Для большой команды добавьте паузы/батчи.

Если позже упрётесь в лимиты — тот же алгоритм переносится во внешний скрипт по расписанию за час.

---

## 3. Триггер и общая структура правила

```
[Scheduled trigger]  cron: 0 9 * * 1-5   (每 будни в 09:00; выходные пропускаем)
     │  (JQL в триггере НЕ используем)
     ▼
[Create variable]  varFrom   = дата начала окна «2 рабочих дня»
[Create variable]  varTo     = сегодня
     │
     ▼
[Create variable]  varPeople = список людей (JSON-массив)   ← см. шаг 2 (вариант A или B)
     │
     ▼
[Advanced branch / For each]  по элементам varPeople
     │
     ├─ [Send web request]  Tempo: worklogs пользователя за окно
     │
     ├─ [Condition]  worklogs пусто?
     │       └─ да ▼
     │           ├─ (вариант A) [Send web request] Slack users.lookupByEmail → varSlackId
     │           └─ [Send web request] Slack chat.postMessage (DM)
     │       └─ нет → пропустить
```

---

## 4. Пошаговая настройка

### Шаг 0. Триггер
**Trigger → Scheduled.**
- Rate: cron expression `0 9 * * 1-5` (будни, 09:00 по TZ инстанса).
- **Не задавайте JQL** в триггере (иначе правило пойдёт по issue, а не по людям).

### Шаг 1. Границы окна (рабочие дни)

Добавьте action **Create variable**.

`varTo`:
```
{{now.format("yyyy-MM-dd")}}
```

`varFrom` — начало окна «2 рабочих дня назад». Т.к. в понедельник и вторник нужно перепрыгнуть
через выходные, offset зависит от дня недели (`u` = ISO день недели, 1=Пн … 7=Вс):

```
{{#if(or(equals(now.format("u"),"1"),equals(now.format("u"),"2")))}}{{now.minusDays(4).format("yyyy-MM-dd")}}{{/}}{{#if(or(equals(now.format("u"),"3"),equals(now.format("u"),"4"),equals(now.format("u"),"5")))}}{{now.minusDays(2).format("yyyy-MM-dd")}}{{/}}
```

Логика offset:

| День запуска | «2 рабочих дня назад» | offset |
|---|---|---|
| Пн | Чт | `minusDays(4)` |
| Вт | Пт | `minusDays(4)` |
| Ср | Пн | `minusDays(2)` |
| Чт | Вт | `minusDays(2)` |
| Пт | Ср | `minusDays(2)` |

Окно проверки = `[varFrom … varTo]` (включая сегодня, чтобы не пинговать тех, кто уже залогировался утром).

> Если хочется проще и вы согласны на календарный вариант — поставьте `varFrom = {{now.minusDays(4).format("yyyy-MM-dd")}}`
> и оставьте расписание только по будням. Это приближение «последних рабочих дней».

### Шаг 2. Список людей (`varPeople`)

**Вариант A — тянуть из Jira REST (автоматически).**
Add action **Send web request** ДО ветвления:

- URL: `{{baseUrl}}/rest/api/3/user/assignable/search?project=<PROJECT_KEY>&maxResults=200`
- Method: `GET`
- Headers: авторизация — используйте **Atlassian connection** правила (или Basic с API-токеном администратора).
- Delay execution: ✅ «Wait for response».

Ответ — массив пользователей. Дальше `varPeople = {{webResponse.body}}`.
Каждый элемент: `accountId`, `displayName`, и (если не скрыт) `emailAddress`.

**Вариант B — ручная таблица (надёжнее, если email скрыты).**
Add action **Create variable** `varPeople` со значением-JSON, где вы сами сопоставили
Jira accountId и Slack member ID (Slack ID берётся из профиля → «Copy member ID»):

```json
[
  {"accountId":"5b10a2...","slackId":"U01ABCDEF"},
  {"accountId":"557058:...","slackId":"U02GHIJKL"}
]
```

Плюс варианта B: не зависите от приватности email и пропускаете шаг `users.lookupByEmail`.

### Шаг 3. Ветвление по людям

Add **Advanced branching** (или **For each** loop, если у вас доступен premium-компонент Loop):

- Type / Smart value: `{{varPeople}}`
- Variable name: `person`

Всё, что ниже, выполняется для каждого `person`.

### Шаг 4. Запрос в Tempo — есть ли worklog в окне

Внутри ветки add action **Send web request**:

- URL:
  ```
  https://api.tempo.io/4/worklogs/user/{{person.accountId}}?from={{varFrom}}&to={{varTo}}&limit=1
  ```
- Method: `GET`
- Headers:
  - `Authorization: Bearer <TEMPO_TOKEN>`
  - `Accept: application/json`
- Delay execution: ✅ «Wait for response».

Ответ Tempo v4 имеет вид:
```json
{ "results": [ ... ], "metadata": { "count": 0, "offset": 0, "limit": 1 } }
```
Нас интересует, пуст ли `results` (или `metadata.count`).

### Шаг 5. Условие «не репортился»

Add **Condition → Advanced compare condition**:

- First value:
  ```
  {{webResponse.body.metadata.count}}
  ```
- Condition: `equals`
- Second value: `0`

(Альтернатива, если `count` не приходит: сравнить `{{webResponse.body.results.size}}` с `0`.)

Только при выполнении условия идём отправлять DM.

### Шаг 6a. (Только вариант A) Найти Slack ID по email

Add **Send web request**:

- URL: `https://slack.com/api/users.lookupByEmail?email={{person.emailAddress}}`
- Method: `GET`
- Headers: `Authorization: Bearer xoxb-...`
- Wait for response ✅.

Ответ: `{ "ok": true, "user": { "id": "U0..." } }`.
Сохраните: add **Create variable** `varSlackId = {{webResponse.body.user.id}}`.

(В варианте B пропускаем — `slackId` уже в `person.slackId`.)

### Шаг 6b. Отправить DM в Slack

Add **Send web request**:

- URL: `https://slack.com/api/chat.postMessage`
- Method: `POST`
- Headers:
  - `Authorization: Bearer xoxb-...`
  - `Content-Type: application/json`
- Body type: Custom data
- Body:
  ```json
  {
    "channel": "{{varSlackId}}",
    "text": ":clock3: Привет! Похоже, в Tempo нет твоих записей времени за последние 2 рабочих дня. Загляни и зарепортись, пожалуйста: <твоя-ссылка-на-Tempo>"
  }
  ```
  (в варианте B `"channel": "{{person.slackId}}"`.)

Slack сам откроет личку, если передать в `channel` user ID — отдельный `conversations.open` не обязателен.

---

## 5. Проверка и отладка

1. **Ручной прогон**: временно замените расписание, нажмите «Run rule» и смотрите **Audit log**.
2. **Изолируйте API**: сначала проверьте оба запроса Tempo и Slack вручную (Postman/curl) с реальным
   `accountId`, чтобы убедиться в токенах и форме ответа, — потом переносите в правило.
3. **Тест на себе**: временно сузьте `varPeople` до одного своего accountId и заведомо пустого окна.
4. **Проверьте `count` vs `results.size`** на реальном ответе Tempo — используйте то поле, что реально приходит.
5. **Email скрыт?** Если `users.lookupByEmail` возвращает `users_not_found` — переключайтесь на вариант B.
6. **Логи Slack**: при ошибке ответ придёт как `{ "ok": false, "error": "..." }` — читайте `error`.

---

## 6. Идеи на будущее (необязательно)

- Собирать «отставших» в один список и слать тимлиду сводку в канал (доп. ветка).
- Не слать DM тем, кто в отпуске (проверять Tempo `/4/plans` или календарь отсутствий).
- Настраиваемый порог часов (не просто «есть worklog», а «≥ N часов за окно»).

---

## Источники

- [Worklog REST APIs for Jira Cloud — Tempo Help Center](https://help.tempo.io/cloudmigration/latest/worklog-rest-apis-for-jira-cloud)
- [Tempo REST API documentation (apidocs)](https://apidocs.tempo.io/)
- [Jira automation branches — Atlassian Support](https://support.atlassian.com/cloud-automation/docs/jira-automation-branches/)
- [Advanced automation steps (Loop/Branch) — Atlassian Support](https://support.atlassian.com/cloud-automation/docs/advanced-automation-components/)
- [Automation smart values — JSON functions — Atlassian Support](https://support.atlassian.com/cloud-automation/docs/jira-smart-values-json-functions/)
- [Jira automation triggers (Scheduled) — Atlassian Support](https://support.atlassian.com/cloud-automation/docs/jira-automation-triggers/)
- [Slack users.lookupByEmail — Slack Developer Docs](https://docs.slack.dev/reference/methods/users.lookupByEmail/)
- [Sending DMs from a Slack bot (chat.postMessage)](https://medium.com/@shiv0403gupta/sending-dms-from-slack-bot-72b3ffea93f5)
