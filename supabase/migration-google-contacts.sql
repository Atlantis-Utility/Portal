-- Google Contacts sync: each person connects their own Google account, and
-- the contacts saved there are copied into their extension's RingLogix
-- contact book, then kept up to date.
--
-- Run once in the Supabase SQL editor. Safe to re-run. Needs the timer from
-- migration-workflows.sql (pg_cron calling /api/cron/workflows every
-- minute), which is what runs the sync.
--
-- Nothing here is reachable from a browser session: RLS on, no policies.
-- The API routes check who is asking and use the service key. The Google
-- refresh token is encrypted by the app (INTEGRATIONS_KEY) before it gets
-- here.

create table if not exists public.google_contact_links (
  -- The employee's email, lowercased. One Google account per person.
  owner_email    text primary key,
  google_email   text not null default '',
  -- The RingLogix extension whose book receives the contacts. One person
  -- per extension, so two syncs never fight over the same book.
  extension      text not null,
  -- Google's refresh token, encrypted (AES-256-GCM) by the app.
  refresh_token  text not null,
  -- Google's incremental-sync cursor: the next pull asks only what changed.
  sync_token     text,
  enabled        boolean not null default true,
  -- Set by "Disconnect and remove": the runner deletes what the sync added,
  -- then drops this row.
  removing       boolean not null default false,
  next_sync_at   timestamptz not null default now(),
  locked_until   timestamptz,
  last_sync_at   timestamptz,
  last_status    text not null default 'never'
                 check (last_status in ('never', 'ok', 'error')),
  last_error     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists google_contact_links_extension
  on public.google_contact_links (extension);

-- One row per Google contact: what Google says, and where (if anywhere) the
-- sync has written it in RingLogix. Only contacts with a row here and a
-- placement (rl_*) were added by the sync, and only those are ever updated
-- or deleted by it.
create table if not exists public.google_contacts (
  owner_email    text not null references public.google_contact_links (owner_email) on delete cascade,
  resource_name  text not null,
  first_name     text not null default '',
  last_name      text not null default '',
  company        text not null default '',
  email          text not null default '',
  cell_phone     text not null default '',
  work_phone     text not null default '',
  home_phone     text not null default '',
  deleted        boolean not null default false,
  -- pending: needs writing. synced: in RingLogix as Google has it.
  -- clash: a contact of that name was already there and was left alone.
  -- skipped: nothing to put in a phone book (no name or no number).
  state          text not null default 'pending'
                 check (state in ('pending', 'synced', 'clash', 'skipped', 'error')),
  note           text not null default '',
  rl_extension   text not null default '',
  rl_first       text not null default '',
  rl_last        text not null default '',
  updated_at     timestamptz not null default now(),
  primary key (owner_email, resource_name)
);

create index if not exists google_contacts_pending
  on public.google_contacts (owner_email) where state = 'pending';

alter table public.google_contact_links enable row level security;
alter table public.google_contacts enable row level security;

-- Hands out the connections whose turn it is, each held for a while so a
-- second timer firing in the same minute can't sync the same person twice.
create or replace function public.claim_due_google_links(p_limit int, p_lease_seconds int)
returns setof public.google_contact_links
language sql
security definer
set search_path = public
as $$
  update public.google_contact_links l
     set locked_until = now() + make_interval(secs => p_lease_seconds)
   where l.owner_email in (
     select owner_email from public.google_contact_links
      where (enabled or removing)
        and next_sync_at <= now()
        and (locked_until is null or locked_until < now())
      order by next_sync_at
      limit p_limit
      for update skip locked
   )
  returning l.*;
$$;

revoke all on function public.claim_due_google_links(int, int) from public, anon, authenticated;
