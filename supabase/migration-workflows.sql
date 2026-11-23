-- Workflows: automations people set up themselves.
--
-- A workflow is a trigger and an action. The first of each is a schedule
-- and "send a text", which is what scheduled messages are; later triggers
-- (a text arrives, another app calls in) and actions (tag, create a task,
-- call a webhook) are new values in trigger_type / action_type, not new
-- tables.
--
-- Run once in the Supabase SQL editor, after the other migrations. Safe to
-- re-run.
--
-- Nothing here is readable or writable from a browser session. Every read
-- and write goes through the app's API routes, which check the caller's
-- "Schedule messages" grant and then use the service key. A scheduled text
-- reaches real phones unattended, so the browser gets no direct path to
-- creating one.

create table if not exists public.workflows (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default '',
  status           text not null default 'active'
                   check (status in ('active', 'paused', 'completed', 'canceled')),
  trigger_type     text not null check (trigger_type in ('schedule')),
  trigger          jsonb not null default '{}',
  action_type      text not null check (action_type in ('send_sms')),
  action           jsonb not null default '{}',
  -- When it fires next. Null once it never will again.
  next_run_at      timestamptz,
  -- Held while a run is in progress, so two timers firing at once can't
  -- both send it. Expires on its own if a run dies half way.
  locked_until     timestamptz,
  last_run_at      timestamptz,
  run_count        integer not null default 0,
  created_by_email text not null default '',
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists workflows_due_idx
  on public.workflows (next_run_at) where status = 'active';

create table if not exists public.workflow_runs (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflows(id) on delete cascade,
  started_at    timestamptz not null default now(),
  scheduled_for timestamptz,
  outcome       text not null
                check (outcome in ('sent', 'dry_run', 'partial', 'failed', 'skipped', 'missed')),
  -- False when sending was switched off and this run only rehearsed.
  live          boolean not null default false,
  sent_count    integer not null default 0,
  summary       text not null default '',
  detail        jsonb not null default '[]'
);

create index if not exists workflow_runs_workflow_idx
  on public.workflow_runs (workflow_id, started_at desc);
-- The daily cap counts today's live sends across every workflow.
create index if not exists workflow_runs_live_day_idx
  on public.workflow_runs (started_at) where live;

alter table public.workflows     enable row level security;
alter table public.workflow_runs enable row level security;
-- No policies on purpose: with RLS on and nothing granted, a browser
-- session can't read or write either table. The service key bypasses RLS.
revoke all on public.workflows     from anon, authenticated;
revoke all on public.workflow_runs from anon, authenticated;

-- Hands out the workflows that are due, each to exactly one caller.
--
-- FOR UPDATE SKIP LOCKED means two timers running at the same moment get
-- different rows rather than the same ones, and the lease means a row a
-- crashed run was holding comes back on its own after a few minutes.
create or replace function public.claim_due_workflows(
  p_limit integer default 10,
  p_lease_seconds integer default 300
) returns setof public.workflows
language sql
security definer set search_path = public
as $$
  update public.workflows w
     set locked_until = now() + make_interval(secs => p_lease_seconds)
   where w.id in (
     select id from public.workflows
      where status = 'active'
        and trigger_type = 'schedule'
        and next_run_at is not null
        and next_run_at <= now()
        and (locked_until is null or locked_until < now())
      order by next_run_at
      limit p_limit
      for update skip locked
   )
  returning w.*;
$$;

revoke execute on function public.claim_due_workflows(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_workflows(integer, integer) to service_role;

-- ── The timer ────────────────────────────────────────────────────────────
-- Not switched on by this file, because it needs the app's public address
-- and that doesn't exist until the app is deployed. A database can't reach
-- a laptop's localhost.
--
-- Once deployed, run this block with your own values filled in. It calls
-- the app every minute; the app sends whatever has come due. CRON_SECRET
-- must match the CRON_SECRET in the deployment's environment.
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
--   select vault.create_secret('https://YOUR-APP-ADDRESS', 'portal_url');
--   select vault.create_secret('YOUR-CRON-SECRET',         'portal_cron_secret');
--
--   select cron.schedule(
--     'portal-workflows',
--     '* * * * *',
--     $job$
--       select net.http_post(
--         url     := (select decrypted_secret from vault.decrypted_secrets where name = 'portal_url')
--                    || '/api/cron/workflows',
--         headers := jsonb_build_object(
--           'Content-Type',  'application/json',
--           'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                                           where name = 'portal_cron_secret')
--         ),
--         body    := '{}'::jsonb
--       );
--     $job$
--   );
--
-- To stop it:  select cron.unschedule('portal-workflows');
