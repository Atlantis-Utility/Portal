import "server-only";
import { getErrorMessage } from "@/lib/utils";
import { claimDue, finishRun, liveSentSince, recordRun } from "./store";
import { executeSendSms, sendingIsLive, type SendResult } from "./send-sms";
import { instantOf, nextRun, wallAt } from "./schedule";
import type { Workflow } from "./types";
import { emit } from "@/lib/integrations/engine";

/**
 * Runs whatever has come due. Called by the timer every minute.
 *
 * Each due workflow is claimed by exactly one caller (see
 * claim_due_workflows), carried out, logged, and moved on to its next run.
 */

/** Later than this and a run is recorded as missed rather than sent late. */
const LATE_LIMIT_MS = 2 * 60 * 60 * 1000;
const BATCH = 10;
const LEASE_SECONDS = 300;

function dailyCap(): number {
  const n = Number(process.env.SCHEDULED_SMS_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

/** Midnight today, Pacific time, as an ISO timestamp. */
function startOfPacificDay(nowMs: number): string {
  const w = wallAt(nowMs);
  return new Date(instantOf({ y: w.y, m: w.m, d: w.d, hh: 0, mm: 0 })).toISOString();
}

export interface RunReport {
  live: boolean;
  claimed: number;
  results: Array<{ id: string; name: string; outcome: string; summary: string }>;
}

export async function runDueWorkflows(nowMs = Date.now()): Promise<RunReport> {
  const live = sendingIsLive();
  const due = await claimDue(BATCH, LEASE_SECONDS);
  const report: RunReport = { live, claimed: due.length, results: [] };

  for (const flow of due) {
    const result = await runOne(flow, live, nowMs);
    report.results.push({ id: flow.id, name: flow.name, outcome: result.outcome, summary: result.summary });
  }
  return report;
}

async function runOne(flow: Workflow, live: boolean, nowMs: number): Promise<SendResult> {
  const scheduledFor = flow.nextRunAt;
  const dueMs = scheduledFor ? Date.parse(scheduledFor) : nowMs;

  let result: SendResult;
  try {
    if (nowMs - dueMs > LATE_LIMIT_MS) {
      // Nothing was running when it came due (the app was down, or not yet
      // deployed). A reminder sent hours late is worse than none.
      const hours = Math.round((nowMs - dueMs) / 3_600_000);
      result = {
        outcome: "missed",
        sentCount: 0,
        summary: `Not sent: it was due ${hours} hour${hours === 1 ? "" : "s"} ago, which is too late.`,
        detail: [],
      };
    } else {
      const budget = Math.max(0, dailyCap() - (await liveSentSince(startOfPacificDay(nowMs))));
      result = await executeSendSms(flow.action, {
        live,
        byName: flow.createdByName || flow.createdByEmail || "Scheduled",
        byEmail: flow.createdByEmail,
        budget,
      });
    }
  } catch (err) {
    result = {
      outcome: "failed",
      sentCount: 0,
      summary: getErrorMessage(err, "Something went wrong running this."),
      detail: [],
    };
  }

  await recordRun({
    workflowId: flow.id,
    scheduledFor,
    outcome: result.outcome,
    live,
    sentCount: result.sentCount,
    summary: result.summary,
    detail: result.detail,
  });

  // Next run is computed from now, not from when it was due: a repeat that
  // missed three days fires once at its next slot rather than three times.
  const next = nextRun(flow.trigger, Math.max(nowMs, dueMs));
  await finishRun(flow.id, {
    nextRunAt: next === null ? null : new Date(next).toISOString(),
    status: next === null ? "completed" : "active",
    runCount: flow.runCount + 1,
  });

  // Tell any outgoing webhooks (a CRM, Zapier). Never fails the run.
  await emit("workflow.run", {
    workflow: flow.name || flow.id,
    outcome: result.outcome,
    live,
    sent: result.sentCount,
    summary: result.summary,
    recipients: result.detail.map((d) => ({ to: d.to, ok: d.ok, note: d.error ?? d.skipped ?? "" })),
  }).catch(() => {});
  return result;
}
