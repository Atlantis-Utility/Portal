import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type {
  RunDetail, RunOutcome, ScheduleTrigger, SendSmsAction, Workflow, WorkflowRun, WorkflowStatus,
} from "./types";

/**
 * Reads and writes workflows, always with the service key.
 *
 * The tables have RLS on and no policies, so this module is the only way
 * in. Callers are API routes that have already checked who is asking.
 */

interface WorkflowRow {
  id: string;
  name: string;
  status: WorkflowStatus;
  trigger_type: "schedule";
  trigger: ScheduleTrigger;
  action_type: "send_sms";
  action: SendSmsAction;
  next_run_at: string | null;
  locked_until: string | null;
  last_run_at: string | null;
  run_count: number;
  created_by_email: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  workflow_id: string;
  started_at: string;
  scheduled_for: string | null;
  outcome: RunOutcome;
  live: boolean;
  sent_count: number;
  summary: string;
  detail: RunDetail[];
}

export const fromRow = (r: WorkflowRow): Workflow => ({
  id: r.id,
  name: r.name,
  status: r.status,
  triggerType: r.trigger_type,
  trigger: r.trigger,
  actionType: r.action_type,
  action: r.action,
  nextRunAt: r.next_run_at,
  lastRunAt: r.last_run_at,
  runCount: r.run_count,
  createdByName: r.created_by_name,
  createdByEmail: r.created_by_email,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const runFromRow = (r: RunRow): WorkflowRun => ({
  id: r.id,
  workflowId: r.workflow_id,
  startedAt: r.started_at,
  scheduledFor: r.scheduled_for,
  outcome: r.outcome,
  live: r.live,
  sentCount: r.sent_count,
  summary: r.summary,
  detail: Array.isArray(r.detail) ? r.detail : [],
});

const db = () => createServiceRoleClient();

/** Every workflow, newest first, each with its most recent run. */
export async function listWorkflows(): Promise<Workflow[]> {
  const { data, error } = await db()
    .from("workflows")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const flows = (data as WorkflowRow[]).map(fromRow);
  if (flows.length === 0) return flows;

  // One query for the latest run of each, rather than one per workflow.
  const { data: runs } = await db()
    .from("workflow_runs")
    .select("*")
    .in("workflow_id", flows.map((f) => f.id))
    .order("started_at", { ascending: false })
    .limit(1000);
  const latest = new Map<string, WorkflowRun>();
  for (const r of (runs ?? []) as RunRow[]) {
    if (!latest.has(r.workflow_id)) latest.set(r.workflow_id, runFromRow(r));
  }
  return flows.map((f) => ({ ...f, lastRun: latest.get(f.id) ?? null }));
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const { data, error } = await db().from("workflows").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as WorkflowRow) : null;
}

export async function createWorkflow(input: {
  name: string;
  trigger: ScheduleTrigger;
  action: SendSmsAction;
  nextRunAt: string;
  createdByName: string;
  createdByEmail: string;
}): Promise<Workflow> {
  const { data, error } = await db()
    .from("workflows")
    .insert({
      name: input.name,
      status: "active",
      trigger_type: "schedule",
      trigger: input.trigger,
      action_type: "send_sms",
      action: input.action,
      next_run_at: input.nextRunAt,
      created_by_name: input.createdByName,
      created_by_email: input.createdByEmail,
    })
    .select("*")
    .single();
  if (error) throw error;
  return fromRow(data as WorkflowRow);
}

export async function updateWorkflow(
  id: string,
  patch: Partial<{
    name: string;
    status: WorkflowStatus;
    trigger: ScheduleTrigger;
    action: SendSmsAction;
    nextRunAt: string | null;
  }>,
): Promise<Workflow | null> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.trigger !== undefined) row.trigger = patch.trigger;
  if (patch.action !== undefined) row.action = patch.action;
  if (patch.nextRunAt !== undefined) row.next_run_at = patch.nextRunAt;
  const { data, error } = await db().from("workflows").update(row).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as WorkflowRow) : null;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const { error } = await db().from("workflows").delete().eq("id", id);
  if (error) throw error;
}

export async function listRuns(workflowId: string, limit = 50): Promise<WorkflowRun[]> {
  const { data, error } = await db()
    .from("workflow_runs")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as RunRow[]).map(runFromRow);
}

// ── Used by the runner ───────────────────────────────────────────────────

/** Takes the due workflows, each leased to this caller alone. */
export async function claimDue(limit: number, leaseSeconds: number): Promise<Workflow[]> {
  const { data, error } = await db().rpc("claim_due_workflows", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return ((data ?? []) as WorkflowRow[]).map(fromRow);
}

export async function recordRun(run: Omit<WorkflowRun, "id" | "startedAt">): Promise<void> {
  const { error } = await db().from("workflow_runs").insert({
    workflow_id: run.workflowId,
    scheduled_for: run.scheduledFor,
    outcome: run.outcome,
    live: run.live,
    sent_count: run.sentCount,
    summary: run.summary,
    detail: run.detail,
  });
  if (error) throw error;
}

/** Records that a run finished and when the workflow fires next. */
export async function finishRun(
  id: string,
  next: { nextRunAt: string | null; status: WorkflowStatus; runCount: number },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db()
    .from("workflows")
    .update({
      next_run_at: next.nextRunAt,
      status: next.status,
      run_count: next.runCount,
      last_run_at: now,
      locked_until: null,
      updated_at: now,
    })
    .eq("id", id);
  if (error) throw error;
}

/** Live texts sent since midnight Pacific, across every workflow. */
export async function liveSentSince(sinceIso: string): Promise<number> {
  const { data, error } = await db()
    .from("workflow_runs")
    .select("sent_count")
    .eq("live", true)
    .gte("started_at", sinceIso);
  if (error) throw error;
  return ((data ?? []) as Array<{ sent_count: number }>).reduce((n, r) => n + (r.sent_count ?? 0), 0);
}
