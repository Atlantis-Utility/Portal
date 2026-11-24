import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, ApiAuthError } from "@/lib/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { extensionChoices, extensionFor, setExtension } from "@/lib/phone";
import { getErrorMessage } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which extension a person calls as, set by an administrator in Edit
 * Profile. Admin only, both ways: the answer decides whose phone line the
 * person's browser becomes.
 */

function fail(err: unknown) {
  if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = getErrorMessage(err, "Something went wrong");
  if (/phone_extensions/.test(message) && /does not exist|schema cache/.test(message)) {
    return NextResponse.json({ error: "Run supabase/migration-phone.sql first.", code: "migration_missing" }, { status: 503 });
  }
  console.error("[phone:extension]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Whose extension?" }, { status: 400 });
    const [extension, choices] = await Promise.all([extensionFor(email), extensionChoices()]);
    return NextResponse.json({
      extension,
      choices,
      // Their own line in RingLogix, when its email says so.
      suggested: choices.find((c) => c.email === email && !c.assignedTo)?.user ?? "",
    });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { email?: string; extension?: string | null };
    const email = String(body.email ?? "").trim().toLowerCase();
    const extension = body.extension ? String(body.extension).trim() : null;
    if (!email) return NextResponse.json({ error: "Whose extension?" }, { status: 400 });

    const { data: employee } = await createServiceRoleClient().from("employees").select("id").ilike("email", email).maybeSingle();
    if (!employee) return NextResponse.json({ error: "That person isn't on the Users list." }, { status: 404 });

    if (extension) {
      const choice = (await extensionChoices()).find((c) => c.user === extension);
      if (!choice) return NextResponse.json({ error: `There's no extension ${extension} on the phone system.` }, { status: 400 });
      if (choice.assignedTo && choice.assignedTo !== email) {
        return NextResponse.json({ error: `Extension ${extension} already belongs to ${choice.assignedTo}.` }, { status: 409 });
      }
    }
    await setExtension(email, extension, admin.email);
    console.log(`[phone] ${admin.email} set ${email} -> ${extension ?? "(none)"}`);
    return NextResponse.json({ ok: true, extension });
  } catch (err) {
    return fail(err);
  }
}
