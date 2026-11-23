"use client";

/**
 * Emails someone a link to set their password (creating their login if it
 * doesn't exist yet). Administrators only; the route checks.
 *
 * Returns what happened in words a person can act on, rather than throwing,
 * because the callers want to say "added, but the invite didn't go" - the
 * user record is already saved either way.
 */
export async function sendInvite(email: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/auth/password-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, kind: "invite" }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) return { ok: true, message: `Invite sent to ${email}.` };
    if (res.status === 503) {
      return { ok: false, message: "The invite couldn't be emailed: email sending isn't set up yet (RESEND_API_KEY)." };
    }
    return { ok: false, message: data.error ?? "The invite couldn't be sent." };
  } catch {
    return { ok: false, message: "The invite couldn't be sent: no answer from the server." };
  }
}

export type LoginState = "active" | "pending" | "none";

export interface SignInStatus {
  invitedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
}

/** Signed in at least once / invited but never signed in / no login yet. */
export function loginState(s: SignInStatus | undefined): LoginState {
  if (!s) return "none";
  return s.lastSignInAt ? "active" : "pending";
}
