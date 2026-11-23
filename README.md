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
5. `npm run dev`

## Scheduled messages (workflows)

Texts that go out later or on a repeat, set up from Messages by anyone
holding the **Schedule messages** option (Edit Profile, under Messages).
Built as workflows, a trigger plus an action, so later automations add
triggers and actions rather than tables. Code is in `lib/workflows/`.

| Setting | What it does |
|---|---|
| `SCHEDULED_SMS_MODE` | Sending is **off** unless this is exactly `live`. Otherwise every run is a rehearsal: all checks run and the history shows who *would* have been texted, but nothing is sent. |
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
