import { NextResponse } from "next/server";
import { tenantDomain } from "@/lib/tenancy";
import { ApiAuthError, requirePageAccess } from "@/lib/api-auth";
import { isConfigured } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";
import { loadCalls, loadVoicemails } from "@/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Voicemails and recent calls for the Inbox. Texts aren't here: the page
 * reads them from the Messages list, which already applies who-can-see-what.
 *
 * Either half failing leaves the other standing, with a note saying which.
 */
export async function GET() {
  try {
    await requirePageAccess("/inbox");
    if (!isConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
    const domain = await tenantDomain();
    const [voicemails, calls] = await Promise.allSettled([loadVoicemails(domain), loadCalls(domain)]);
    if (voicemails.status === "rejected" && calls.status === "rejected") return ringlogixFailure(voicemails.reason);
    return NextResponse.json({
      voicemails: voicemails.status === "fulfilled" ? voicemails.value : [],
      calls: calls.status === "fulfilled" ? calls.value : [],
      unavailable: [
        ...(voicemails.status === "rejected" ? ["voicemail"] : []),
        ...(calls.status === "rejected" ? ["calls"] : []),
      ],
    });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}
