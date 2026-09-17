# Vacations

A day covered by a vacation is not a debt: it is dropped from that person's missing days, so neither
they nor their manager is asked about it. Two switches control this — whether the calendar is used
at all, and whether to hold back the direct message while a person is on leave. The second only
silences the DM; the person still appears in their manager's digest, so the days are not forgotten.

Vacations come from a calendar you publish as a read-only feed: in Google Calendar, open the
calendar's **Settings → Integrate calendar** and copy the **Secret address in iCal format**. Anyone
with that link can read the calendar, so it is kept in Forge's encrypted storage and never shown
back. Google serves the feed from a cache, so a vacation entered minutes ago may take a while to
appear.

Events read from the feed are remembered, and a run that can't read the calendar uses that copy
instead of concluding that nobody is on leave — a dropped request used to turn into reminders sent
to people who weren't at work. A failed read is retried a few times first, an empty feed is treated
as a failed read while something is remembered, and an event that has already ended stays remembered
even if it is later deleted from the calendar, so tidying up the calendar can't turn past vacation
days back into a debt. Future events, on the other hand, follow the calendar: cancel one and the run
sees it gone. When a run falls back on the remembered copy, its report says so.

**Test calendar** reads the feed and shows how event titles line up with your tracked users.
Somebody spelled differently in the calendar than in Jira comes back as "no match" — the fix is the
**Name in the vacation calendar** column on the Users tab.
