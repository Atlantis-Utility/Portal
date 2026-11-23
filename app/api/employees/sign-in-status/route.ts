import { NextResponse } from "next/server";
import { requirePageAccess, ApiAuthError } from "@/lib/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who on the Users page has actually signed in.
 *
 * The Users list is employee records; whether a record's person has ever
 * used their login lives in Supabase Auth, which a browser can't read.
 * Keyed by lowercased email - identity here is by email, never by id.
 *
 *   lastSignInAt set   -> they're in
 *   login, no sign-in  -> invited, still pending
 *   no login at all    -> never invited
 */
export interface SignInStatus {
  invitedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
}

export async function GET() {
  try {
    await requirePageAccess("/employees");
    const admin = createServiceRoleClient().auth.admin;
    const users: Record<string, SignInStatus> = {};
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      for (const u of data.users) {
        if (!u.email) continue;
        users[u.email.toLowerCase()] = {
          invitedAt: u.invited_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
          createdAt: u.created_at ?? null,
        };
      }
      if (data.users.length < 1000) break;
    }
    return NextResponse.json({ users });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: getErrorMessage(err, "Couldn't read sign-in status") }, { status: 500 });
  }
}
