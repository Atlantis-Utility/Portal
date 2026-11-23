import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { hasPageAccess } from "@/lib/nav-pages";

/**
 * Who may see a conversation (supabase/migration-conversation-access.sql).
 *
 * Everyone with Messages sees a conversation unless an administrator has
 * restricted it to named users. Administrators always see everything.
 * Enforced on the server by every Messages route, so a hidden conversation
 * can't be opened, sent to or read by guessing its id.
 *
 * Before the migration is run there are no rules, and everything behaves
 * as the shared inbox it was.
 */
export interface AccessRule {
  mode: "everyone" | "restricted";
  /** Lowercased emails. */
  allowed: string[];
}

export interface Viewer {
  email: string;
  name: string;
  isAdmin: boolean;
}

const db = () => createServiceRoleClient();

/** The signed-in employee, and whether they're an administrator. */
export async function currentViewer(): Promise<Viewer> {
  const actor = await requireEmployee();
  const { data } = await db().from("employees").select("data").eq("id", actor.employeeId).maybeSingle();
  const role = (data?.data as { accessRole?: string } | undefined)?.accessRole;
  return { email: actor.email.toLowerCase(), name: actor.name, isAdmin: role === "Administrator" };
}

/** Every restriction, by session id. Empty when the table doesn't exist yet. */
export async function loadRules(): Promise<Map<string, AccessRule>> {
  const rules = new Map<string, AccessRule>();
  const { data, error } = await db().from("conversation_access").select("session_id, mode, allowed");
  if (error) return rules;
  for (const r of (data ?? []) as Array<{ session_id: string; mode: AccessRule["mode"]; allowed: string[] }>) {
    rules.set(r.session_id, { mode: r.mode, allowed: (r.allowed ?? []).map((e) => e.toLowerCase()) });
  }
  return rules;
}

export function allows(rule: AccessRule | undefined, viewer: Viewer): boolean {
  if (!rule || rule.mode === "everyone" || viewer.isAdmin) return true;
  return rule.allowed.includes(viewer.email);
}

/**
 * For routes that act on one conversation: throws a 404 - not a 403 - when
 * the viewer may not see it, so a hidden conversation isn't even confirmed
 * to exist.
 */
export async function requireConversation(sessionId: string): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!sessionId || viewer.isAdmin) return viewer;
  const { data, error } = await db()
    .from("conversation_access")
    .select("mode, allowed")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error || !data) return viewer;
  if (!allows({ mode: data.mode, allowed: (data.allowed ?? []).map((e: string) => e.toLowerCase()) }, viewer)) {
    throw new ApiAuthError("That conversation isn't available.", 404);
  }
  return viewer;
}

export async function getRule(sessionId: string): Promise<AccessRule> {
  const { data } = await db().from("conversation_access").select("mode, allowed").eq("session_id", sessionId).maybeSingle();
  return data ? { mode: data.mode, allowed: data.allowed ?? [] } : { mode: "everyone", allowed: [] };
}

export async function setRule(sessionId: string, rule: AccessRule, by: string): Promise<void> {
  if (rule.mode === "everyone") {
    // The default needs no row.
    const { error } = await db().from("conversation_access").delete().eq("session_id", sessionId);
    if (error) throw error;
    return;
  }
  const { error } = await db().from("conversation_access").upsert({
    session_id: sessionId,
    mode: "restricted",
    allowed: [...new Set(rule.allowed.map((e) => e.trim().toLowerCase()).filter(Boolean))],
    updated_by: by,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** People who could be given a conversation: everyone who holds Messages. */
export async function messagesUsers(): Promise<Array<{ email: string; name: string; isAdmin: boolean }>> {
  const { data } = await db().from("employees").select("name, email, data");
  return ((data ?? []) as Array<{ name: string; email: string; data: { accessRole?: string; access?: string[] } }>)
    .filter((e) => e.email)
    .map((e) => {
      const isAdmin = e.data?.accessRole === "Administrator";
      const access = e.data?.access ?? (isAdmin ? undefined : []);
      return { email: e.email.toLowerCase(), name: e.name, isAdmin, holds: hasPageAccess("/messages", access) };
    })
    .filter((e) => e.holds)
    .map(({ email, name, isAdmin }) => ({ email, name, isAdmin }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
