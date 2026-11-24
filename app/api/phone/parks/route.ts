import { NextResponse } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { extensionFor, parkSpots } from "@/lib/phone";
import { ringlogixFailure } from "@/lib/ringlogix-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The park spots and who is parked in them, for the portal phone. */
export async function GET() {
  try {
    const actor = await requireEmployee();
    if (!(await extensionFor(actor.email))) return NextResponse.json({ error: "No extension is set for you." }, { status: 404 });
    return NextResponse.json({ spots: await parkSpots() }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}
