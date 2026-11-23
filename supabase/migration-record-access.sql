-- Record-level access control for tasks.
--
--   * tasks: you see the tasks you're assigned to (or created);
--               administrators see everything.
--   * employees: nobody but an administrator can change an access role or
--               page access, including their own.
--
-- Run once in the Supabase SQL editor, after schema.sql. Safe to re-run:
-- every statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP ...
-- IF EXISTS first).
--
-- The ERP's version of this file also covered leads (ownership, sharing, an
-- activity trail, server-side search). Leads stayed in the ERP, and the
-- tables those sections altered were never created here, so they are cut.
-- Comments below that still mention leads describe why a helper is built
-- the way it is; the helpers themselves don't touch any leads table.
--
-- Why this is RLS and not UI filtering: `tasks` was under a
-- blanket "authenticated read/write" policy, so any member could read every
-- row straight off the REST API no matter what the page chose to render, the
-- caveat lib/visibility.ts documents for itself. Assignment is a
-- confidentiality boundary, so it has to hold at the database.

-- ════════════════════════════════════════════════════════════════════════
--  Shared identity layer
-- ════════════════════════════════════════════════════════════════════════

-- Which employees row is the caller? Mirrors lib/hooks/use-current-employee-id.ts:
-- user_profiles.employee_id when it's actually linked, else match on email,
-- because that column is null in practice for every account created before
-- its employee record existed.
--
-- SECURITY DEFINER throughout this file: these read employees /
-- user_profiles / lead_grants from inside policies ON other tables. As plain
-- SECURITY INVOKER functions each read would re-enter those tables' own
-- policies, which is both slower and a recursion hazard once lead_grants is
-- itself protected by a policy that consults leads.
create or replace function erp_actor_employee_id() returns text
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(
    (select up.employee_id from user_profiles up
      where up.uid = auth.uid() and up.employee_id is not null),
    (select e.id from employees e
      where lower(e.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
      limit 1));
$$;

-- Tasks, projects and tickets store assignees as employee *names*, not ids
-- (see AddTaskDrawer, which builds its picker from emp.name), so name is the
-- identity those policies have to compare against.
create or replace function erp_actor_employee_name() returns text
language sql stable security definer set search_path = public
as $$
  select e.name from employees e where e.id = (select erp_actor_employee_id());
$$;

-- Administrator. Deliberately NOT the existing is_admin(), which reads
-- user_profiles.is_admin, auth-context.tsx inserts that as true for every
-- first-time login, so is_admin() is true for ordinary staff and would hand
-- every member every lead and everyone else's tasks.
--
-- Mirrors the app's own isUnrestricted (auth-context.tsx): if the caller has
-- an employees row, its accessRole decides, full stop; only a login with no
-- employees row at all falls back to user_profiles.is_admin, which is the
-- bootstrap-admin case the app treats the same way.
create or replace function erp_is_admin() returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select case
    when (select erp_actor_employee_id()) is not null then coalesce(
      (select (e.data->>'accessRole') = 'Administrator'
         from employees e where e.id = (select erp_actor_employee_id())),
      false
    )
    else coalesce((select up.is_admin from user_profiles up where up.uid = auth.uid()), false)
  end;
$$;

-- ════════════════════════════════════════════════════════════════════════
--  Tasks
-- ════════════════════════════════════════════════════════════════════════
--
-- "You see what you're assigned" for the task board, enforced rather than
-- filtered. Assignees live in data->'assignees' as an array of employee
-- names, so the check is a name match, the same comparison
-- lib/visibility.ts makes client-side, and for the same reason (see its
-- note on why names and not ids).
--
-- Ticket-derived cards are covered by the same rule: TicketWatcher persists
-- a card per incoming ticket, and the board re-applies the live ticket's
-- assignee on read, so a card's assignee is whoever the ticket is assigned
-- to. Unassigned ones stay administrator-only, which is the triage case.

create or replace function task_assigned_to_actor(p_data jsonb) returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    -- No employee record means no name to match, so nothing matches and the
    -- board comes back empty rather than wide open.
    when (select erp_actor_employee_name()) is null then false
    when jsonb_typeof(p_data->'assignees') <> 'array' then false
    else exists (select 1 from jsonb_array_elements_text(p_data->'assignees') a
       -- Case- and whitespace-insensitive, matching the client comparison in
       -- lib/visibility.ts: these names are hand-picked strings, and " Yash
       -- Harale" must not read as a different person.
       where lower(btrim(a)) = lower(btrim((select erp_actor_employee_name()))))
  end;
$$;

alter table tasks enable row level security;

drop policy if exists "authenticated read/write" on tasks;
drop policy if exists "assignee, creator, or admin can read tasks" on tasks;
drop policy if exists "authenticated can create tasks" on tasks;
drop policy if exists "assignee, creator, or admin can update tasks" on tasks;
drop policy if exists "assignee, creator, or admin can delete tasks" on tasks;

-- Read: administrators see every task; everyone else sees the ones they're
-- assigned to, plus anything they created themselves (so a task you raise
-- before deciding who owns it doesn't vanish on you).
create policy "assignee, creator, or admin can read tasks" on tasks
  for select using ((select erp_is_admin())
    or task_assigned_to_actor(data)
    or (data->>'createdBy' is not null and data->>'createdBy' = (select erp_actor_employee_id())));

-- Create: left open to any authenticated user, on purpose. Creating a task
-- reveals nothing, and TicketWatcher (mounted for every signed-in user)
-- persists a card for each newly-arrived ticket with no assignee yet, if a
-- member's insert were refused, the ticket would already be marked synced
-- and its card would never be created for anyone. Provenance still can't be
-- forged: a stamped creator must be the caller.
create policy "authenticated can create tasks" on tasks
  for insert with check (auth.role() = 'authenticated'
    and (data->>'createdBy' is null or data->>'createdBy' = (select erp_actor_employee_id())));

-- Update: whoever can see it can work it. WITH CHECK is deliberately `true`:
-- USING has already restricted which rows may be touched, and the result has
-- to be allowed to no longer include the editor, handing a task off to a
-- teammate (or dropping yourself from it) is normal, and a mirrored WITH
-- CHECK would reject exactly that edit.
create policy "assignee, creator, or admin can update tasks" on tasks
  for update using (
    (select erp_is_admin())
    or task_assigned_to_actor(data)
    or (data->>'createdBy' is not null and data->>'createdBy' = (select erp_actor_employee_id()))
  ) with check (true);

create policy "assignee, creator, or admin can delete tasks" on tasks
  for delete using (
    (select erp_is_admin())
    or task_assigned_to_actor(data)
    or (data->>'createdBy' is not null and data->>'createdBy' = (select erp_actor_employee_id()))
  );

-- ════════════════════════════════════════════════════════════════════════
--  Closing the self-promotion hole
-- ════════════════════════════════════════════════════════════════════════
-- Everything above resolves "is this person an administrator" from
-- employees.data->>'accessRole'. But `employees` is still under a blanket
-- "authenticated read/write" policy, so without this guard any member could
-- simply write accessRole = 'Administrator' onto their own row and read the
-- every lead and everyone's tasks, the access controls above would be
-- decoration.
--
-- This enforces at the database what app/api/employees/[id]/access/route.ts
-- already says should be impossible ("Hiding the controls in the UI alone
-- wouldn't stop someone from editing the request directly and granting
-- themselves every page"). That admin-gated route keeps working: it uses the
-- service-role key, where auth.uid() is null.
--
-- Ordinary employee edits (name, phone, role, salary, …) are untouched.
create or replace function employees_guard_access_fields() returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null or (select erp_is_admin()) then
    return new;
  end if;

  if coalesce(new.data->>'accessRole', '') <> coalesce(old.data->>'accessRole', '') then
    raise exception 'Only an administrator can change an access role';
  end if;

  if coalesce(new.data->'access', '[]'::jsonb) <> coalesce(old.data->'access', '[]'::jsonb) then
    raise exception 'Only an administrator can change page access';
  end if;

  return new;
end;
$$;

drop trigger if exists employees_guard_access_fields_trg on employees;
create trigger employees_guard_access_fields_trg
  before update on employees
  for each row execute function employees_guard_access_fields();

-- An INSERT can't be compared against a previous row, so a non-admin
-- creating an employee may not hand out an access role at creation time
-- either (the Employees page creates people as Contributor and grants
-- afterwards through the admin route).
create or replace function employees_guard_access_insert() returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null or (select erp_is_admin()) then
    return new;
  end if;
  if coalesce(new.data->>'accessRole', 'Contributor') <> 'Contributor'
     or coalesce(jsonb_array_length(coalesce(new.data->'access', '[]'::jsonb)), 0) > 0 then
    raise exception 'Only an administrator can grant access on a new employee';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_guard_access_insert_trg on employees;
create trigger employees_guard_access_insert_trg
  before insert on employees
  for each row execute function employees_guard_access_insert();

