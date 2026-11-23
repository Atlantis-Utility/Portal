import {
  MAX_GROUP, MAX_INDIVIDUAL, MAX_TEXT_LENGTH,
  type Repeat, type ScheduleTrigger, type SendSmsAction, type SmsTarget,
} from "./types";
import { firstRun } from "./schedule";

/**
 * Checks a scheduled text before it is saved.
 *
 * Shared, so the form can say what's wrong as you type and the server can
 * refuse the same things without trusting the form. Returns the cleaned-up
 * value, or the first problem in words a person can act on.
 */
export interface ScheduledSmsInput {
  name?: unknown;
  trigger?: unknown;
  action?: unknown;
}

export type Checked =
  | { ok: true; name: string; trigger: ScheduleTrigger; action: SendSmsAction; firstRunAt: number }
  | { ok: false; error: string };

const REPEATS: Repeat[] = ["none", "daily", "weekdays", "weekly", "monthly"];

/** Ten-digit US number, or "" if it isn't one. */
export function tenDigits(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  const national = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return national.length === 10 ? national : "";
}

export function checkScheduledSms(input: ScheduledSmsInput, nowMs: number): Checked {
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

  const t = (input.trigger ?? {}) as Partial<ScheduleTrigger>;
  const atMs = Date.parse(String(t.at ?? ""));
  if (Number.isNaN(atMs)) return { ok: false, error: "Pick when it should be sent." };
  const repeat = REPEATS.includes(t.repeat as Repeat) ? (t.repeat as Repeat) : null;
  if (!repeat) return { ok: false, error: "Pick how often it repeats." };
  const until = typeof t.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.until) ? t.until : undefined;
  const trigger: ScheduleTrigger = {
    at: new Date(atMs).toISOString(),
    repeat,
    ...(repeat !== "none" && until ? { until } : {}),
  };
  const firstRunAt = firstRun(trigger, nowMs);
  if (firstRunAt === null) {
    return {
      ok: false,
      error: repeat === "none"
        ? "That time has already passed."
        : "That schedule ends before it would ever run.",
    };
  }

  const a = (input.action ?? {}) as Partial<SendSmsAction>;
  const text = String(a.text ?? "").trim();
  if (!text) return { ok: false, error: "Write the message." };
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `That's ${text.length} characters; the limit is ${MAX_TEXT_LENGTH}.` };
  }

  const target = checkTarget(a.target);
  if ("error" in target) return { ok: false, error: target.error };

  return { ok: true, name, trigger, action: { text, target }, firstRunAt };
}

function checkTarget(raw: unknown): SmsTarget | { error: string } {
  const t = (raw ?? {}) as Record<string, unknown>;

  if (t.kind === "thread") {
    const sessionId = String(t.sessionId ?? "").trim();
    if (!sessionId) return { error: "Pick a conversation." };
    return {
      kind: "thread",
      sessionId,
      user: String(t.user ?? "").trim(),
      label: String(t.label ?? "").trim().slice(0, 120),
    };
  }

  if (t.kind === "numbers") {
    const list = Array.isArray(t.numbers) ? t.numbers.map((n) => String(n)) : [];
    const numbers: string[] = [];
    for (const one of list) {
      const n = tenDigits(one);
      if (!n) return { error: `"${one}" doesn't look like a US number — ten digits, please.` };
      if (!numbers.includes(n)) numbers.push(n);
    }
    if (numbers.length === 0) return { error: "Add at least one person to send to." };
    const mode = t.mode === "group" ? "group" : "individual";
    if (mode === "group" && numbers.length > MAX_GROUP) {
      return { error: `A group text can have at most ${MAX_GROUP} people. Send it to each person instead.` };
    }
    if (mode === "group" && numbers.length < 2) {
      return { error: "A group needs at least two people. Send it on its own instead." };
    }
    if (numbers.length > MAX_INDIVIDUAL) {
      return { error: `At most ${MAX_INDIVIDUAL} people per scheduled text.` };
    }
    const fromNumber = String(t.fromNumber ?? "").replace(/\D/g, "");
    if (!fromNumber) return { error: "Pick which of our numbers it's sent from." };

    const labels: Record<string, string> = {};
    if (t.labels && typeof t.labels === "object") {
      for (const [k, v] of Object.entries(t.labels as Record<string, unknown>)) {
        const n = tenDigits(k);
        if (n && numbers.includes(n) && typeof v === "string" && v.trim()) labels[n] = v.trim().slice(0, 80);
      }
    }
    return { kind: "numbers", numbers, fromNumber, mode, labels };
  }

  return { error: "Pick who it goes to." };
}
