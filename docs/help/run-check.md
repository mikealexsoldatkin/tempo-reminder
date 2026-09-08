# Run check

This tab runs exactly the same check as the schedule, but immediately, and it does send real
messages: a Slack DM to every tracked user missing time in the window, digests or all-clear notes
to every manager, and a detailed report for each person who has recipients in that column. A manual
run ignores the schedules, the weekday-only rule and the once-per-day limit, so it will send again
even if the same reminders went out an hour ago. That is why it asks for confirmation first, naming
how many people are about to be messaged.

If Slack or Tempo is not connected, or nobody is tracked yet, the tab says so instead of running —
there is nothing to check. While a run is in progress it shows its own progress; the run happens on
the server, so you can leave the page and come back to it.

Underneath is the report of the most recent run, scheduled or manual, and it is the best place to
answer "why did nothing arrive": who was reminded, who was clear, who was on leave, and anybody the
app could not reach — each with the reason.
