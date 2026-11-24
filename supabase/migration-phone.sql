-- Portal phone: which RingLogix extension each person calls as.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Its own table rather than a field on employees.data, because that row is
-- writable by any signed-in user (only accessRole and access are guarded),
-- and this value decides whose SIP password the browser is handed: someone
-- who could write it could make and take calls as anybody's extension.
-- RLS on, no policies: only the admin-checked API (service key) writes it,
-- and the phone's own route reads it.

create table if not exists public.phone_extensions (
  -- The employee's email, lowercased: identity is by email here.
  email       text primary key,
  extension   text not null unique,
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.phone_extensions enable row level security;
