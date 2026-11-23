-- Who may see a conversation.
--
-- The shared inbox is visible to everyone with Messages by default; a row
-- here restricts one conversation (or group) to named users. Administrators
-- always see everything and are the only ones who change these rules.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- In-app only: SNAPmobile, the RingLogix web app and Teams read the phone
-- system directly, so whoever signs in there as the conversation's
-- extension still sees it.
--
-- Read and written only by the app's API routes with the service key, which
-- also enforce it on every Messages route. No browser access.

create table if not exists public.conversation_access (
  -- RingLogix's session id for the conversation.
  session_id  text primary key,
  mode        text not null default 'everyone' check (mode in ('everyone', 'restricted')),
  -- Lowercased emails of the users allowed when restricted. Identity here
  -- is by email: administrators have no employee id.
  allowed     text[] not null default '{}',
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.conversation_access enable row level security;
revoke all on public.conversation_access from anon, authenticated;
