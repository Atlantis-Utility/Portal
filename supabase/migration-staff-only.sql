-- Internal tables are for Atlantis staff only.
--
-- Run once in the Supabase SQL editor, after the other migrations, and
-- BEFORE any customer user can sign in (docs/PORTAL-PLAN.md, phase 0).
-- Safe to re-run.
--
-- Why: the policies in schema.sql and the message migrations say "any
-- authenticated user may read and write". That was true to the intent
-- while only employees could sign in. Customer users will be authenticated
-- too, and every one of those policies would hand them the employee list,
-- tasks, notes, settings and the shared inbox's tags.
--
-- How: rather than rewrite each permissive policy, this adds one
-- RESTRICTIVE policy per table. Postgres ANDs restrictive policies with the
-- permissive ones, so everything that works for staff today keeps working,
-- and nobody else gets anything regardless of what the older policies
-- grant. The service key (the app's API routes, the timer) bypasses RLS
-- and is unaffected.

-- Is the caller on the Employees page? Security definer so it can read
-- employees without tripping that table's own policies (which would
-- recurse), and keyed on email: administrators have no employee_id.
create or replace function public.erp_is_staff() returns boolean
language sql stable
security definer set search_path = public, auth
as $$
  select exists (
    select 1 from public.employees e
     where lower(e.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
  );
$$;

revoke execute on function public.erp_is_staff() from public, anon;
grant execute on function public.erp_is_staff() to authenticated, service_role;

-- One restrictive "staff only" policy on every internal table that exists.
-- Tables are checked first so a database without, say, the vault tables
-- doesn't stop the rest from being locked down.
do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'projects', 'tasks', 'tickets', 'manual_tickets', 'ticket_sync',
    'settings', 'customer_unifi_sites', 'customer_profiles', 'notes',
    'ringlogix_customers', 'message_threads', 'message_senders',
    'vault_entries', 'vault_shares', 'vault_passkeys', 'vault_audit_log',
    'ticket_reviews'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff only" on public.%I', t);
    execute format(
      'create policy "staff only" on public.%I as restrictive for all to authenticated '
      || 'using (public.erp_is_staff()) with check (public.erp_is_staff())', t);
  end loop;
end $$;

-- user_profiles is the one table a non-employee legitimately touches: the
-- app records each sign-in there. Staff see all of it; anyone else sees and
-- writes only their own row.
drop policy if exists "staff or own row" on public.user_profiles;
create policy "staff or own row" on public.user_profiles
  as restrictive for all to authenticated
  using (public.erp_is_staff() or uid = auth.uid())
  with check (public.erp_is_staff() or uid = auth.uid());

-- Project attachments (left over from the ERP) are staff-only as well.
drop policy if exists "attachments are staff only" on storage.objects;
create policy "attachments are staff only" on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'project-attachments' or public.erp_is_staff())
  with check (bucket_id <> 'project-attachments' or public.erp_is_staff());
