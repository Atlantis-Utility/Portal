import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ApiAuthError, requireEmployee } from "@/lib/api-auth";
import { callDetail, summarizeCall, summariesEnabled } from "@/lib/call-intel";
import { requireCallAccess } from "@/lib/call-access";
import { ourDomain } from "@/lib/ringlogix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Writes (once) and returns a call's summary from its transcript. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEmployee();
    if (!summariesEnabled()) {
      return NextResponse.json({ error: "Call summaries aren't switched on (ANTHROPIC_API_KEY isn't set)." }, { status: 503 });
    }
    const { id } = await params;
    if (!/^[0-9a-f]{20,64}$/i.test(id)) return NextResponse.json({ error: "Which call?" }, { status: 400 });
    const detail = await callDetail(ourDomain(), id);
    if (!detail) return NextResponse.json({ error: "That call isn't in RingLogix's records." }, { status: 404 });
    await requireCallAccess(detail.extensions);
    if (detail.summary) return NextResponse.json(detail.summary);
    if (!detail.transcript?.lines.length) return NextResponse.json({ error: "There's no transcript to summarize yet." }, { status: 409 });
    return NextResponse.json(await summarizeCall(id, detail.transcript.lines));
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "Too many summaries at once. Try again in a minute." }, { status: 429 });
    if (err instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: "The ANTHROPIC_API_KEY was refused." }, { status: 502 });
    if (err instanceof Anthropic.APIError) return NextResponse.json({ error: `Couldn't write the summary (${err.status}).` }, { status: 502 });
    console.error("[calls:summary]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't write the summary." }, { status: 500 });
  }
}
