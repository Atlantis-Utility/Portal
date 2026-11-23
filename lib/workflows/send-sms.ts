import "server-only";
import { getErrorMessage } from "@/lib/utils";
import { getMessageSessions, getMessages, sendMessage, ourDomain } from "@/lib/ringlogix";
import {
  digitsOf, extensionOf, normalizeMessage, remoteNumbersOf,
  type RawMessage, type RawMessageSession,
} from "@/lib/ringlogix-messages";
import { recordSender } from "@/lib/messages/senders";
import { formatPhone } from "@/lib/utils";
import type { RunDetail, RunOutcome, SendSmsAction } from "./types";

/**
 * Carries out a "send a text" action.
 *
 * Sending is ON unless the deployment switches it off with
 * SCHEDULED_SMS_MODE=off. Switched off, every check below still runs (the
 * conversation exists, the number is ours, nobody has opted out, the cap
 * isn't reached) and the run records who it would have texted, but the PBX
 * is never asked to send. The switch is read at the one place that calls
 * sendMessage, so no other path can send.
 */
export function sendingIsLive(): boolean {
  // On unless a deployment switches it off. It used to be off unless set
  // to "live", and a deployment that never got the setting (or wasn't
  // redeployed after it) silently rehearsed every run instead of sending.
  const mode = (process.env.SCHEDULED_SMS_MODE ?? "").trim().toLowerCase();
  return mode !== "off" && mode !== "test";
}

/** CTIA's opt-out and opt-back-in words. Matched on the whole message. */
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const START_WORDS = new Set(["START", "UNSTOP", "SUBSCRIBE", "OPTIN"]);

interface Send {
  /** What the run log shows. */
  to: string;
  destination: string;
  /** Our number. Absent for an internal chat to a colleague's extension. */
  fromNumber?: string;
  user: string;
  sessionId: string;
  /** The people on the far side, for the opt-out check. */
  numbers: string[];
}

export interface SendResult {
  outcome: RunOutcome;
  sentCount: number;
  summary: string;
  detail: RunDetail[];
}

export async function executeSendSms(
  action: SendSmsAction,
  opts: { live: boolean; byName: string; byEmail: string; budget: number },
): Promise<SendResult> {
  const domain = ourDomain();
  const sessions = ((await getMessageSessions(domain, "*")) ?? []) as RawMessageSession[];

  // ── Work out what to send, from the mailbox as it is now ──
  const sends: Send[] = [];
  const target = action.target;

  if (target.kind === "thread") {
    const s = sessions.find((x) => x.session_id === target.sessionId);
    if (!s) {
      return failed(target.label || "the conversation",
        "That conversation no longer exists in the phone system.");
    }
    const ext = extensionOf(s.remote);
    const numbers = remoteNumbersOf(s.remote);
    const fromNumber = ext ? undefined : digitsOf(s.smsani);
    const destination = ext || numbers.join(",");
    if (!destination || (!ext && !fromNumber)) {
      return failed(target.label || "the conversation", "That conversation has nobody to send to.");
    }
    sends.push({
      to: target.label || numbers.map((n) => formatPhone(n) || n).join(", ") || `ext ${ext}`,
      destination,
      fromNumber,
      user: (s.user ?? target.user ?? "").trim(),
      sessionId: s.session_id ?? target.sessionId,
      numbers,
    });
  } else {
    // Our number, and the extension that owns it, learned from the mailbox
    // rather than trusted from what was saved.
    const owner = sessions.find((x) => digitsOf(x.smsani) === target.fromNumber)?.user ?? "";
    if (!owner) {
      return failed("everyone", `${formatPhone(target.fromNumber) || target.fromNumber} isn't one of our SMS numbers any more.`);
    }
    const intl = target.numbers.map((n) => `1${n}`);
    const label = (n: string) => {
      const name = target.labels?.[n];
      const pretty = formatPhone(n) || n;
      return name ? `${name} (${pretty})` : pretty;
    };
    const sessionFor = (people: string[]) => {
      const key = [...people].sort().join(",");
      return sessions.find(
        (x) => digitsOf(x.smsani) === target.fromNumber &&
          [...remoteNumbersOf(x.remote)].sort().join(",") === key,
      )?.session_id ?? "";
    };
    if (target.mode === "group") {
      sends.push({
        to: target.numbers.map(label).join(", "),
        destination: intl.join(","),
        fromNumber: target.fromNumber,
        user: owner,
        sessionId: sessionFor(intl),
        numbers: intl,
      });
    } else {
      target.numbers.forEach((n, i) => {
        sends.push({
          to: label(n),
          destination: intl[i],
          fromNumber: target.fromNumber,
          user: owner,
          sessionId: sessionFor([intl[i]]),
          numbers: [intl[i]],
        });
      });
    }
  }

  // ── Check, then send (or rehearse) each one ──
  const optOut = new OptOutCheck(domain, sessions);
  const detail: RunDetail[] = [];
  let sent = 0;
  let budget = opts.budget;

  for (const s of sends) {
    const stopped = s.fromNumber ? await optOut.firstStopped(s.numbers) : null;
    if (stopped) {
      detail.push({
        to: s.to,
        ok: false,
        skipped: s.numbers.length > 1
          ? `${formatPhone(stopped) || stopped} has texted STOP, so the group wasn't sent.`
          : "They've texted STOP.",
      });
      continue;
    }
    if (opts.live && budget <= 0) {
      detail.push({ to: s.to, ok: false, skipped: "Today's limit on automated texts was reached." });
      continue;
    }
    if (!opts.live) {
      detail.push({ to: s.to, ok: true, skipped: "Checked, not sent (sending is switched off)." });
      continue;
    }

    try {
      const created = (await sendMessage({
        domain,
        user: s.user,
        destination: s.destination,
        message: action.text,
        fromNumber: s.fromNumber,
      })) as { id?: string; session_id?: string } | null;
      await recordSender({
        messageId: created?.id ?? "",
        sessionId: created?.session_id ?? s.sessionId,
        name: `${opts.byName} (scheduled)`,
        email: opts.byEmail,
      });
      sent++;
      budget--;
      detail.push({ to: s.to, ok: true, messageId: created?.id ?? "" });
    } catch (err) {
      detail.push({ to: s.to, ok: false, error: getErrorMessage(err, "The phone system refused it.") });
    }
  }

  return summarise(detail, sent, opts.live);
}

