import "server-only";
import { getCallHistory, getSubscribers, getUcConversations, RingLogixError } from "./ringlogix";
import { digitsOf, parseTimestamp } from "./ringlogix-messages";

/**
 * The Inbox: voicemails and calls, beside the texts Messages already has.
 *
 * Voicemails come from RingLogix's UC Inbox (`conversation/read`), which is
 * per extension and refuses `user=*`; calls come from call history
 * (`cdr2/read`), which UC Inbox documents but never returns here.
 *
 * Voicemail times are UTC without a marker, like messages - despite each
 * row saying `TimeZone: US/Pacific`. Checked against the call record of the
 * same voicemail (2026-11-23): it began 25 s before the stored time, in UTC.
 */

export interface Voicemail {
  /** RingLogix's index, "vm-2026…"; unique within the extension. */
  id: string;
  /** The extension whose box it's in. */
  user: string;
  at: number;
  durationSec: number;
  fromName: string;
  /** A caller from outside: their number, digits only. */
  fromNumber: string;
  /** A colleague: their extension. */
  fromExtension: string;
  transcription: string;
}

export interface CallRecord {
  id: string;
  at: number;
  direction: "in" | "out" | "internal";
  /** Answered by a person (or the auto attendant), not sent to voicemail. */
  answered: boolean;
  voicemail: boolean;
  talkSec: number;
  fromName: string;
  fromNumber: string;
  fromExtension: string;
  /** Who was dialled: a number for outgoing calls, our number for incoming. */
  toNumber: string;
  /** Our extension on the call, when there was one. */
  toExtension: string;
  /** RingLogix transcribed it (so it was recorded): details at /api/calls/[id]. */
  transcribed: boolean;
}

/** A raw UC Inbox voicemail row; only what's read here. */
interface RawVoicemail {
  conversation_type?: string;
  index?: string;
  filedate?: string;
  NmsRecDuration?: string;
  length?: number | string;
  FromName?: string;
  FromUser?: string;
  FromHost?: string;
  NmsAni?: string;
  transcription?: string;
  remotepath?: string;
}

const CONCURRENCY = 3; // more than this and RingLogix answers 429

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      const limited = err instanceof RingLogixError && err.status === 429;
      if (!limited || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
    }
  }
}

async function pooled<T, R>(items: T[], work: (item: T) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out.push(...(await work(items[i])));
      } catch {
        // One extension refusing doesn't empty everyone else's voicemail.
      }
    }
  }));
  return out;
}

/** Every extension's box, read three at a time. */
async function rawVoicemails(domain: string): Promise<Array<RawVoicemail & { user: string }>> {
  const subscribers = ((await getSubscribers(domain)) ?? []) as Array<{ user?: string }>;
  // "api" is the integration's own login; it has no mailbox.
  const users = [...new Set(subscribers.map((s) => s.user ?? "").filter((u) => u && u !== "api"))];
  return pooled(users, async (user) => {
    const rows = ((await withRetry(() => getUcConversations(domain, user))) ?? []) as RawVoicemail[];
    return rows.filter((r) => r.conversation_type === "vmail" && r.index).map((r) => ({ ...r, user }));
  });
}

function toVoicemail(r: RawVoicemail & { user: string }, domain: string): Voicemail {
  const internal = (r.FromHost ?? "") === domain;
  return {
    id: r.index ?? "",
    user: r.user,
    at: parseTimestamp(r.filedate),
    durationSec: Number(r.NmsRecDuration ?? r.length ?? 0) || 0,
    fromName: (r.FromName ?? "").trim(),
    fromNumber: internal ? "" : digitsOf(r.NmsAni || r.FromUser),
    fromExtension: internal ? (r.FromUser ?? "") : "",
    transcription: (r.transcription ?? "").trim(),
  };
}

export async function loadVoicemails(domain: string): Promise<Voicemail[]> {
  const rows = await rawVoicemails(domain);
  return rows.map((r) => toVoicemail(r, domain)).sort((a, b) => b.at - a.at);
}

/** One extension's box: one request, for the portal phone. */
export async function loadVoicemailsFor(domain: string, user: string): Promise<Voicemail[]> {
  const rows = ((await withRetry(() => getUcConversations(domain, user))) ?? []) as RawVoicemail[];
  return rows
    .filter((r) => r.conversation_type === "vmail" && r.index)
    .map((r) => toVoicemail({ ...r, user }, domain))
    .sort((a, b) => b.at - a.at);
}

/** Whether a call involved this extension, whichever way it went. */
export function callInvolves(c: CallRecord, extension: string): boolean {
  return c.fromExtension === extension || c.toExtension === extension;
}

/**
 * The recording's address, for the audio proxy only. It works without any
 * login at all, so it never goes to the browser.
 */
export async function voicemailAudioUrl(domain: string, user: string, id: string): Promise<string | null> {
  const rows = ((await withRetry(() => getUcConversations(domain, user))) ?? []) as RawVoicemail[];
  const row = rows.find((r) => r.conversation_type === "vmail" && r.index === id);
  return row?.remotepath ? row.remotepath.replace(/&amp;/g, "&") : null;
}

// ── Calls ───────────────────────────────────────────────────────────────

interface RawCall {
  cdr_id?: string;
  type?: string | number;
  hide?: string | number;
  orig_sub?: string | null;
  orig_from_uri?: string | null;
  orig_from_name?: string | null;
  orig_to_user?: string | null;
  term_sub?: string | null;
  term_to_uri?: string | null;
  time_start?: string | number;
  time_answer?: string | number | null;
  time_talking?: string | number | null;
  transcription_job_id?: string | number | null;
}

/** "sip:18055551234@192.92.8.30" -> "18055551234". */
function uriUser(uri: string | null | undefined): string {
  return (uri ?? "").replace(/^sips?:/, "").split("@")[0] ?? "";
}

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function toCall(r: RawCall): CallRecord | null {
  const at = Number(r.time_start ?? 0) * 1000;
  if (!at || String(r.hide ?? "0") === "1") return null;
  const type = String(r.type ?? "");
  const direction = type === "0" ? "out" : type === "1" ? "in" : "internal";
  const voicemail = /vmail/i.test(r.term_to_uri ?? "");
  const answered = Number(r.time_answer ?? 0) > 0 && !voicemail;
  const fromUser = uriUser(r.orig_from_uri);
  return {
    id: r.cdr_id ?? `${at}-${fromUser}`,
    at,
    direction,
    answered,
    voicemail,
    talkSec: Number(r.time_talking ?? 0) || 0,
    fromName: (r.orig_from_name ?? "").trim(),
    fromNumber: direction === "in" ? digitsOf(fromUser) : "",
    fromExtension: direction === "in" ? "" : (r.orig_sub ?? "").trim(),
    toNumber: direction === "internal" ? "" : digitsOf(r.orig_to_user ?? ""),
    toExtension: direction === "out" ? "" : (r.term_sub ?? r.orig_to_user ?? "").trim(),
    transcribed: Boolean(r.transcription_job_id),
  };
}

/**
 * The last `days` of calls. The window runs whole days in UTC so the cache
 * key (and RingLogix's answer) holds still between polls.
 */
export async function loadCalls(domain: string, days = 7): Promise<CallRecord[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = utc(today.getTime() - (days - 1) * 86_400_000);
  const end = utc(today.getTime() + 86_400_000 - 1000);
  const rows = ((await withRetry(() => getCallHistory(domain, start, end))) ?? []) as RawCall[];
  return rows.map(toCall).filter((c): c is CallRecord => Boolean(c)).sort((a, b) => b.at - a.at);
}
