-- Integrations: other systems connected to this app.
--
-- An integration is one connection to one outside system - a HubSpot
-- account, a Google Sheet, a webhook - with its settings, an encrypted
-- credential, and a log of what it has done. What it brings in lands in
-- external_contacts, matched to our conversations by phone number.
--
-- Run once in the Supabase SQL editor, after migration-workflows.sql.
-- Safe to re-run.
--
-- Like workflows, nothing here is reachable from a browser session: RLS on,
-- no policies. The app's API routes check the caller holds the
-- Integrations page and then use the service key. Credentials are
-- encrypted by the app before they get here (INTEGRATIONS_KEY), so the
-- database alone never holds a usable key.

create table if not exists public.integrations (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  name             text not null default '',
  enabled          boolean not null default true,
  -- Settings that aren't secret: which sheet, which fields, how often.
  config           jsonb not null default '{}',
  -- The credential, encrypted (AES-256-GCM) by the app. Never sent back to
  -- a browser; the page only learns whether one is set.
  secret           text,
  -- For incoming webhooks: the unguessable part of the URL. Stored as a
  -- SHA-256 hash, so the table can't be read back into a working URL.
  hook_token_hash  text unique,
  last_sync_at     timestamptz,
  last_status      text not null default 'never'
                   check (last_status in ('never', 'ok', 'error')),
  last_error       text not null default '',
  -- Held while a sync runs, so two timers can't sync the same one at once.
  locked_until     timestamptz,
  created_by_email text not null default '',
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.external_contacts (
  id             uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  -- The record's id in the other system, so a re-sync updates rather than
  -- duplicates. For a sheet, the row's key column or its row number.
  external_id    text not null,
  name           text not null default '',
  company        text not null default '',
  email          text not null default '',
  -- Ten digits, US. Empty when the record has no usable number.
  phone          text not null default '',
  -- Everything else the source had, for later workflows (due dates,
  -- appointment times, deal stages).
  fields         jsonb not null default '{}',
  source_url     text not null default '',
  synced_at      timestamptz not null default now(),
  unique (integration_id, external_id)
);

create index if not exists external_contacts_phone_idx
  on public.external_contacts (phone) where phone <> '';

create table if not exists public.integration_events (
  id             uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  at             timestamptz not null default now(),
  -- sync | test | webhook_in | webhook_out
  kind           text not null,
  ok             boolean not null,
  summary        text not null default '',
  detail         jsonb not null default '{}'
);

create index if not exists integration_events_idx
  on public.integration_events (integration_id, at desc);

alter table public.integrations       enable row level security;
alter table public.external_contacts  enable row level security;
alter table public.integration_events enable row level security;
revoke all on public.integrations       from anon, authenticated;
revoke all on public.external_contacts  from anon, authenticated;
revoke all on public.integration_events from anon, authenticated;

-- Hands out integrations due a sync, each to one caller, like
-- claim_due_workflows. "Due" is decided by each one's own interval.
create or replace function public.claim_due_integrations(
  p_limit integer default 5,
  p_lease_seconds integer default 600
) returns setof public.integrations
language sql
security definer set search_path = public
as $$
  update public.integrations i
     set locked_until = now() + make_interval(secs => p_lease_seconds)
   where i.id in (
     select id from public.integrations
      where enabled
        and secret is not null
        and coalesce((config->>'syncMinutes')::int, 0) > 0
        and (last_sync_at is null
             or last_sync_at < now() - make_interval(mins => (config->>'syncMinutes')::int))
        and (locked_until is null or locked_until < now())
      order by last_sync_at nulls first
      limit p_limit
      for update skip locked
   )
  returning i.*;
$$;

revoke execute on function public.claim_due_integrations(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_integrations(integer, integer) to service_role;
