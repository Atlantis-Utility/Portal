import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { coreApi, getSubscribers } from "@/lib/ringlogix";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * A call's recording, transcript and summary.
 *
 * RingLogix records every call on the domain (match pattern "*@277215")
 * and transcribes most of them itself; v1's cdr2 even names the job
 * (transcription_job_id). What v1 doesn't carry is the SIP call-id, which
 * both the recording and the transcript are filed under, so the call is
 * re-read from v2 by its CDR id (`/cdrs?id=` - the `/cdrs/{id}` path form
 * ignores the id and returns the newest call; verified 2026-11-24).
 *
 * RingLogix's own summary feature isn't switched on for this domain
 * (features: "transcription,sentiment"), so when it has none, Claude writes
 * one from the transcript - once, cached in call_summaries.
 */

export interface TranscriptLine {
  /** "Extension 102" / "Yash Harale", or the outside number. */
  speaker: string;
  /** Our side of the call, for colouring. */
  internal: boolean;
  text: string;
  /** Seconds from the start of the recording. */
  at: number;
}

export interface CallSummary {
  summary: string;
  nextSteps: string[];
  source: "ringlogix" | "claude";
}

export interface CallDetail {
  id: string;
  /** Extensions on the call, for deciding who may see it. */
  extensions: string[];
  recording: { durationSec: number } | null;
  transcript: {
    status: string;
    lines: TranscriptLine[];
    topics: string[];
    sentiment: { positive: number; neutral: number; negative: number } | null;
  } | null;
  summary: CallSummary | null;
  /** Whether a summary can be written here (a key is set and there's a transcript). */
  canSummarize: boolean;
}

interface V2Cdr {
  id: string;
  "call-orig-call-id"?: string;
  "call-term-call-id"?: string;
  "call-through-call-id"?: string | null;
  "call-intelligence-job-id"?: number | string | null;
  "call-orig-user"?: number | string | null;
  "call-term-user"?: number | string | null;
  "call-start-datetime"?: string;
  "call-batch-start-datetime"?: string;
}

interface V2Recording {
  "call-recording-status"?: string;
  "file-duration-seconds"?: number;
  "file-access-url"?: string;
}

interface V2Transcription {
  "call-intelligence-processing-status"?: string;
  "call-intelligence-segments"?: Array<{ speaker?: string; comment?: string; "start-time"?: string }>;
  "call-intelligence-summary"?: string | null;
  "call-intelligence-topics-top"?: string[] | null;
  "call-intelligence-percent-positive"?: number | null;
  "call-intelligence-percent-neutral"?: number | null;
  "call-intelligence-percent-negative"?: number | null;
}

const enc = encodeURIComponent;

async function cdrFor(domain: string, id: string): Promise<V2Cdr | null> {
  const { status, data } = await coreApi("GET", `/domains/${enc(domain)}/cdrs?id=${enc(id)}`);
  if (status !== 200 || !Array.isArray(data)) return null;
  // Belt and braces: never hand back a different call than was asked for.
  return (data as V2Cdr[]).find((c) => c.id === id) ?? null;
}

async function recordingRow(domain: string, cdr: V2Cdr): Promise<V2Recording | null> {
  for (const callId of [cdr["call-orig-call-id"], cdr["call-term-call-id"], cdr["call-through-call-id"]]) {
    if (!callId) continue;
    const { status, data } = await coreApi("GET", `/domains/${enc(domain)}/recordings/${enc(callId)}`);
    const row = status === 200 && Array.isArray(data) ? (data[0] as V2Recording | undefined) : undefined;
    if (row?.["file-access-url"]) return row;
  }
  return null;
}

/** The recording's address, for the audio proxy only (it may open without a login). */
export async function recordingUrl(domain: string, id: string): Promise<string | null> {
  const cdr = await cdrFor(domain, id);
  if (!cdr) return null;
  return (await recordingRow(domain, cdr))?.["file-access-url"] ?? null;
}

