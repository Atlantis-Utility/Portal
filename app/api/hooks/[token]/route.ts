import { NextRequest, NextResponse } from "next/server";
import { getByHookHash, logEvent, saveContacts } from "@/lib/integrations/store";
import { hashToken } from "@/lib/integrations/crypto";
import { mapRecord, recordsOf } from "@/lib/integrations/mapping";
import { emit } from "@/lib/integrations/engine";
import { getErrorMessage } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 512 * 1024;
const MAX_RECORDS = 1000;

/**
 * An incoming webhook. Other systems - Zapier, Make, n8n, a CRM's own
 * workflow rules - POST JSON here: one contact, a list, or a wrapper like
 * {"contacts": [...]}. Each record with a name, phone or email is kept as
 * a contact of this integration.
 *
 * The URL itself is the credential: an unguessable token whose hash is all
 * the database holds. A wrong token gets the same 404 as no route at all.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let row;
  try {
    row = await getByHookHash(hashToken(token));
  } catch {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!row.enabled) return NextResponse.json({ error: "This webhook is switched off." }, { status: 423 });

  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "That's too large (512 KB at most)." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    await logEvent(row.id, { kind: "webhook_in", ok: false, summary: "Received something that isn't JSON." });
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  try {
    const records = recordsOf(body).slice(0, MAX_RECORDS);
    const contacts = records
      .map((r) => mapRecord(r))
      .filter((m) => m.externalId && (m.name || m.phone || m.email));
    const saved = await saveContacts(row.id, contacts, { prune: false });
    const summary = `Received ${records.length} record${records.length === 1 ? "" : "s"}; kept ${saved.saved} as contacts (${saved.withPhone} with a phone number).`;
    await logEvent(row.id, { kind: "webhook_in", ok: true, summary });
    await emit("webhook.received", { integration: row.name, records: records.length, contacts: saved.saved });
    return NextResponse.json({ ok: true, received: records.length, contacts: saved.saved });
  } catch (err) {
    const message = getErrorMessage(err, "Couldn't take that in.");
    await logEvent(row.id, { kind: "webhook_in", ok: false, summary: message }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
