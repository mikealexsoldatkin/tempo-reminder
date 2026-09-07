# Marketplace listing — Tempo Reminders

Готовый текст для Atlassian Marketplace (Partner Portal → Manage apps → *Tempo Reminders* →
Marketplace listing). Разделы соответствуют полям формы; лимиты символов указаны там, где площадка
их проверяет. Текст листинга — на английском: это язык витрины Marketplace, и он же язык интерфейса
приложения.

Заполнить перед публикацией: `{Vendor}`, `{support-email}`, `{docs-url}`, `{privacy-url}`.

---

## App name

```
Tempo Reminders
```

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

**3. Two clicks to connect, nothing to renew**

```
Slack and Tempo are connected with a button. The app keeps its own access alive — no API tokens to issue, paste or re-issue.
```

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
- **Tempo — one button.** Authorize once; the app renews its own access from then on. Tempo's
  manual API tokens expire on their own schedule, and a forgotten one means silence — this one
  doesn't need remembering.
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
- **Tempo Timesheets** (Cloud) — источник worklog'ов
- A **Slack** workspace, and the right to install an app in it
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

**Data the app sends out**, and where:

- `api.tempo.io` — reads worklogs for the checked window;
- `slack.com` — looks a person up by email and sends them a direct message;
- `calendar.google.com` — reads the vacation calendar, only if you set the iCal link.

Nothing is sent anywhere else. There is no vendor backend: the app runs as Forge functions in
Atlassian's cloud, and the vendor has no access to a customer's data.

**Jira permissions requested, and why:**

| Scope | Why |
| --- | --- |
| `read:jira-user` | search for people to track and read their display names |
| `read:jira-work` | read issue keys and summaries for the detailed report |
| `read:email-address:jira` | find the same person in Slack — matching is by email |
| `storage:app` | keep the settings, the tracked list and the credentials |

The app **never writes anything to Jira** and never posts to Slack channels — only direct messages.
The settings page is open to Jira administrators only (checked on the server, not just hidden in the
menu).

Privacy policy: `{privacy-url}`

---

## Pricing

```
Free
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
