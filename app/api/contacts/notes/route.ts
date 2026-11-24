import { NextResponse, type NextRequest } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Notes on a contact, kept here because RingLogix contacts have no notes
 * field. Shared by everyone who can see the contact.
 */

const KEY = /^[\w*]{1,20}:[0-9a-f]{8,64}$/i;

function missing(message: string) {
  return /contact_notes/.test(message) && /does not exist|schema cache/.test(message);
}

export async function GET(req: NextRequest) {
  try {
    await requireEmployee();
    const key = req.nextUrl.searchParams.get("key") ?? "";
    if (!KEY.test(key)) return NextResponse.json({ error: "Which contact?" }, { status: 400 });
    const { data, error } = await createServiceRoleClient().from("contact_notes").select("notes, updated_by, updated_at").eq("contact_key", key).maybeSingle();
    if (error) {
      if (missing(error.message)) return NextResponse.json({ notes: "", setup: "Run supabase/migration-contact-notes.sql to keep notes on contacts." });
      throw error;
    }
    return NextResponse.json({ notes: data?.notes ?? "", updatedBy: data?.updated_by ?? "", updatedAt: data?.updated_at ?? null });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[contacts:notes]", err);
    return NextResponse.json({ error: "Couldn't load the notes." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await requireEmployee();
    const body = (await req.json().catch(() => ({}))) as { key?: string; notes?: string };
    const key = String(body.key ?? "");
    if (!KEY.test(key)) return NextResponse.json({ error: "Which contact?" }, { status: 400 });
    const notes = String(body.notes ?? "").slice(0, 10_000);
    const { error } = await createServiceRoleClient().from("contact_notes").upsert(
      { contact_key: key, notes, updated_by: actor.name || actor.email, updated_at: new Date().toISOString() },
      { onConflict: "contact_key" },
    );
    if (error) {
      if (missing(error.message)) return NextResponse.json({ error: "Notes aren't switched on yet: run supabase/migration-contact-notes.sql." }, { status: 503 });
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[contacts:notes]", err);
    return NextResponse.json({ error: "Couldn't save the notes." }, { status: 500 });
  }
}
