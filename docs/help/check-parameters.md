# Check parameters

**Working days to check** is the window: the last N working days, each checked separately, so an
empty day counts even if the rest of the week is full. **Acceptable days of delay** forgives the
freshest days of that window — the default of 1 means today is never asked about, because the time
for it may still be coming.

**Run times** and **Manager run times** are two independent schedules, comma-separated, on a
24-hour clock **in UTC**; an empty list switches that mailing off. The app wakes up once an hour, so
a check starts at the top of the hour following the time you set. Under the fields it shows the
current time and when the next run is due — read it after every change.

The rest of the tab is the message texts: the personal reminder, the manager digest, the day-by-day
detailed report and the all-clear a manager gets when their whole team is done. Each takes
placeholders — `{name}`, `{missing}`, `{days}`, `{from}`, `{to}` — listed under the field itself.
Fields save when you leave them; there is no Save button.
