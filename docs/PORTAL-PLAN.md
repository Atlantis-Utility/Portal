# Atlantis Portal: the customer portal plan

Decided 2026-11-23. Atlantis Portal becomes a portal for Atlantis Utility's
RingLogix customers: each customer signs in and sees, and uses, their own
phone system. Atlantis staff keep everything they have today, plus a view
of every customer.

## Decisions

| Question | Decision |
|---|---|
| Who uses it | Atlantis staff (Microsoft sign-in) and customer users (email + password, **invite only**) |
| Tenancy | One **account** per customer, tied to its RingLogix domain. A customer user belongs to exactly one account. |
| Roles | **Owner** (manages their team, chooses what members see, self-service changes) and **member** (uses what they're given) |
| What a customer can change | Decided **by role**: owners get self-service; members get what the owner grants |
| v1 for customers | Overview, phone numbers, users/extensions, devices, call history + recordings, texting (inbox, contacts, scheduled texts), billing |
| Look | Vercel's monochrome base (Geist, hairline borders, generous space) with **one accent colour per area**: Messages blue, Workflows violet, Integrations teal, Calendar amber, Calls green, Billing pink |
| Rollout | Foundation first; each phase ships on its own |

## The rule everything rests on

**The domain a request acts on comes from the signed-in user, never from
the browser.** A customer user's domain is their account's; a staff
member's is the account they've chosen to view (validated server-side).
Every RingLogix call goes through that. A customer who edits a request
can't reach another customer's data, because nothing they send decides it.

Same for the database: browser sessions only get rows their account owns,
and internal tables (employees, tasks, notes, settings) are staff-only.

## Phases

### 0. Lock it down (blocker for customer sign-in)
- Database policies that trust "any signed-in user" become staff-only
  (`erp_is_staff()`), because customers will be signed-in users too.
- Every RingLogix route takes its domain from the server, not the request.

### 1. Accounts and customer sign-in
- `accounts` (customer, RingLogix domain, status) and `account_users`
  (email, role, page grants, invite status).
- The Before User Created hook also admits invited customer users.
- Invite → set password → sign in, reusing the existing set-password flow.
- Staff **Accounts** page: create a customer, link the domain (picked from
  the reseller's customer list), invite their first owner.
- Staff "viewing as" switcher; the server validates the choice.
- Workflows, integrations, message tags and senders get an `account_id`.

### 2. Design system and shell
- Colour tokens with dark-mode pairs built in (no more allowlist gaps),
  accent per area, type scale, spacing, elevation.
- Component kit: Card, Stat, Badge, Table, Tabs, EmptyState, Skeleton.
- New sidebar (per audience), top bar with account switcher, command palette.

### 3. Customer pages
Overview · Numbers · Users & extensions · Devices · Calls & recordings ·
Texting (scoped inbox, contacts, scheduled texts) · Billing · Team (owners).

### 4. Roles in depth
Owner vs member permissions, member page grants, self-service actions
(contacts, voicemail, wake-up calls…) gated by role.

### 5. Per-customer automation
Workflows and integrations per account; inbound triggers and templates
(after hours, keywords, billing and appointment reminders).

## Status

- [~] Phase 0: routes done; run migration-staff-only.sql
- [ ] Phase 1
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5
