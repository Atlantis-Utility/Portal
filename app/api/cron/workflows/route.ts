import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/utils";
import { timingSafeEqual } from "node:crypto";
import { runDueWorkflows } from "@/lib/workflows/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The timer's door. Called every minute by Supabase (pg_cron + pg_net, see
 * supabase/migration-workflows.sql) or by Vercel Cron, which sends the same
 * header on its own.
 *
 * Nobody signs in here, so the only thing that lets a caller in is
 * CRON_SECRET. Without one configured the route refuses everything rather
 * than running for anybody who finds it.
 */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't set, so the timer is switched off." }, { status: 503 });
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
    return NextResponse.json(report);
  } catch (err) {
    const message = getErrorMessage(err, "Run failed");
    console.error("[workflows] run failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
