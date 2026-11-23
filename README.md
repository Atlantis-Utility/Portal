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
5. `npm run dev`

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
