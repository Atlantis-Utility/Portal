"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, FileText, RefreshCw, AlertCircle, ChevronDown } from "lucide-react";
import AudioPlayer, { type AudioPlayerHandle } from "@/components/ui/AudioPlayer";
import type { CallDetail, CallSummary } from "@/lib/call-intel";

/**
 * A call's recording, AI summary and transcript, opened from the Inbox or
 * the phone's Recents. The summary is asked for once the details arrive;
 * the server writes it once per call and keeps it.
 */

const stamp = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export default function CallDetailPanel({ id, compact = false }: { id: string; compact?: boolean }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [summaryState, setSummaryState] = useState<"idle" | "working" | "error">("idle");
  const [summaryError, setSummaryError] = useState("");
  const [showTranscript, setShowTranscript] = useState(!compact);
  const audioRef = useRef<AudioPlayerHandle | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/calls/${id}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { setError(body.error ?? body.message ?? "Couldn't load this call."); return; }
        const d = body as CallDetail;
        setDetail(d);
        if (d.summary) { setSummary(d.summary); return; }
        if (!d.canSummarize) return;
        // Written once and kept on the server, so opening it again is free.
        setSummaryState("working");
        const res = await fetch(`/api/calls/${id}/summary`, { method: "POST" });
        const sb = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) { setSummary(sb as CallSummary); setSummaryState("idle"); }
        else { setSummaryError(sb.error ?? "Couldn't write the summary."); setSummaryState("error"); }
      })
      .catch(() => { if (live) setError("Couldn't load this call."); });
    return () => { live = false; };
  }, [id]);

  const seek = (sec: number) => audioRef.current?.seek(sec);

  if (error) {
    return <p className="text-xs text-fg-subtle flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>;
  }
  if (!detail) {
    return (
      <div className="space-y-2">
        <span className="block h-10 w-full max-w-lg rounded-full bg-surface-3 animate-pulse" />
        <span className="block h-16 w-full max-w-lg rounded-lg bg-surface-3 animate-pulse" />
      </div>
    );
  }

  const tx = detail.transcript;
  const pending = tx && tx.status && tx.status !== "finished";
  const audio = `/api/calls/${id}/recording`;

  return (
    <div className={`space-y-3 ${compact ? "" : "max-w-2xl"}`}>
      {detail.recording ? (
        <AudioPlayer ref={audioRef} src={audio} durationHint={detail.recording.durationSec} download={!compact} compact={compact} />
      ) : (
        <p className="text-xs text-fg-subtle">No recording of this call.</p>
      )}

      {/* Summary */}
      {(summary || summaryState !== "idle") && (
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-violet mb-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Summary
            {summary?.source === "ringlogix" && <span className="font-normal normal-case tracking-normal text-fg-subtle">· from RingLogix</span>}
          </p>
          {summaryState === "working" && (
            <p className="text-xs text-fg-subtle flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Writing a summary from the transcript…</p>
          )}
          {summaryState === "error" && <p className="text-xs text-fg-subtle">{summaryError}</p>}
          {summary && (
            <>
              <p className="text-[13px] leading-relaxed text-fg">{summary.summary}</p>
              {summary.nextSteps.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-fg-muted mt-2.5 mb-1">Next steps</p>
                  <ul className="space-y-1">
                    {summary.nextSteps.map((s, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-fg">
                        <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[#7c3aed] shrink-0" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Topics and sentiment, when RingLogix worked them out */}
      {tx && (tx.topics.length > 0 || tx.sentiment) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tx.topics.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-3 text-fg-muted">{t}</span>)}
          {tx.sentiment && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-tint-green text-ink-green">
              {Math.round(tx.sentiment.positive)}% positive
            </span>
          )}
        </div>
      )}

      {/* Transcript */}
      {pending ? (
        <p className="text-xs text-fg-subtle flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> The transcript is still being prepared.</p>
      ) : tx && tx.lines.length > 0 ? (
        <div>
          <button type="button" onClick={() => setShowTranscript((v) => !v)} className="flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg">
            <FileText className="w-3.5 h-3.5" /> Transcript · {tx.lines.length} lines
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTranscript ? "rotate-180" : ""}`} />
          </button>
          {showTranscript && (
            <ol className={`mt-2 space-y-2 overflow-y-auto pr-1 ${compact ? "max-h-56" : "max-h-80"}`}>
              {tx.lines.map((l, i) => (
                <li key={i} className={`flex gap-2.5 ${l.internal ? "" : "flex-row-reverse text-right"}`}>
                  <button
                    type="button"
                    onClick={() => seek(l.at)}
                    disabled={!detail.recording}
                    className="shrink-0 mt-0.5 text-[10.5px] tabular-nums text-fg-subtle hover:text-[#0070f3] disabled:hover:text-fg-subtle"
                    title="Play from here"
                  >
                    {stamp(l.at)}
                  </button>
                  <div className={`min-w-0 max-w-[85%] rounded-xl px-3 py-1.5 ${l.internal ? "bg-tint-blue" : "bg-surface-3"}`}>
                    <p className={`text-[10.5px] font-semibold ${l.internal ? "text-ink-blue" : "text-fg-muted"}`}>{l.speaker}</p>
                    <p className="text-[13px] text-fg leading-snug">{l.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">No transcript for this call.</p>
      )}
    </div>
  );
}
