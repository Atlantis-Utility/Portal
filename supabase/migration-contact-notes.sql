-- Contact notes: free-text notes on a RingLogix contact, which RingLogix has
-- no field for. Keyed by the contact's book and id ("100:<contact_id>",
-- "*:<contact_id>" for the shared book).
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- RLS on, no policies: only the API (service key) reads and writes it,
-- after checking the caller works here.

create table if not exists public.contact_notes (
  contact_key  text primary key,
  notes        text not null default '',
  updated_by   text not null default '',
  updated_at   timestamptz not null default now()
);

alter table public.contact_notes enable row level security;