/** "00:01:08,96" -> 68.96 */
function seconds(t: string | undefined): number {
  const m = /^(\d+):(\d+):(\d+)(?:[,.](\d+))?$/.exec(t ?? "");
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4] ?? 0}`);
}

async function transcriptFor(domain: string, cdr: V2Cdr): Promise<V2Transcription | null> {
  const job = cdr["call-intelligence-job-id"];
  const orig = cdr["call-orig-call-id"];
  if (!job || !orig) return null;
  const started = cdr["call-start-datetime"] ?? cdr["call-batch-start-datetime"] ?? "";
  const month = started.slice(0, 7).replace("-", "");
  if (!/^\d{6}$/.test(month)) return null;
  const q = new URLSearchParams({ id: String(job), date: month, callid: orig, orig_callid: orig });
  if (cdr["call-term-call-id"]) q.set("term_callid", cdr["call-term-call-id"]);
  const { status, data } = await coreApi("GET", `/domains/${enc(domain)}/transcriptions?${q}`);
  return status === 200 && data && typeof data === "object" ? (data as V2Transcription) : null;
}

const db = () => createServiceRoleClient();

async function cachedSummary(id: string): Promise<CallSummary | null> {
  const { data, error } = await db().from("call_summaries").select("summary, next_steps, source").eq("cdr_id", id).maybeSingle();
  if (error || !data) return null;
  return { summary: String(data.summary), nextSteps: (data.next_steps as string[]) ?? [], source: data.source as CallSummary["source"] };
}

export const summariesEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

export async function callDetail(domain: string, id: string): Promise<CallDetail | null> {
  const cdr = await cdrFor(domain, id);
  if (!cdr) return null;
  const [rec, tx, cached, subs] = await Promise.all([
    recordingRow(domain, cdr).catch(() => null),
    transcriptFor(domain, cdr).catch(() => null),
    cachedSummary(id).catch(() => null),
    (getSubscribers(domain) as Promise<Array<{ user?: string; first_name?: string; last_name?: string }>>).catch(() => []),
  ]);
  const names = new Map((subs ?? []).map((s) => [String(s.user), `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim()]));

  const lines: TranscriptLine[] = (tx?.["call-intelligence-segments"] ?? [])
    .filter((s) => (s.comment ?? "").trim())
    .map((s) => {
      // "sip:100pt@277215" is one of ours (the device names its extension);
      // anything at another host is the far side.
      const m = /^sips?:([^@]+)@(.+)$/.exec(s.speaker ?? "");
      const user = m?.[1] ?? "";
      const internal = m?.[2] === domain;
      const ext = internal ? user.replace(/\D+$/, "").replace(/[a-z]+$/i, "") : "";
      const speaker = internal
        ? names.get(ext) || `Extension ${ext || user}`
        : user.replace(/\D/g, "").length >= 7 ? user.replace(/\D/g, "") : "Caller";
      return { speaker, internal, text: (s.comment ?? "").trim(), at: seconds(s["start-time"]) };
    });

  const pos = tx?.["call-intelligence-percent-positive"];
  const ringlogixSummary = (tx?.["call-intelligence-summary"] ?? "").trim();
  return {
    id,
    extensions: [cdr["call-orig-user"], cdr["call-term-user"]].filter((e) => e !== null && e !== undefined && e !== "").map(String),
    recording: rec ? { durationSec: Number(rec["file-duration-seconds"] ?? 0) || 0 } : null,
    transcript: tx
      ? {
          status: tx["call-intelligence-processing-status"] ?? "",
          lines,
          topics: (tx["call-intelligence-topics-top"] ?? []).filter(Boolean),
          sentiment: typeof pos === "number"
            ? { positive: pos, neutral: tx["call-intelligence-percent-neutral"] ?? 0, negative: tx["call-intelligence-percent-negative"] ?? 0 }
            : null,
        }
      : null,
    summary: ringlogixSummary ? { summary: ringlogixSummary, nextSteps: [], source: "ringlogix" } : cached,
    canSummarize: summariesEnabled() && lines.length > 0,
  };
}

/**
 * Claude's summary of a transcript, written once per call and kept.
 *
 * claude-opus-5-5 at low effort: a short, factual summary doesn't need
 * deep reasoning, and the server-side refusal fallback is on so a decline
 * is retried on another model rather than leaving the call without one.
 */
export async function summarizeCall(id: string, lines: TranscriptLine[]): Promise<CallSummary> {
  const cached = await cachedSummary(id).catch(() => null);
  if (cached) return cached;

  const transcript = lines.map((l) => `${l.speaker}${l.internal ? " (Atlantis Utility)" : ""}: ${l.text}`).join("\n");
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system:
      "You summarize business phone calls for Atlantis Utility, a VoIP and internet provider. " +
      "The transcript is machine-made and may mix languages or contain errors; write in English regardless. " +
      "Reply in exactly this shape and nothing else:\n" +
      "SUMMARY: two or three plain sentences on who called, why, and what was agreed.\n" +
      "NEXT STEPS:\n- one follow-up per line, or \"- None\" if there are none.",
    messages: [{ role: "user", content: `<transcript>\n${transcript}\n</transcript>` }],
  });
  if (response.stop_reason === "refusal") throw new Error("The summary couldn't be written for this call.");

  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const summary = /SUMMARY:\s*([\s\S]*?)(?:\n\s*NEXT STEPS:|$)/i.exec(text)?.[1]?.trim() || text;
  const stepsBlock = /NEXT STEPS:\s*([\s\S]*)$/i.exec(text)?.[1] ?? "";
  const nextSteps = stepsBlock
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l && !/^none\.?$/i.test(l));
  const result: CallSummary = { summary, nextSteps, source: "claude" };
  // Kept so each call is summarized once. Without the table (migration not
  // run yet) it still works, just written again next time.
  await db().from("call_summaries").upsert({ cdr_id: id, summary, next_steps: nextSteps, source: "claude" }, { onConflict: "cdr_id" });
  return result;
}
