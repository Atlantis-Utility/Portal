import "server-only";
import { createClient as createPlainClient, type User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "./supabase/server";

/**
 * Email-and-password sign-in, for people outside the Microsoft tenant.
 *
 * An administrator can set somebody's password directly (no email needed),
 * and by default that password is temporary: `must_change_password` goes in
 * the login's app_metadata, which only the service role can write, and
 * requireEmployee / requireAdmin refuse every API call until the person
 * has chosen their own (app/api/auth/my-password). The screen is gated the
 * same way in AuthGuard.
 */

export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt ignores anything past 72 bytes

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD) return `Keep it under ${MAX_PASSWORD} characters.`;
  if (!/[a-z]/i.test(password) || !/[^a-z]/i.test(password)) return "Mix letters with at least one number or symbol.";
  return null;
}

export function mustChangePassword(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return Boolean(user?.app_metadata?.must_change_password);
}

/** The login for an address, if there is one. */
export async function authUserByEmail(email: string): Promise<User | null> {
  const db = createServiceRoleClient();
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Whether this login can already sign in with a password. */
export function hasPassword(user: User): boolean {
  return (user.identities ?? []).some((i) => i.provider === "email");
}

/**
 * Checks a password without touching the caller's own session: a separate,
 * non-persisting client signs in and is thrown away.
 */
export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const client = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}
