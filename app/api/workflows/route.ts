import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/utils";
import { requireConversation } from "@/lib/messages/access";
import { requirePageOption, ApiAuthError } from "@/lib/api-auth";
import { createWorkflow, listWorkflows } from "@/lib/workflows/store";
import { checkScheduledSms } from "@/lib/workflows/validate";
import { sendingIsLive } from "@/lib/workflows/send-sms";
import { SCHEDULE_OPTION } from "@/lib/workflows/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refuse(err: unknown) {
  if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = getErrorMessage(err, "Something went wrong");
  // The table not existing yet is the common first-run failure; say so.
  if (/workflows/.test(message) && /does not exist|schema cache/.test(message)) {
    return NextResponse.json(
      { error: "Scheduled messages aren't set up yet: run supabase/migration-workflows.sql." },
      { status: 503 },
    );
  }
  console.error("[workflows]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Every scheduled text, with whether sending is live or rehearsed. */
export async function GET() {
  try {
    await requirePageOption(SCHEDULE_OPTION);
    const workflows = await listWorkflows();
    return NextResponse.json({ workflows, live: sendingIsLive() });
  } catch (err) {
    return refuse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePageOption(SCHEDULE_OPTION);
    const body = await req.json().catch(() => ({}));
    const checked = checkScheduledSms(body, Date.now());
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    // Nobody schedules texts into a conversation they aren't allowed to see.
    if (checked.action.target.kind === "thread") await requireConversation(checked.action.target.sessionId);

    const workflow = await createWorkflow({
      name: checked.name,
      trigger: checked.trigger,
      action: checked.action,
      nextRunAt: new Date(checked.firstRunAt).toISOString(),
      createdByName: actor.name || actor.email,
      createdByEmail: actor.email,
    });
    console.log(`[workflows] ${actor.email} scheduled "${workflow.name || workflow.id}" for ${workflow.nextRunAt}`);
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    return refuse(err);
  }
}
