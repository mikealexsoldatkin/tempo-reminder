# Connections

The app sends reminders on a schedule, so it needs its own access to Slack and Tempo. Only Jira
admins can open this tab. **Connect Slack** opens Slack: pick the workspace, press **Allow**, come
back.

Tempo needs one extra step, because a Tempo OAuth application belongs to the site it was created
in: a wizard links to the right Tempo screen, shows the redirect URI to copy, and takes the client
ID and secret it generates. Then **Connect Tempo** → **Authorize** — as somebody who may see
everybody's worklogs, or the rest will look like they never logged time.

**Test connections** checks both; a `rejected by` badge means the access was revoked.
