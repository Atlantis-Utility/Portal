import { NextRequest, NextResponse } from "next/server";
import { tenantDomain } from "@/lib/tenancy";
import { ApiAuthError, requireEmployee, requirePageAccess } from "@/lib/api-auth";
import { extensionFor } from "@/lib/phone";
import { isConfigured, ringlogixAuthHeader } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";
import { voicemailAudioUrl } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOST = /(^|\.)ringlogix\.com$/i;

/**
 * A voicemail's recording.
 *
 * RingLogix's recording address opens for anyone who has it - no login -
 * so it stays on the server: the browser names an extension and a
 * voicemail, and the address is looked up here, host-checked, and streamed.
 * Range requests pass through, so the player can seek.
 */
export async function GET(req: NextRequest) {
  try {
    const user = (req.nextUrl.searchParams.get("user") ?? "").trim();
    const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
    // The Inbox page reads every box. Without it, the portal phone still
    // plays the person's own: their extension's box and nobody else's.
    try {
      await requirePageAccess("/inbox");
    } catch (err) {
      if (!(err instanceof ApiAuthError) || err.status !== 403) throw err;
      const actor = await requireEmployee();
      if (!user || (await extensionFor(actor.email)) !== user) throw err;
    }
    if (!isConfigured()) return NextResponse.json({ error: "RingLogix isn't configured" }, { status: 503 });
    if (!user || !id) return NextResponse.json({ error: "Which voicemail?" }, { status: 400 });

    const address = await voicemailAudioUrl(await tenantDomain(), user, id);
    if (!address) return NextResponse.json({ error: "That voicemail isn't there any more." }, { status: 404 });
    let target: URL;
    try {
      target = new URL(address);
    } catch {
      return NextResponse.json({ error: "That recording's address isn't usable." }, { status: 502 });
    }
    if (target.protocol !== "https:" || !ALLOWED_HOST.test(target.hostname)) {
      return NextResponse.json({ error: "That recording isn't hosted where it should be." }, { status: 502 });
    }

    const range = req.headers.get("range");
    const upstream = await fetch(target, {
      headers: { Authorization: await ringlogixAuthHeader(), ...(range ? { Range: range } : {}) },
      cache: "no-store",
    });
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `RingLogix wouldn't hand over the recording (${upstream.status})` }, { status: 502 });
    }
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "audio/wav",
      // Somebody's voicemail: never in a shared cache.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="voicemail-${id.slice(3, 17)}.wav"`,
    });
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}
