import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/utils";
import { requirePageOption, ApiAuthError } from "@/lib/api-auth";
import { deleteWorkflow, getWorkflow, listRuns, updateWorkflow } from "@/lib/workflows/store";
import { checkScheduledSms } from "@/lib/workflows/validate";
import { firstRun } from "@/lib/workflows/schedule";
import { runWorkflowNow } from "@/lib/workflows/runner";
import { SCHEDULE_OPTION } from "@/lib/workflows/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function refuse(err: unknown) {
  if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = getErrorMessage(err, "Something went wrong");
  console.error("[workflows]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** One scheduled text and its run history. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePageOption(SCHEDULE_OPTION);
    const { id } = await params;
    const workflow = await getWorkflow(id);
    if (!workflow) return NextResponse.json({ error: "That scheduled message no longer exists." }, { status: 404 });
    const runs = await listRuns(id);
    return NextResponse.json({ workflow, runs });
  } catch (err) {
    return refuse(err);
  }
}

/**
 * Pause, resume, cancel - or replace the whole thing with an edited copy.
 *
 * Resuming, and saving an edit, both pick the next run from now: anything
 * that came due while it was paused is skipped rather than sent in a burst.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const actor = await requirePageOption(SCHEDULE_OPTION);
    const { id } = await params;
    const current = await getWorkflow(id);
    if (!current) return NextResponse.json({ error: "That scheduled message no longer exists." }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = Date.now();

    if (body.do === "pause") {
      if (current.status !== "active") return NextResponse.json({ error: "Only an active schedule can be paused." }, { status: 400 });
      const workflow = await updateWorkflow(id, { status: "paused" });
      return NextResponse.json({ workflow });
    }

    if (body.do === "resume") {
      if (current.status !== "paused") return NextResponse.json({ error: "Only a paused schedule can be resumed." }, { status: 400 });
      const next = firstRun(current.trigger, now);
      if (next === null) {
        return NextResponse.json(
          { error: "There's no run left in this schedule. Edit it to pick a new time." },
          { status: 400 },
        );
      }
      const workflow = await updateWorkflow(id, { status: "active", nextRunAt: new Date(next).toISOString() });
      return NextResponse.json({ workflow });
    }

    if (body.do === "cancel") {
      const workflow = await updateWorkflow(id, { status: "canceled", nextRunAt: null });
      console.log(`[workflows] ${actor.email} canceled "${current.name || id}"`);
      return NextResponse.json({ workflow });
    }

    if (body.do === "run_now") {
      if (current.status === "canceled") {
        return NextResponse.json({ error: "A canceled workflow can't be run." }, { status: 400 });
      }
      const result = await runWorkflowNow(current);
      console.log(`[workflows] ${actor.email} ran "${current.name || id}" by hand: ${result.outcome}`);
      return NextResponse.json({ result });
    }

    if (body.do === "edit") {
      if (current.status === "canceled") {
        return NextResponse.json({ error: "A canceled schedule can't be edited. Make a new one." }, { status: 400 });
      }
      const checked = checkScheduledSms(body, now);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      const workflow = await updateWorkflow(id, {
        name: checked.name,
        trigger: checked.trigger,
        action: checked.action,
        nextRunAt: new Date(checked.firstRunAt).toISOString(),
        // Editing a finished one-off into a new time brings it back.
        status: current.status === "paused" ? "paused" : "active",
      });
      console.log(`[workflows] ${actor.email} edited "${checked.name || id}"`);
      return NextResponse.json({ workflow });
    }

    return NextResponse.json({ error: "Unknown change." }, { status: 400 });
  } catch (err) {
    return refuse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const actor = await requirePageOption(SCHEDULE_OPTION);
    const { id } = await params;
    await deleteWorkflow(id);
    console.log(`[workflows] ${actor.email} deleted ${id}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return refuse(err);
  }
}
