import { NextResponse, type NextRequest } from "next/server";
import { ApiAuthError, requireEmployee } from "@/lib/api-auth";
import { callDetail } from "@/lib/call-intel";
import { requireCallAccess } from "@/lib/call-access";
import { ourDomain } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One call's recording (whether there is one), transcript and summary. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEmployee();
    const { id } = await params;
    if (!/^[0-9a-f]{20,64}$/i.test(id)) return NextResponse.json({ error: "Which call?" }, { status: 400 });
    const detail = await callDetail(ourDomain(), id);
    if (!detail) return NextResponse.json({ error: "That call isn't in RingLogix's records." }, { status: 404 });
    await requireCallAccess(detail.extensions);
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}
