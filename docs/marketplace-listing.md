# Marketplace listing — Tempo Reminders

Готовый текст для Atlassian Marketplace (Partner Portal → Manage apps → *Tempo Reminders* →
Marketplace listing). Разделы соответствуют полям формы; лимиты символов указаны там, где площадка
их проверяет. Текст листинга — на английском: это язык витрины Marketplace, и он же язык интерфейса
приложения.

Заполнить перед публикацией: `{Vendor}`, `{support-email}`, `{docs-url}`, `{privacy-url}`.

---

## App name

```
Timesheet Reminders for Tempo
```

Внутреннее имя приложения — `Tempo Reminders`, но в листинг это выносить не стоит: оно читается
как продукт самой Tempo. Правило Atlassian про товарные знаки — автоматический отказ, и хотя
дословно оно про названия Atlassian (`Jira App X` — отказ, `App X for Jira` — ок), безопасная
форма для чужого знака та же. Заодно снимается вопрос от самой Tempo.

Если название решено оставить как есть — стоит заранее получить от Tempo письменное разрешение на
использование их знака и приложить его к заявке.

## Summary (макс. 140 символов)

```
Slack reminders for unlogged time in Tempo — for the people who missed a day, and digests for their managers.
```

Запасные варианты, если понадобится короче или другой акцент:

```
Nobody chases timesheets by hand: Slack DMs for missing Tempo worklogs, manager digests, holidays and vacations respected.
```

```
Automatic Slack nudges when tracked Jira users have no Tempo worklogs for a working day.
```

## Categories

- Primary: **Time tracking**
- Secondary: **Reporting** (или **Notifications**, если доступна)

Tags: `tempo`, `timesheets`, `slack`, `reminders`, `worklogs`, `time tracking`, `notifications`

---

## Highlights (до 3 штук: заголовок ≤ 50 символов, текст ≤ 140)

**1. Chase timesheets without chasing anyone**

```
The app checks Tempo every working day and sends a Slack DM only to the people who actually missed time. No all-hands reminders.
```

**2. Managers get the picture, not the noise**

```
A digest of who is behind, an all-clear when everyone is done, and an optional day-by-day breakdown of what a person logged.
```

**3. Connect once, renew never**

```
Slack takes one button; Tempo takes a guided minute in its settings. After that the app keeps its access alive — no tokens to re-issue.
```

Прежний вариант — «Slack and Tempo are connected with a button» — обещал больше, чем приложение
делает: у Tempo перед кнопкой есть разовая регистрация OAuth-приложения в самом Tempo, и обойти её
нельзя. «Не работает, как заявлено» — отдельно названный повод к отказу, поэтому обещание
приведено к правде здесь и в разделе «Set up in minutes».

---

## Long description / More details

> Marketplace принимает ограниченный набор HTML-тегов (`p`, `ul`, `li`, `b`, `i`, `h3`, `a`).
> Ниже — текст в Markdown; при вставке заголовки станут `h3`, списки — `ul`.

### Timesheets get chased by the app, not by you

Every team that bills time knows the ritual: someone opens Tempo at the end of the week, finds the
people with empty days, and writes to each of them. Tempo Reminders does exactly that, on a schedule
you set, and only for the people you chose to track.

The app compares a list of Jira users you pick against their Tempo worklogs over the last N working
days. Anyone missing time for at least one of those days gets a direct message in Slack, listing the
days they missed. People who logged everything hear nothing.

### What it sends

- **A reminder to the person.** A Slack DM naming the exact days with no worklogs. Nobody is asked
  about days they were on holiday or on vacation.
- **A digest to their manager.** One message listing who is behind and for which days — not one
  message per employee.
- **An all-clear to the manager.** When everyone on their team has logged their time, the manager is
  told so. Silence should never be indistinguishable from a broken integration.
- **A detailed report, for the people you mark.** A day-by-day breakdown of what was logged: hours,
  issue key, Tempo work attribute and the worklog description.

Every message is a template you can rewrite, with placeholders for the person's name, the window,
the missing days and the manager's own list.

### It knows which days are not working days

- **Weekends** are skipped, both in the window and in the schedule.
- **Holidays** are stored as rules, not dates — "last Monday of May" stays correct next year. The
  app ships with a starting calendar you can edit.
- **Vacations** are read from a corporate calendar over its secret iCal link. A day covered by a
  vacation is not a debt, and a person on leave can be left alone until they are back.
- **Grace period.** Today's time is usually not expected yet — you decide how many of the most
  recent working days are excused.

### Set up in minutes

- **Slack — one button.** No Slack app to create, no scopes to assemble, no `xoxb-` token to copy.
  The bot only asks for what it needs: find a person by email and write them a direct message.
- **Tempo — a minute once, then one button.** Tempo's OAuth applications belong to the Jira site
  they were created in, so the app can't ship one for everybody: a wizard on the Connections tab
  walks a Jira admin through registering one in their own Tempo — it links straight to the right
  screen and shows the redirect URI ready to copy. After that it is a single **Connect Tempo**, and
  the app renews its own access from then on. Tempo's manual API tokens expire on their own
  schedule, and a forgotten one means silence — this one doesn't need remembering.
- **People — searched or added by project.** Add users by name, or pull in everyone from a project's
  roles.
- **A readiness banner** on top of the settings page names anything that would keep messages from
  going out — a broken connection, an empty schedule, nobody tracked — so a half-finished setup
  doesn't look like a working one.

### Run it by hand whenever you like

The "Run check" tab does the same check immediately and shows a full report: who was reminded, who
was clear, who is on leave, and anyone the app could not reach — with the reason.

### Built on Forge

