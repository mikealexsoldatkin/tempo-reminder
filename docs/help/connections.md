# Connections

The app talks to Slack and Tempo on its own schedule — at night, when nobody is logged in — so it
needs its own access to both. The **Connections** tab is where that access is granted, checked and
revoked. Nothing else in the app works until both panels here are green.

Only Jira administrators can open this tab. That is enforced on the server, not merely hidden from
the menu, so a link to the page is useless to anybody else.

> **Screenshot:** the Connections tab with both panels connected.

---

## What you need before you start

| For | You need |
| --- | --- |
| Slack | the right to install an app in your Slack workspace (otherwise a Slack admin has to do this step) |
| Tempo | Tempo administrator rights, once, to register an OAuth application |
| Tempo | to be able to see **everybody's** worklogs in Tempo — see the warning below |

---

## Connect Slack

1. Press **Connect Slack**. A Slack tab opens.
2. Pick the workspace and press **Allow**.
3. Come back. The Connections tab notices the new connection on its own within a few seconds —
   there is nothing to paste and nothing to refresh.

Slack asks you to approve three permissions, and no more: `chat:write` to send a direct message,
`users:read` and `users:read.email` to find the right person by their email address. The app never
posts to channels — only direct messages — and it never reads anybody's messages.

If the workspace list on the Slack screen is empty, or Slack says you may not install apps, ask a
Slack administrator to press the button instead; they only need Jira admin rights for the duration
of this one step.

**What the badge means**

| Badge | Meaning |
| --- | --- |
| `connected · Acme` | working; messages are sent by the app's bot in the *Acme* workspace |
| `not connected` | nothing is being delivered to anybody |
| `rejected by Slack` | the app was removed from the workspace, or the token was revoked there. Press **Connect Slack** again |

---

## Connect Tempo

Tempo takes one extra step the first time, and there is no way around it: **a Tempo OAuth
application belongs to the Jira site it was created in**. We cannot ship one that works for
everybody — an application registered anywhere else answers *"Invalid client id"*. So the app walks
you through registering one in your own Tempo. It takes about a minute, once, and after that nobody
opens Tempo settings again.

### Step 1 — register the application (once)

While no application is known, the Tempo panel shows a short wizard instead of the connect button.

1. Follow the link in the first step. It opens **Tempo → Settings → Data Access → OAuth 2.0
   Applications** in your own site. Press **New Application**.
2. Fill in:
   - **Name** — anything recognisable, e.g. `Timesheet Reminders`;
   - **Redirect URI** — the address the wizard shows, copied in full. It belongs to this
     installation alone and is different in another Jira, so do not reuse one from elsewhere and do
     not append anything to it;
   - **Client type** — `Confidential`. The client secret is kept on the app's server side and never
     reaches a browser;
   - **Authorization grant type** — `Authorization code`.
3. Press **Create Application**. Tempo shows a **Client ID** and a **Client secret**.
4. Paste both into the two fields in the wizard and press **Save application**.

Tempo shows the client secret only once, at creation. If it is lost, create a new application and
save the new pair — nothing else needs redoing.

> **Screenshot:** the Tempo wizard with the redirect URI and the two fields.

### Step 2 — authorize (one button, from now on)

1. Press **Connect Tempo**. A Tempo tab opens.
2. Press **Authorize**.
3. Come back; the panel picks up the connection by itself.

From here the app renews its own access. Tempo's manual API tokens expire on their own schedule and
a forgotten one means silence; this connection has nothing to remember.

### Who should press Authorize

> **Tempo grants access with the permissions of whoever authorized it.** If that person cannot see
> somebody's worklogs in Tempo, the app cannot see them either — and that person will look like
> they never logged any time, and get reminded every day for time they did log.

So the person who authorizes should be somebody who may view everybody's worklogs, and the same is
true if their permissions later change. If the access is revoked in Tempo, or the authorizing person
loses that permission, the panel turns to `rejected by Tempo` and nothing is checked until somebody
connects again.

### The application line

Once an application is saved, the wizard collapses to a single line — *"OAuth application:
registered in this site's Tempo"* — with two links:

- **Replace** — reopens the wizard, for a new client secret or a different application;
- **Forget** — deletes the client ID and secret from storage. The access already granted keeps
  working until it expires, but the app can no longer renew it, and connecting again will need an
  application. The application itself stays in Tempo; delete it there if you no longer need it.

---

## Test connections

The **Test connections** button in the tab header calls both systems immediately and shows the
result inside each panel, next to that system's badge. Use it after connecting, and whenever
reminders stop arriving.

It is also the second place — after a nightly run — where a revoked access shows up. A test that
comes back with a permission error will flip the badge to `rejected by Slack` or `rejected by Tempo`
right there, rather than leaving a green badge next to a red line.

---

## Disconnecting

**Disconnect** revokes the access on the far side and deletes it from the app's encrypted storage.
The app stays installed in Jira and keeps its settings, tracked people and holidays — it simply
stops delivering anything until you connect again. Connecting Slack again is one click; connecting
Tempo again is one click too, as long as the OAuth application is still saved.

A Tempo token that was pasted by hand in an older version cannot be revoked from here — the app did
not issue it. **Disconnect** removes it locally and tells you to revoke it in
**Tempo → Settings → API integration**, where it was created.

---

## If something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| `Invalid client id` on the Tempo screen | the OAuth application was created in a different Jira site's Tempo | register one in **this** site's Tempo, with the wizard |
| `redirect_uri did not match any configured URIs` | the Redirect URI in the Tempo (or Slack) application is not the one the app sends | copy the address from the wizard again, in full; in Slack, remember to press **Save URLs** |
| `Tempo does not recognise this OAuth application` | as above, or the client secret was copied incompletely | press **Replace** and paste both values again |
| `Waiting for Slack / Tempo` never resolves | the consent tab was closed, or the link expired — it lives ten minutes | press the connect button again |
| `rejected by Slack` | the app was removed from the workspace, or the token was revoked | **Connect Slack** again |
| `rejected by Tempo` | access was revoked in Tempo, or the authorizing person lost the right to see other people's worklogs | **Connect Tempo** again, as somebody who can see everybody's worklogs |
| Somebody is reminded although they did log their time | the person who authorized Tempo cannot see that person's worklogs | reconnect Tempo as somebody who can |
| `Tempo can't be connected in this build` / `Slack can't be connected in this build` | the deployment is missing its Slack credentials | this is a build problem, not a setup one — contact support |

---

## Where the credentials live

Everything granted here goes into Forge's encrypted storage, inside Atlassian's infrastructure, and
is never shown back: the panels only ever say whether a connection works, when it was made, and the
last four characters of a value. The app has no servers of its own — no analytics, no telemetry, no
logs leaving the platform. The only external calls it ever makes are to `api.tempo.io`,
`slack.com`, and the vacation calendar address you configure yourself on the **Vacations** tab.

The two return addresses that Slack and Tempo send your browser back to are protected by a
single-use code that is created when you press the button, lives ten minutes and is burnt on first
use — knowing the address alone gets a caller nowhere.
