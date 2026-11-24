import { NextResponse, type NextRequest } from "next/server";
import { ApiAuthError, requireEmployee } from "@/lib/api-auth";
import { callDetail, recordingUrl } from "@/lib/call-intel";
import { requireCallAccess } from "@/lib/call-access";
import { ourDomain, ringlogixAuthHeader } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOST = /(^|\.)ringlogix\.com$/i;

/**
 * A call's recording, streamed through here like voicemail: the browser
 * names the call, the address is looked up and host-checked on the server,
 * and never leaves it. Range passes through so the player can seek.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEmployee();
    const { id } = await params;
    if (!/^[0-9a-f]{20,64}$/i.test(id)) return NextResponse.json({ error: "Which call?" }, { status: 400 });
    const domain = ourDomain();
    const detail = await callDetail(domain, id);
    if (!detail) return NextResponse.json({ error: "That call isn't in RingLogix's records." }, { status: 404 });
    await requireCallAccess(detail.extensions);

    const address = await recordingUrl(domain, id);
    if (!address) return NextResponse.json({ error: "There's no recording of that call." }, { status: 404 });
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
      // A private conversation: never in a shared cache.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="call-${id.slice(0, 12)}.wav"`,
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
