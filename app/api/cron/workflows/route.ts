import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/utils";
import { timingSafeEqual } from "node:crypto";
import { runDueWorkflows } from "@/lib/workflows/runner";
import { runDueSyncs } from "@/lib/integrations/engine";
import { runDueGoogleSyncs } from "@/lib/google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Room for the Google Contacts writes, which stop themselves at 45s.
export const maxDuration = 60;

/**
 * The timer's door. Called every minute by Supabase (pg_cron + pg_net, see
 * supabase/migration-workflows.sql) or by Vercel Cron, which sends the same
 * header on its own.
 *
 * Nobody signs in here, so the only thing that lets a caller in is
 * CRON_SECRET. Without one configured the route refuses everything rather
 * than running for anybody who finds it.
 */
// Trimmed on both sides: a value pasted into Vercel or Supabase Vault with a
// stray space or line break otherwise never matches, and every call is
// refused with nothing to say why.
const configuredSecret = () => (process.env.CRON_SECRET ?? "").trim();

function authorised(req: NextRequest): boolean {
  const secret = configuredSecret();
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!configuredSecret()) {
    return NextResponse.json({ error: "CRON_SECRET isn't set, so the timer is switched off." }, { status: 503 });
  }
  // A short secret is guessable; refuse to run on one, and say so rather
  // than answering every call with a bare "Not allowed".
  if (configuredSecret().length < 16) {
    return NextResponse.json({ error: "CRON_SECRET is too short (16 characters at least), so the timer is switched off." }, { status: 503 });
  }
  if (!authorised(req)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });

  try {
    const report = await runDueWorkflows();
    if (report.claimed > 0) {
      console.log(
        `[workflows] ran ${report.claimed} (${report.live ? "LIVE" : "test mode"}): ` +
        report.results.map((r) => `${r.name || r.id}=${r.outcome}`).join(", "),
      );
    }
    // Same minute, same timer: integrations whose sync interval has come
    // round. A failing sync is recorded against that integration and never
    // stops the scheduled texts above from having run.
    let syncs: Awaited<ReturnType<typeof runDueSyncs>> = [];
    try {
      syncs = await runDueSyncs();
    } catch (err) {
      console.error("[integrations] sync run failed:", getErrorMessage(err, "unknown"));
    }
    // And everyone's Google Contacts, each on its own clock.
    let google: Awaited<ReturnType<typeof runDueGoogleSyncs>> = [];
    try {
      google = await runDueGoogleSyncs();
    } catch (err) {
      console.error("[google-contacts] sync run failed:", getErrorMessage(err, "unknown"));
    }
    return NextResponse.json({ ...report, syncs, google });
  } catch (err) {
    const message = getErrorMessage(err, "Run failed");
    console.error("[workflows] run failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
