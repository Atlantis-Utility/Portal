<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Atlantis Portal

A messaging-first workspace for Atlantis Utility, a VoIP/ISP reseller in
Ventura County, CA. Split out of their ERP on 2026-11-22, because the
shared SMS inbox turned out to be the interesting part.

Nine tabs: dashboard, messages, contacts, employees, calendar, tasks,
notes, logs, settings. Everything else the ERP had — customers, leads,
tickets, projects, inventory, vault, UniFi, GDMS — was deliberately left
behind. Don't reintroduce it by accident when porting code across.

## What it talks to

**RingLogix** (`lib/ringlogix.ts`) is the phone system, and the one piece
of real infrastructure here. Credentials are the API user `api@277215`
with **Reseller** scope, plus a separate API application. Hard-won facts:

- `messagesession` and `message` are the SMS objects, keyed by **domain +
  user**. `user=*` returns the whole mailbox in one call — undocumented,
  but it works and is 54× cheaper than walking the subscriber list.
- Sending a text needs `type=sms` **and** `from_num`. Without them the
  PBX accepts the message as an internal *chat*, answers 202, and it
  never leaves the building.
- An accepted write answers **202 with an empty body**. `res.json()` on
  that throws; `pbxApiRaw` handles it.
- A group's far side is a **JSON array** of numbers, and a group is
  addressed by listing them comma-separated.
- `from_uid` names the extension that sent a message. `direction` is
  empty on internal chats, so direction is derived from `from_uid`.
- Timestamps are stored **UTC without a marker**.
- Message reads are cached 5s, contacts 20s (and cleared on every contact
  write), everything else 3 minutes.
- **Contacts are per extension**, read with `user=<ext>`; `user=*` is the
  shared (company-wide) book, and a shared contact also appears in every
  extension's read with `"shared": true`. Contacts saved from Messages go
  into the conversation's extension (often 100), so the Contacts tab reads
  every book at once.
- **`contact/create` matches BY NAME within a book**: a second "John Smith"
  overwrites the first one's details instead of adding an entry (verified
  2026-11-23). The contacts route refuses a same-name save with a 409 until
  the caller confirms a replace (`lib/contact-save.ts`).
- **Making a contact shared via the API is unsolved**: `shared=yes` on
  create is accepted (200) but ignored, and the call updates the existing
  same-name contact instead. Ask RingLogix for the parameter before
  guessing further on the live PBX.
- Group senders: an inbound message in a group carries the individual
  sender in `from_num`.
- **MMS goes through v2, not the gateway.** The v1 gateway can't attach a
  file (`upload/create` returns nothing). The core server
  `core2-mia.ringlogix.com/ns-api/v2` (`RINGLOGIX_CORE_URL`) accepts our
  gateway token unchanged and takes the file inline: `POST
  /domains/{d}/users/{u}/messagesessions/{sid}/messages` with JSON `type:
  "mms"`, `from-number`, `destination`, base64 `data`, `mime-type`, `size`
  (`sendMedia`). Session ids are the same in v1 and v2. It answers 202 with
  no id, `message` must be non-empty, 409 = everyone opted out, 415 = the
  carrier refuses the file type. Verified 2026-11-23.
- **UC Inbox** (`conversation/read`, `lib/inbox.ts`) returns one
  extension's chats and voicemails; it refuses `user=*`, so the Inbox walks
  every extension **three at a time** (more answers 429). It never returns
  calls here: calls come from `cdr2/read` (`type` 0 out, 1 in, 3 internal;
  epoch-second times). Voicemail `filedate` is **UTC** despite the row's
  `TimeZone: US/Pacific` (checked against the call record). A recording's
  `remotepath` opens **without any login**, so it only ever goes through
  `/api/inbox/voicemail`, never to the browser.
- Still refused: `domain/read`, `reseller/read`, and there is no webhook,
  so Messages polls.

**Microsoft** signs people in (Supabase `azure` provider) and provides the
calendar. The refresh token lands in the `outlook_refresh` cookie. Every
grant that writes that cookie must request the same scopes
(`lib/microsoft/scopes.ts`), or one flow silently narrows another's token.

**Supabase** is this app's own project — *not* the ERP's. See the README
for which migrations to run.

## House rules worth knowing

- **Dark mode is an allowlist.** `app/globals.css` darkens a fixed set of
  hex classes. A background outside that list stays bright white at
  night. Check before choosing a colour.
- **React Compiler lint is on.** `react-hooks/set-state-in-effect` is an
  error: derive state, or use lazy initial state — never `setState` in an
  effect.
- **Page access** is a list of hrefs on the employee record
  (`lib/nav-pages.ts`). A page missing from `NAV_PAGES` is reachable by
  everyone; a newly added page is in nobody's saved list until it is
  ticked in Edit Profile — administrators included.
- **Identity is by email**, never `employee_id`: administrators have a
  null one.
- **Passwords for people outside Microsoft** (`lib/passwords.ts`): an
  administrator sets one (`/api/auth/admin-password`), temporary by default
  via `app_metadata.must_change_password`, which `requireEmployee` /
  `requireAdmin` and AuthGuard all refuse until `/api/auth/my-password`
  clears it. A person changes their *own* password through their own
  session (`updateUser`): the admin API's password change ends every
  session the login has, signing them straight out.
- `lib/db` reads go through `selectAll`, because PostgREST silently
  truncates a plain select at 1000 rows.
- Commit message scope names the changed area — `feat (messages): …` —
  never a generic `(app)`.
- Verify against the running app, not by reading the code. Nearly every
  bug in the messaging work was invisible in the source and obvious the
  moment it rendered.
