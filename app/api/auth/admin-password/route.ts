import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin, ApiAuthError } from "@/lib/api-auth";
import { authUserByEmail, passwordProblem } from "@/lib/passwords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An administrator sets somebody's password: creates their login if they
 * have none, or replaces the password on the one they have (a Microsoft
 * login gains a password alongside it; the Microsoft button keeps working).
 *
 * `temporary` (the default) makes them choose their own at first sign-in,
 * so the administrator doesn't go on knowing it.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string; temporary?: boolean };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const temporary = body.temporary !== false;
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter an email address" }, { status: 400 });
    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const db = createServiceRoleClient();
    const { data: employee } = await db.from("employees").select("id, name").ilike("email", email).maybeSingle();
    if (!employee) {
      return NextResponse.json({ error: "That address isn't on the Users page. Add them there first." }, { status: 400 });
    }

    const existing = await authUserByEmail(email);
    if (existing) {
      const { error } = await db.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        app_metadata: { must_change_password: temporary },
      });
      if (error) throw error;
    } else {
      const { error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { must_change_password: temporary },
      });
      if (error) throw error;
    }
    console.log(`[auth] ${actor.email} set a ${temporary ? "temporary " : ""}password for ${email}${existing ? "" : " (new login)"}`);
    return NextResponse.json({ ok: true, created: !existing, temporary });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[auth:admin-password]", err);
    const message = err instanceof Error ? err.message : "";
    return NextResponse.json(
      { error: /weak|pwned|leaked/i.test(message) ? "That password is too easy to guess. Try another." : "Couldn't set the password. Try again." },
      { status: /weak|pwned|leaked/i.test(message) ? 400 : 500 },
    );
  }
}