function failed(to: string, error: string): SendResult {
  return { outcome: "failed", sentCount: 0, summary: error, detail: [{ to, ok: false, error }] };
}

function summarise(detail: RunDetail[], sent: number, live: boolean): SendResult {
  const total = detail.length;
  const errors = detail.filter((d) => d.error).length;
  const rehearsed = detail.filter((d) => d.ok && !live).length;
  const skipped = detail.filter((d) => !d.ok && d.skipped).length;

  let outcome: RunOutcome;
  if (!live && rehearsed > 0) outcome = "dry_run";
  else if (sent === total) outcome = "sent";
  else if (sent > 0) outcome = "partial";
  else if (errors > 0) outcome = "failed";
  else outcome = "skipped";

  const parts: string[] = [];
  if (live) parts.push(`Sent ${sent} of ${total}`);
  else parts.push(`Sending is switched off: ${rehearsed} of ${total} checked, none sent`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (errors) parts.push(`${errors} failed`);
  return { outcome, sentCount: sent, summary: parts.join(" · "), detail };
}

/**
 * Whether someone has texted STOP, on any of our numbers.
 *
 * Read from their one-to-one conversations: the last opt-out or opt-in word
 * they sent decides. Group threads aren't consulted - a STOP sent into a
 * group is ambiguous about what it means to stop.
 */
class OptOutCheck {
  private cache = new Map<string, boolean>();
  constructor(private domain: string, private sessions: RawMessageSession[]) {}

  async firstStopped(numbers: string[]): Promise<string | null> {
    for (const n of numbers) {
      if (await this.stopped(n)) return n;
    }
    return null;
  }

  private async stopped(number: string): Promise<boolean> {
    const key = number.slice(-10);
    const known = this.cache.get(key);
    if (known !== undefined) return known;

    const theirs = this.sessions.filter((s) => {
      const people = remoteNumbersOf(s.remote);
      return people.length === 1 && people[0].slice(-10) === key;
    });
    let lastWord: { at: number; stop: boolean } | null = null;
    for (const s of theirs) {
      const rows = ((await getMessages(this.domain, s.user ?? "", s.session_id ?? "").catch(() => [])) ?? []) as RawMessage[];
      for (const raw of rows) {
        const m = normalizeMessage(raw, { owner: s.user ?? "" });
        if (m.direction !== "in") continue;
        const word = m.text.trim().toUpperCase().replace(/[^A-Z]/g, "");
        const stop = STOP_WORDS.has(word);
        if (!stop && !START_WORDS.has(word)) continue;
        if (!lastWord || m.at > lastWord.at) lastWord = { at: m.at, stop };
      }
    }
    const result = Boolean(lastWord?.stop);
    this.cache.set(key, result);
    return result;
  }
}