The app runs entirely on Atlassian's Forge platform: no external servers, no vendor infrastructure
holding your data. Credentials live in Forge's encrypted storage and are never shown back — the
settings page only says whether a connection works.

---

## Screenshots (подписи)

1. **Connections** — `Slack and Tempo are connected with a button; the app keeps its own access alive.`
2. **Users** — `Pick who is tracked, who manages them, and who gets a day-by-day report.`
3. **Check parameters** — `The window, the grace period, the schedule and every message template.`
4. **Holidays** — `Holidays are rules, so “last Monday of May” stays correct next year.`
5. **Run check** — `Run the same check by hand and see exactly who was reminded and why.`
6. **Slack DM** — `What the person actually receives: the days they are missing, nothing else.`

---

## Requirements (для описания и для поля "App details")

- Jira Cloud
- **Tempo Timesheets** (Cloud) — источник worklog'ов. **Платное приложение Tempo, покупается
  отдельно и в цену этого приложения не входит**: скрытая платная зависимость у бесплатного
  приложения — отдельно названный повод к отказу на ревью, поэтому формулировка обязана быть такой
  же прямой и в поле «App details»
- A **Slack** workspace, and the right to install an app in it
- **Tempo administrator rights** for the one-time setup: an OAuth 2.0 application is registered in
  the customer's own Tempo (the app's Connections tab walks through it). Tempo's OAuth applications
  belong to the site they were created in, so this step cannot be done by the vendor in advance
- The person who connects Tempo must be able to see everybody's worklogs in Tempo
- Optional: a calendar with vacations, published as a secret iCal link

---

## Support

```
Support: {support-email}
Documentation: {docs-url}
Response time: {напр. 2 business days}
```

Раздел «Support» в листинге:

```
Questions, bugs and feature requests go to {support-email}. Setup instructions and troubleshooting
live at {docs-url}.
```

---

## Privacy and security (для вкладки Privacy & security и Security Self-Assessment)

**Data the app stores** (in Forge storage, inside Atlassian's infrastructure):

- the list of tracked Jira users and managers: account id, display name, email address;
- settings: schedule, window, message templates, holiday rules;
- the report of the most recent run;
- access credentials for Slack and Tempo, and the secret iCal link — in Forge's **encrypted
  storage** (`kvs.setSecret`), never returned to the UI.

**Data the app sends out** — the complete list of remote hostnames (same three go into the
«remote hostnames / IP addresses» field of the listing), and exactly what leaves with each:

| Host | What is sent | What comes back |
| --- | --- | --- |
| `api.tempo.io` | the Jira account id of a tracked person and the dates of the checked window | worklogs: days, hours, issue ids, descriptions, work attributes |
| `slack.com` | a person's email address (to find them in Slack), their Slack user id, and the text of the direct message | the bot token, and whether the message was delivered |
| `calendar.google.com` | nothing but the secret iCal address the customer configured themselves | the vacation calendar |

**There is no vendor infrastructure at all.** No analytics, no telemetry, no crash reporting, no
logs leaving the platform, no servers of ours in the path: the app is Forge functions and Forge
storage, and the vendor has no access to a customer's data. Everything above is a call the customer
asked for — Tempo is where the worklogs are, Slack is where the reminders go, and the calendar is
one the customer pasted.

**Data residency** of everything the app stores follows Forge storage, which follows the host Jira
site. Slack and Tempo are the customer's own external systems, chosen by them; the app adds no
third-party processor of its own.

**Runs on Atlassian.** The app does not carry the badge, and deliberately so — the programme allows
egress only for analytics and only without end-user data, while this app's whole purpose is to read
worklogs from Tempo and write messages in Slack. Two things make it ineligible, both intrinsic: the
three hosts above, and the two `webtrigger` modules that receive the OAuth redirects from Slack and
Tempo (a public HTTP entry point counts as an egress vector regardless of what it does). The
alternative — API tokens pasted by hand and re-issued every 30 days — would be worse for the
customer, so the trade was made knowingly.

**Jira permissions requested, and why:**

| Scope | Why |
| --- | --- |
| `read:jira-user` | search for people to track and read their display names |
| `read:jira-work` | read issue keys and summaries for the detailed report |
| `read:email-address:jira` | find the same person in Slack — matching is by email |
| `storage:app` | keep the settings, the tracked list and the credentials |

The app **never writes anything to Jira** and never posts to Slack channels — only direct messages.
The settings page is open to Jira administrators only (checked on the server, not just hidden in the
menu). The two web triggers that receive the OAuth redirects are protected by a single-use nonce
that is created in the settings page, lives ten minutes and is burnt on first check — the address
alone gets a caller nowhere.

Privacy policy: `{privacy-url}`

---

## Pricing

```
Free
```

В поле с ценой этого мало: бесплатным является только это приложение. **Tempo Timesheets —
платное приложение Tempo и покупается отдельно**, без него источника worklog'ов нет вовсе. Это же
предложение должно стоять в описании и в Requirements, иначе заявка попадает под прямо названный
повод к отказу — «скрытые платные сторонние требования у бесплатного приложения»:

```
The app itself is free. It reads worklogs from Tempo Timesheets, which is a separate paid app by
Tempo and is not included — you need it (and a Slack workspace) for this app to have anything to do.
```

---

## Release notes / What's new (первая публикация)

```
First release.

- Slack DMs to tracked Jira users who have no Tempo worklogs for a checked working day
- Manager digests, all-clear notes and optional day-by-day reports
- Weekends, holiday rules and vacations from an iCal calendar are all respected
- Slack and Tempo are connected with a button; the app renews its Tempo access itself
- Manual run with a full report of who was reminded and who could not be reached
```
