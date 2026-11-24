# Atlantis Portal

A messaging-first workspace: the shared SMS inbox, with the people and
work around it. Split out of the Atlantis ERP so that it can grow in its
own direction without carrying the ERP's customers, leads, tickets,
projects, inventory, vault and UniFi along with it.

## What is here

| Tab | What it does |
|---|---|
| Dashboard | What is waiting, what is yours, what is booked |
| Messages | The shared SMS inbox: conversations, groups, tags, notes |
| Contacts | The phone system's contact book |
| Employees | People, their access, and what they can see |
| Calendar | Outlook calendar |
| Tasks | A board: backlog, in progress, review, done |
| Notes | Shared notes |
| Logs | Activity |
| Settings | App settings |

## Getting it running

1. `npm install`
2. Create a **new** Supabase project — this app deliberately does not
   share the ERP's database.
3. Copy `.env.local.example` to `.env.local` and fill it in.
4. In the Supabase SQL editor, run, in this order:
   - `supabase/schema.sql`
   - `supabase/migration-record-access.sql`
   - `supabase/migration-employees-only-login.sql`
   - `supabase/migration-message-threads.sql`
   - `supabase/migration-message-senders.sql`
   - `supabase/migration-workflows.sql`
   - `supabase/migration-integrations.sql`
   - `supabase/migration-staff-only.sql` (before any customer can sign in)
   - `supabase/migration-conversation-access.sql`
   - `supabase/migration-google-contacts.sql`
   - `supabase/migration-phone.sql`
5. `npm run dev`

## Integrations

The Integrations page (Admin section; grant it in Edit Profile) connects
other systems. Code is in `lib/integrations/`.

| Connector | Connects with | Does |
|---|---|---|
| HubSpot | Private app token (`crm.objects.contacts.read`) | Reads contacts on a schedule |
| Google Sheets | A service account's JSON key; each sheet is shared with its email | Reads rows (first row = headings) on a schedule |
| Incoming webhook | A private URL, shown once | Takes contacts POSTed as JSON: Zapier, Make, n8n, a CRM's workflow rules |
| Outgoing webhook | A URL, optional signing secret | Posts `workflow.run`, `contacts.synced`, `webhook.received` events |

Every connector only *reads* from the other system. What comes in is kept
in `external_contacts` and names numbers in Messages and in the scheduler's
contact picker; the phone system's own contact book wins where both name a
number. Syncs run on the same every-minute timer as scheduled texts, each
at its own interval (15 minutes at the shortest).

`INTEGRATIONS_KEY` (64 hex characters) encrypts saved credentials. It must
be set in every deployment, and changing it means reconnecting each
integration.

## Phone (calling from the portal)

A phone button sits in the corner of every page for anyone with an
extension: a dialpad, an incoming-call card (it rings along with that
extension's desk phone and SNAPmobile), and mute, hold and keypad during a
call. Numbers in Messages, Inbox and Contacts dial through it. Code is in
`components/phone/` and `lib/phone.ts`.

- An administrator sets each person's extension in **Edit Profile → Phone**.
  Without one, nothing changes for them (numbers stay plain `tel:` links).
- The first time someone opens the portal with an extension, a SIP device
  `<ext>pt` is created on that extension in RingLogix for the browser.
- Calls ring in the browser only while a portal tab is open, and need the
  microphone allowed. Calls go out with the extension's own caller ID.
- `RINGLOGIX_WSS` (optional, comma-separated) overrides the WebSocket
  servers; the default is RingLogix's mia, dfw and sjc cores on port 9002.

## Google Contacts sync

On the Account page anyone can **Connect Google**: they pick their
extension, sign in with Google (contacts read-only), and the contacts saved
in that Google account are copied into their extension's RingLogix contact
book, then kept current. Code is `lib/google-contacts.ts`.

- The minute timer asks Google what changed every 5 minutes (a sync token,
  so it's one cheap call) and writes at most 60 RingLogix changes per person
  per minute; a big first sync takes a few minutes.
- It only ever updates or deletes contacts **it** added. A Google contact
  whose name is already in that book (RingLogix keeps one per name) is left
  out and listed on the card instead.
- Deleting a contact in Google deletes its copy. Disconnecting asks whether
  to keep or remove what was added.
- One person per extension.

Setup, once, in Google Cloud Console:

1. Create a project (or reuse one) and enable the **People API**.
2. OAuth consent screen: *External*, add the scope
   `.../auth/contacts.readonly`, then **Publish app** (in *Testing* Google
   expires every connection after 7 days). Until Google verifies the app,
   people see a "Google hasn't verified this app" screen and click
   *Advanced → Go to …*; fine for staff, and the limit is 100 people.
3. Credentials → Create OAuth client ID → *Web application*, with redirect
   URIs `https://portal.atlantisutility.com/api/google-contacts/callback`
   and `http://localhost:3000/api/google-contacts/callback`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (with
   `INTEGRATIONS_KEY`, which encrypts the stored Google tokens).

## Scheduled messages (workflows)

Texts that go out later or on a repeat, set up from Messages by anyone
holding the **Schedule messages** option (Edit Profile, under Messages).
Built as workflows, a trigger plus an action, so later automations add
triggers and actions rather than tables. Code is in `lib/workflows/`.

| Setting | What it does |
|---|---|
| `SCHEDULED_SMS_MODE` | Sending is **on** unless this is `off`. When it is `off`, every run still checks everything and the history shows who *would* have been texted, but nothing is sent. |
| `SCHEDULED_SMS_DAILY_CAP` | Most automated texts sent per day (Pacific), across all schedules. Default 200. |
| `CRON_SECRET` | The timer's password for `/api/cron/workflows`. Unset, the route refuses everything. |

The timer is a Supabase `pg_cron` job that calls the app every minute. It
needs the app's public address, so it is set up after deployment: the SQL
is at the bottom of `migration-workflows.sql`. Locally, a run can be
triggered by hand:

    curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/workflows

Safeguards: someone who has texted STOP is skipped; a run more than two
hours late is recorded as missed instead of sent; a repeat that missed
several runs fires once at its next slot, never in a burst; two timers
firing at once can't both send the same run.

`schema.sql` still creates a few tables this app has no pages for
(projects, tickets, vault). They are harmless, and leaving them means the
file stays identical to the one that is known to work rather than a
hand-edited copy that has never been run.

## What it shares with the ERP, and what it does not

Shares: the RingLogix PBX, and the Microsoft tenant for sign-in. Both
apps read the same mailbox, so a text answered in one is answered in the
other.

Does not share: the database. Employees, tasks, notes and settings here
are this app's own and start empty.
