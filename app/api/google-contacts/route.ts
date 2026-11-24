import { NextResponse, type NextRequest } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils";
import {
  claimLink, extensionOptions, getLink, googleConfigured, repend, revokeGoogle, statusFor, syncLink,
} from "@/lib/google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The signed-in person's own Google Contacts sync. Everyone manages only
 * their own: there is no way here to see or change somebody else's.
 */

function fail(err: unknown) {
  if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = getErrorMessage(err, "Something went wrong");
  // Before migration-google-contacts.sql has been run.
  if (/google_contact/.test(message) && /does not exist|schema cache/.test(message)) {
    return NextResponse.json({ error: "Google sync isn't set up yet: run supabase/migration-google-contacts.sql.", code: "migration_missing" }, { status: 503 });
  }
  console.error("[google-contacts]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const actor = await requireEmployee();
    if (!googleConfigured()) return NextResponse.json({ configured: false });
    const [link, extensions] = await Promise.all([getLink(actor.email), extensionOptions(actor.email)]);
    const mine = extensions.find((e) => e.email && e.email === actor.email.toLowerCase());
    return NextResponse.json({
      configured: true,
      status: link ? await statusFor(link) : null,
      extensions,
      suggested: mine?.user ?? "",
    });
  } catch (err) {
    return fail(err);
  }
}

/** "Sync now". */
export async function POST() {
  try {
    const actor = await requireEmployee();
    const link = await getLink(actor.email);
    if (!link) return NextResponse.json({ error: "Connect Google first." }, { status: 400 });
    if (!link.enabled && !link.removing) {
      return NextResponse.json({ error: link.last_error || "This sync is switched off. Connect Google again." }, { status: 400 });
    }
    const claimed = await claimLink(actor.email);
    if (!claimed) return NextResponse.json({ ok: true, message: "A sync is already running." });
    const result = await syncLink(claimed, 40_000);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return fail(err);
  }
}

/** A different extension's book. Old copies come out, new ones go in. */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireEmployee();
    const { extension } = (await req.json().catch(() => ({}))) as { extension?: string };
    const link = await getLink(actor.email);
    if (!link) return NextResponse.json({ error: "Connect Google first." }, { status: 400 });
    const option = (await extensionOptions(actor.email)).find((o) => o.user === String(extension ?? "").trim());
    if (!option) return NextResponse.json({ error: "That extension isn't on this phone system." }, { status: 400 });
    if (option.takenBy) return NextResponse.json({ error: `Extension ${option.user} already syncs someone else's Google contacts.` }, { status: 409 });
    if (option.user === link.extension) return NextResponse.json({ ok: true });

    const { error } = await createServiceRoleClient()
      .from("google_contact_links")
      .update({ extension: option.user, next_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("owner_email", link.owner_email);
    if (error) {
      if (/google_contact_links_extension/.test(error.message)) {
        return NextResponse.json({ error: `Extension ${option.user} already syncs someone else's Google contacts.` }, { status: 409 });
      }
      throw error;
    }
    await repend(link.owner_email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

/**
 * Disconnect. ?remove=1 also takes out every contact the sync added (the
 * timer does it over the next minutes, then forgets the connection);
 * without it they stay in RingLogix as ordinary contacts.
 */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireEmployee();
    const link = await getLink(actor.email);
    if (!link) return NextResponse.json({ ok: true });
    const remove = req.nextUrl.searchParams.get("remove") === "1";
    const db = createServiceRoleClient();
    await revokeGoogle(link.refresh_token);

    if (!remove) {
      const { error } = await db.from("google_contact_links").delete().eq("owner_email", link.owner_email);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    const { error } = await db
      .from("google_contact_links")
      .update({ enabled: false, removing: true, next_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("owner_email", link.owner_email);
    if (error) throw error;
    await db.from("google_contacts").update({ deleted: true, state: "pending" }).eq("owner_email", link.owner_email);
    // Start straight away; the timer finishes whatever doesn't fit.
    const claimed = await claimLink(actor.email);
    const result = claimed ? await syncLink(claimed, 30_000) : null;
    return NextResponse.json({ ok: true, message: result?.message });
  } catch (err) {
    return fail(err);
  }
}
