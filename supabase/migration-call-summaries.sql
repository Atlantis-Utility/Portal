-- Call summaries: the short summary and next steps Claude writes from a
-- call's RingLogix transcript, kept so each call is summarized once.
--
-- Run once in the Supabase SQL editor. Safe to re-run. Without it the
-- summaries still work; they're just written again each time.
--
-- RLS on, no policies: only the API (service key) reads and writes it,
-- after checking the caller may see that call.

create table if not exists public.call_summaries (
  -- RingLogix's CDR id (v1 cdr_id = v2 id).
  cdr_id      text primary key,
  summary     text not null,
  next_steps  jsonb not null default '[]',
  source      text not null default 'claude',
  created_at  timestamptz not null default now()
);

alter table public.call_summaries enable row level security;
