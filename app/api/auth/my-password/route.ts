import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { hasPassword, mustChangePassword, passwordMatches, passwordProblem } from "@/lib/passwords";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in person sets their own password.
 *
 * Two cases: replacing a temporary one an administrator set (they just
 * signed in with it, so it isn't asked for again), or changing their own
 * from the account page (the current one is asked for, if they have one -
 * a Microsoft-only login is adding its first). Either way the flag that
 * holds every other API call is cleared here, with the service role,
 * because the person themselves can't write app_metadata.
 *
 * Deliberately not behind requireEmployee: that refuses anyone still
 * holding a temporary password, which is exactly who comes here.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: "Missing or invalid session" }, { status: 401 });

    const db = createServiceRoleClient();
    const { data: employee } = await db.from("employees").select("id").ilike("email", user.email).maybeSingle();
    if (!employee) return NextResponse.json({ error: "That account isn't on the Users list" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as { password?: string; current?: string };
    const password = body.password ?? "";
    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const forced = mustChangePassword(user);
    // Signed in by an emailed reset or invite link in the last hour: that
    // link was the proof, and someone resetting has forgotten the old one.
    const { data: claims } = await supabase.auth.getClaims();
    const amr = ((claims?.claims as { amr?: Array<{ method?: string; timestamp?: number }> } | undefined)?.amr) ?? [];
    const viaLink = amr.some((m) =>
      ["otp", "recovery", "invite", "magiclink"].includes(m.method ?? "") && Date.now() / 1000 - (m.timestamp ?? 0) < 3600,
    );
    if (forced || hasPassword(user)) {
      // A forced change still checks: the temporary password must not be
      // reused as the "new" one.
      if (await passwordMatches(user.email, password)) {
        return NextResponse.json({ error: "Choose a password different from the current one." }, { status: 400 });
      }
    }
    if (!forced && !viaLink && hasPassword(user)) {
      if (!body.current || !(await passwordMatches(user.email, body.current))) {
        return NextResponse.json({ error: "Your current password isn't right." }, { status: 400 });
      }
    }

    // Through their own session, not the admin API: an admin password
    // change ends every session the login has, which signed people straight
    // out the moment they'd chosen their password (seen in testing).
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const weak = /weak|pwned|leaked/i.test(error.message);
      const reauth = /reauthenticat/i.test(error.message);
      return NextResponse.json(
        {
          error: weak ? "That password is too easy to guess. Try another."
            : reauth ? "Sign out and back in, then try again."
            : "Couldn't save it. Try again.",
        },
        { status: weak || reauth ? 400 : 500 },
      );
    }
    // Only the service role can write app_metadata. Doesn't touch sessions.
    if (forced) {
      const { error: flagError } = await db.auth.admin.updateUserById(user.id, {
        app_metadata: { must_change_password: false },
      });
      if (flagError) {
        console.error("[auth:my-password] password saved but flag not cleared", flagError);
        return NextResponse.json({ error: "Your password was saved, but sign out and back in to continue." }, { status: 500 });
      }
    }
    console.log(`[auth] ${user.email} ${forced ? "replaced a temporary password" : "changed their password"}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth:my-password]", err);
    return NextResponse.json({ error: "Couldn't save it. Try again." }, { status: 500 });
  }
}
