/**
 * Workflows: a trigger, and an action to take when it fires.
 *
 * Today there is one of each - a schedule, and sending a text - which is
 * what "scheduled messages" are. The shape is general on purpose: later
 * triggers (a text arrives, a CRM calls in) and actions (tag, create a task,
 * call another app) are new members of these unions, not a new table.
 *
 * Shared by the browser and the server, so nothing here may import a
 * server-only module.
 */

/** How a scheduled workflow repeats. Every rule is read in Pacific time. */
export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: "Once",
  daily: "Every day",
  weekdays: "Every weekday (Mon–Fri)",
  weekly: "Every week",
  monthly: "Every month",
};

export interface ScheduleTrigger {
  /** The first run, as an ISO timestamp. Its Pacific wall time is the rule. */
  at: string;
  repeat: Repeat;
  /** Last day a repeat may run, YYYY-MM-DD in Pacific time. */
  until?: string;
}

/**
 * Who a text goes to.
 *
 * `thread` sends into a conversation that already exists, exactly as a
 * reply would: the destination and our number come from the conversation
 * at send time, never from what was stored.
 *
 * `numbers` covers contacts and typed-in numbers alike - a contact is just
 * a number with a name - sent either as one group text or to each person
 * on their own.
 */
export type SmsTarget =
  | { kind: "thread"; sessionId: string; user: string; label: string }
  | {
      kind: "numbers";
      /** Ten-digit US numbers. */
      numbers: string[];
      /** Our number to send from. */
      fromNumber: string;
      mode: "individual" | "group";
      /** number -> the name it was picked under, for display only. */
      labels?: Record<string, string>;
    };

export interface SendSmsAction {
  text: string;
  target: SmsTarget;
}

export type WorkflowStatus = "active" | "paused" | "completed" | "canceled";

export interface Workflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  triggerType: "schedule";
  trigger: ScheduleTrigger;
  actionType: "send_sms";
  action: SendSmsAction;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  createdByName: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  /** The most recent run, for the list. */
  lastRun?: WorkflowRun | null;
}

/**
 * What one firing did.
 *
 * dry_run: everything checked out and nothing was sent, because sending is
 *          switched off (SCHEDULED_SMS_MODE is not "live").
 * missed:  it came due while nothing was running, and too late to send.
 */
export type RunOutcome = "sent" | "dry_run" | "partial" | "failed" | "skipped" | "missed";

export interface RunDetail {
  /** Who it was for, as shown to people: a name or a formatted number. */
  to: string;
  ok: boolean;
  /** Checked and deliberately not sent: opted out, daily limit, dry run. */
  skipped?: string;
  error?: string;
  messageId?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  startedAt: string;
  scheduledFor: string | null;
  outcome: RunOutcome;
  live: boolean;
  sentCount: number;
  summary: string;
  detail: RunDetail[];
}

/** The page option that lets someone create and manage scheduled texts. */
export const SCHEDULE_OPTION = "messages.schedule";

export const MAX_TEXT_LENGTH = 1600;
/** A group text is addressed to everyone at once; the PBX caps it there. */
export const MAX_GROUP = 10;
/** Sent one by one, so the ceiling is about blast radius, not the PBX. */
export const MAX_INDIVIDUAL = 100;
