import { NextResponse } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { callInvolves, loadCalls, loadVoicemailsFor } from "@/lib/inbox";
import { extensionFor } from "@/lib/phone";
import { ourDomain } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The portal phone's Recents and Voicemail: the signed-in person's own
 * extension only, never anyone else's (that's the Inbox page's job, behind
 * its own page access).
 */
export async function GET() {
  try {
    const actor = await requireEmployee();
    const extension = await extensionFor(actor.email);
    if (!extension) return NextResponse.json({ error: "No extension is set for you." }, { status: 404 });
    const domain = ourDomain();
    const [calls, voicemails] = await Promise.allSettled([loadCalls(domain, 14), loadVoicemailsFor(domain, extension)]);
    return NextResponse.json(
      {
        extension,
        calls: calls.status === "fulfilled" ? calls.value.filter((c) => callInvolves(c, extension)).slice(0, 200) : [],
        voicemails: voicemails.status === "fulfilled" ? voicemails.value : [],
        unavailable: [
          ...(calls.status === "rejected" ? ["calls"] : []),
          ...(voicemails.status === "rejected" ? ["voicemail"] : []),
        ],
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}
