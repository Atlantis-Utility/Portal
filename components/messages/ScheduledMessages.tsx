"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock, X, Plus, Pause, Play, Ban, Trash2, Pencil, RefreshCw, ChevronDown, ChevronRight,
  Users, MessageSquare, FlaskConical, AlertCircle,
} from "lucide-react";
import Overlay from "@/components/ui/Overlay";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { formatPhone } from "@/lib/utils";
import {
  REPEAT_LABELS, MAX_TEXT_LENGTH, MAX_GROUP,
  type Repeat, type SmsTarget, type Workflow, type WorkflowRun,
} from "@/lib/workflows/types";
import { fromLocalInput, showTime, toLocalInput, upcomingRuns } from "@/lib/workflows/schedule";
import { checkScheduledSms, tenDigits } from "@/lib/workflows/validate";

export interface ScheduleConversation {
  sessionId: string;
  user: string;
  label: string;
  isGroup: boolean;
}

export interface SchedulePrefill {
  sessionId: string;
  user: string;
  label: string;
  text: string;
}

interface Props {
  conversations: ScheduleConversation[];
  /** The contact book: ten-digit number -> name. */
  contacts: Array<{ number: string; name: string }>;
  senders: Array<{ number: string; user: string }>;
  /** Opened from a conversation: start a new schedule aimed at it. */
  prefill?: SchedulePrefill | null;
  /** The pop-up's close. Not needed when shown as a page. */
  onClose?: () => void;
  /** Shown as a page (the Workflows tab) rather than a pop-up over Messages. */
  inline?: boolean;
}

type View = { mode: "list" } | { mode: "edit"; workflow: Workflow | null };

/**
 * Scheduled texts: the list, and the editor for one.
 *
 * Everything goes through /api/workflows, which checks the "Schedule
 * messages" grant; this component only decides what to show.
 */
export default function ScheduledMessages({ conversations, contacts, senders, prefill, onClose, inline = false }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>(() => (prefill ? { mode: "edit", workflow: null } : { mode: "list" }));
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/workflows");
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? "Couldn't load scheduled messages");
        setWorkflows(data.workflows ?? []);
        setLive(Boolean(data.live));
        setError("");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't load scheduled messages");
      }
    })();
    return () => { alive = false; };
  }, [version]);

  const reload = () => setVersion((v) => v + 1);

  async function act(flow: Workflow, what: "pause" | "resume" | "cancel" | "delete") {
    if (what === "cancel" || what === "delete") {
      const ok = await confirm({
        title: what === "cancel" ? "Cancel this schedule?" : "Delete this schedule?",
        description: what === "cancel"
          ? "Nothing more will be sent from it. Its history is kept."
          : "It and its history are removed for good.",
        confirmLabel: what === "cancel" ? "Cancel schedule" : "Delete",
      });
      if (!ok) return;
    }
    setBusy(flow.id);
    try {
      const res = what === "delete"
        ? await fetch(`/api/workflows/${flow.id}`, { method: "DELETE" })
        : await fetch(`/api/workflows/${flow.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ do: what }),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work");
      toast.success(
        what === "pause" ? "Paused." : what === "resume" ? "Resumed." : what === "cancel" ? "Canceled." : "Deleted.",
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  }

  const frame = (children: React.ReactNode) =>
    inline ? (
      <div className="bg-white border border-[#eaeaea] rounded-xl flex flex-col overflow-hidden min-h-[60vh]">{children}</div>
    ) : (
      <Overlay
        onDismiss={onClose ?? (() => {})}
        className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3 md:p-6"
      >
        <div className="bg-white border border-[#eaeaea] rounded-2xl shadow-xl w-full max-w-3xl h-[88vh] flex flex-col overflow-hidden">
          {children}
        </div>
      </Overlay>
    );

  return frame(
    <>
        <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#eaeaea] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <CalendarClock className="w-4.5 h-4.5 text-[#0070f3] shrink-0" />
            <p className="text-sm font-semibold text-[#0a0a0a] truncate">
              {view.mode === "list" ? "Scheduled messages" : view.workflow ? "Edit scheduled message" : "New scheduled message"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {view.mode === "list" && (
              <button
                onClick={() => setView({ mode: "edit", workflow: null })}
                className="flex items-center gap-1.5 bg-[#0070f3] text-white text-xs font-medium rounded-lg px-3 h-8 hover:bg-[#0060df] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            )}
            {!inline && onClose && (
              <button
                onClick={onClose}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-[#666] hover:bg-[#fafafa] transition-colors"
                data-tip="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {!live && workflows !== null && (
          <div className="flex items-start gap-2 px-5 py-2.5 bg-[#fefce8] border-b border-[#eaeaea] shrink-0">
            <FlaskConical className="w-3.5 h-3.5 text-[#a16207] mt-0.5 shrink-0" />
            <p className="text-[11px] text-[#a16207] leading-relaxed">
              <strong>Test mode.</strong> Schedules run and record exactly who they would text, but nothing is
              sent. Sending is switched on by an administrator in the deployment&apos;s settings.
            </p>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {view.mode === "edit" ? (
            <Editor
              key={view.workflow?.id ?? "new"}
              workflow={view.workflow}
              prefill={view.workflow ? null : prefill ?? null}
              conversations={conversations}
              contacts={contacts}
              senders={senders}
              live={live}
              onCancel={() => setView({ mode: "list" })}
              onSaved={() => { setView({ mode: "list" }); reload(); }}
            />
          ) : error ? (
            <div className="p-10 text-center">
              <AlertCircle className="w-6 h-6 text-[#f31260] mx-auto mb-3" />
              <p className="text-sm text-[#0a0a0a] mb-1">Couldn&apos;t load scheduled messages</p>
              <p className="text-xs text-[#999] max-w-md mx-auto">{error}</p>
              <button onClick={reload} className="mt-3 text-xs text-[#0070f3] hover:underline">Retry</button>
            </div>
          ) : workflows === null ? (
            <div className="p-10 text-center">
              <RefreshCw className="w-5 h-5 animate-spin text-[#999] mx-auto" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="p-12 text-center">
              <CalendarClock className="w-7 h-7 text-[#bbb] mx-auto mb-3" />
              <p className="text-sm font-medium text-[#0a0a0a] mb-1">Nothing scheduled</p>
              <p className="text-xs text-[#999] max-w-sm mx-auto">
                Set up a text to go out later, or on a repeat: reminders, notices, follow-ups.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#eaeaea]">
              {workflows.map((w) => (
                <Item
                  key={w.id}
                  flow={w}
                  busy={busy === w.id}
                  onEdit={() => setView({ mode: "edit", workflow: w })}
                  onAct={(what) => act(w, what)}
                />
              ))}
            </ul>
          )}
        </div>
    </>,
  );
}

// ── One row in the list ──────────────────────────────────────────────────

const STATUS_STYLE: Record<Workflow["status"], string> = {
  active: "bg-[#eff6ff] text-[#0070f3]",
  paused: "bg-[#fefce8] text-[#a16207]",
  completed: "bg-[#f0fdf4] text-[#15803d]",
  canceled: "bg-[#f5f5f5] text-[#666]",
};

const OUTCOME_STYLE: Record<WorkflowRun["outcome"], string> = {
  sent: "text-[#15803d]",
  dry_run: "text-[#a16207]",
  partial: "text-[#a16207]",
  failed: "text-[#b91c1c]",
  skipped: "text-[#666]",
  missed: "text-[#b91c1c]",
};

const OUTCOME_LABEL: Record<WorkflowRun["outcome"], string> = {
  sent: "Sent",
  dry_run: "Test run",
  partial: "Partly sent",
  failed: "Failed",
  skipped: "Skipped",
  missed: "Missed",
};

function describeTarget(t: SmsTarget): string {
  if (t.kind === "thread") return t.label || "A conversation";
  const names = t.numbers.map((n) => t.labels?.[n] || formatPhone(n) || n);
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  return t.mode === "group" ? `Group: ${shown}` : shown;
}

function Item({
  flow, busy, onEdit, onAct,
}: {
  flow: Workflow;
  busy: boolean;
  onEdit: () => void;
  onAct: (what: "pause" | "resume" | "cancel" | "delete") => void;
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && runs === null) {
      try {
        const res = await fetch(`/api/workflows/${flow.id}`);
        const data = await res.json();
        setRuns(res.ok ? data.runs ?? [] : []);
      } catch {
        setRuns([]);
      }
    }
  }

  const done = flow.status === "completed" || flow.status === "canceled";
  const btn = "flex items-center justify-center w-8 h-8 rounded-lg text-[#666] hover:bg-[#fafafa] hover:text-[#0a0a0a] transition-colors disabled:opacity-40";

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <button onClick={toggle} className="mt-0.5 text-[#999] hover:text-[#0a0a0a]" data-tip="History">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-[#0a0a0a] truncate">
              {flow.name || flow.action.text.slice(0, 60)}
            </p>
            <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 capitalize ${STATUS_STYLE[flow.status]}`}>
              {flow.status}
            </span>
          </div>
          <p className="text-xs text-[#666] mt-0.5 truncate">To {describeTarget(flow.action.target)}</p>
          <p className="text-[11px] text-[#999] mt-0.5">
            {REPEAT_LABELS[flow.trigger.repeat]}
            {flow.trigger.until ? ` until ${flow.trigger.until}` : ""}
            {flow.status === "active" && flow.nextRunAt ? ` · next ${showTime(flow.nextRunAt)}` : ""}
            {flow.lastRun && (
              <>
                {" · last: "}
                <span className={OUTCOME_STYLE[flow.lastRun.outcome]}>{OUTCOME_LABEL[flow.lastRun.outcome]}</span>
                {" "}{showTime(flow.lastRun.startedAt)}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center shrink-0">
          {!done && <button onClick={onEdit} disabled={busy} className={btn} data-tip="Edit"><Pencil className="w-3.5 h-3.5" /></button>}
          {flow.status === "active" && (
            <button onClick={() => onAct("pause")} disabled={busy} className={btn} data-tip="Pause"><Pause className="w-3.5 h-3.5" /></button>
          )}
          {flow.status === "paused" && (
            <button onClick={() => onAct("resume")} disabled={busy} className={btn} data-tip="Resume"><Play className="w-3.5 h-3.5" /></button>
          )}
          {!done && (
            <button onClick={() => onAct("cancel")} disabled={busy} className={btn} data-tip="Cancel schedule"><Ban className="w-3.5 h-3.5" /></button>
          )}
          {done && (
            <button onClick={() => onAct("delete")} disabled={busy} className={btn} data-tip="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>

      {open && (
        <div className="ml-7 mt-3 space-y-3">
          <p className="text-xs text-[#444] whitespace-pre-wrap bg-[#fafafa] border border-[#eaeaea] rounded-lg px-3 py-2">
            {flow.action.text}
          </p>
          <p className="text-[10px] text-[#bbb]">Set up by {flow.createdByName || flow.createdByEmail} · {showTime(flow.createdAt)}</p>
          {runs === null ? (
            <RefreshCw className="w-4 h-4 animate-spin text-[#999]" />
          ) : runs.length === 0 ? (
            <p className="text-[11px] text-[#999]">It hasn&apos;t run yet.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id} className="text-[11px]">
                  <p>
                    <span className={`font-medium ${OUTCOME_STYLE[r.outcome]}`}>{OUTCOME_LABEL[r.outcome]}</span>
                    <span className="text-[#999]"> · {showTime(r.startedAt)} · {r.summary}</span>
                  </p>
                  {r.detail.length > 0 && (
                    <ul className="mt-1 ml-3 space-y-0.5">
                      {r.detail.map((d, i) => (
                        <li key={i} className="text-[#666]">
                          {d.to}
                          <span className={d.error ? "text-[#b91c1c]" : "text-[#999]"}>
                            {" — "}{d.error ?? d.skipped ?? (d.ok ? "sent" : "")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ── The editor ───────────────────────────────────────────────────────────

/** An hour from now, on the next quarter hour. */
function defaultWhen(): number {
  const t = Date.now() + 60 * 60 * 1000;
  return Math.ceil(t / (15 * 60 * 1000)) * 15 * 60 * 1000;
}

function Editor({
  workflow, prefill, conversations, contacts, senders, live, onCancel, onSaved,
}: {
  workflow: Workflow | null;
  prefill: SchedulePrefill | null;
  conversations: ScheduleConversation[];
  contacts: Array<{ number: string; name: string }>;
  senders: Array<{ number: string; user: string }>;
  live: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const target = workflow?.action.target;

  const [name, setName] = useState(workflow?.name ?? "");
  const [text, setText] = useState(workflow?.action.text ?? prefill?.text ?? "");
  const [kind, setKind] = useState<"thread" | "numbers">(
    target?.kind ?? (prefill ? "thread" : "numbers"),
  );
  const [sessionId, setSessionId] = useState(
    target?.kind === "thread" ? target.sessionId : prefill?.sessionId ?? "",
  );
  const [people, setPeople] = useState<Array<{ number: string; name: string }>>(() =>
    target?.kind === "numbers"
      ? target.numbers.map((n) => ({ number: n, name: target.labels?.[n] ?? "" }))
      : [],
  );
  const [mode, setMode] = useState<"individual" | "group">(target?.kind === "numbers" ? target.mode : "individual");
  const [fromNumber, setFromNumber] = useState(
    target?.kind === "numbers" ? target.fromNumber : senders[0]?.number ?? "",
  );
  const [when, setWhen] = useState(() =>
    toLocalInput(workflow ? Date.parse(workflow.nextRunAt ?? workflow.trigger.at) : defaultWhen()),
  );
  const [repeat, setRepeat] = useState<Repeat>(workflow?.trigger.repeat ?? "none");
  const [until, setUntil] = useState(workflow?.trigger.until ?? "");
  const [query, setQuery] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const [saving, setSaving] = useState(false);
  // "Now", for checking the time isn't past and previewing runs. Held in
  // state and refreshed every half minute: reading the clock during render
  // would make the render impure.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const conversation = conversations.find((c) => c.sessionId === sessionId);
  // A conversation opened from the thread may not be in the list we were
  // given (filtered out, say); keep its label rather than showing nothing.
  const threadLabel =
    conversation?.label ||
    (prefill?.sessionId === sessionId ? prefill.label : "") ||
    (target?.kind === "thread" && target.sessionId === sessionId ? target.label : "");

  const atMs = fromLocalInput(when);
  const payload = {
    name,
    trigger: {
      at: atMs ? new Date(atMs).toISOString() : "",
      repeat,
      ...(repeat !== "none" && until ? { until } : {}),
    },
    action: {
      text,
      target: kind === "thread"
        ? {
            kind: "thread",
            sessionId,
            user: conversation?.user ?? (target?.kind === "thread" ? target.user : prefill?.user ?? ""),
            label: threadLabel || "",
          }
        : {
            kind: "numbers",
            numbers: people.map((p) => p.number),
            fromNumber,
            mode,
            labels: Object.fromEntries(people.filter((p) => p.name).map((p) => [p.number, p.name])),
          },
    },
  };
  const checked = checkScheduledSms(payload, now);
  const preview = checked.ok ? upcomingRuns(checked.trigger, now, 3) : [];

  const typedNumber = tenDigits(query);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    return contacts
      .filter((c) => !people.some((p) => p.number === c.number))
      .filter((c) => (digits.length >= 2 ? c.number.includes(digits) : c.name.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [query, contacts, people]);

  const threadMatches = useMemo(() => {
    const q = threadQuery.trim().toLowerCase();
    const list = q ? conversations.filter((c) => c.label.toLowerCase().includes(q)) : conversations;
    return list.slice(0, 50);
  }, [threadQuery, conversations]);

  function addPerson(number: string, personName: string) {
    const n = tenDigits(number);
    if (!n || people.some((p) => p.number === n)) return;
    setPeople((prev) => [...prev, { number: n, name: personName }]);
    setQuery("");
  }

  async function save() {
    if (!checked.ok || saving) {
      if (!checked.ok) toast.error(checked.error);
      return;
    }
    const count = kind === "thread" ? 1 : people.length;
    const who = kind === "thread" ? threadLabel || "this conversation" : `${count} ${count === 1 ? "person" : "people"}`;
    const ok = await confirm({
      title: workflow ? "Save changes?" : "Schedule this text?",
      description:
        `It goes to ${who}, first at ${showTime(checked.firstRunAt)}` +
        `${repeat !== "none" ? `, then ${REPEAT_LABELS[repeat].toLowerCase()}` : ""}. ` +
        (live
          ? "Sending is live: these are real texts to real people, sent without anyone pressing send."
          : "Sending is in test mode: it will run and record who it would text, but send nothing."),
      confirmLabel: workflow ? "Save" : "Schedule",
    });
    if (!ok) return;

    setSaving(true);
    try {
      const res = await fetch(workflow ? `/api/workflows/${workflow.id}` : "/api/workflows", {
        method: workflow ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflow ? { do: "edit", ...payload } : payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that");
      toast.success(workflow ? "Saved." : `Scheduled for ${showTime(checked.firstRunAt)}.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full text-sm bg-[#fafafa] border border-[#eaeaea] rounded-lg px-3 py-2 outline-none focus:border-[#0070f3] focus:bg-white transition-colors";
  const label = "block text-[11px] font-medium text-[#666] mb-1.5";
  const tab = (on: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
      on ? "bg-white text-[#0a0a0a] shadow-sm" : "text-[#666] hover:text-[#0a0a0a]"
    }`;

  return (
    <div className="p-5 space-y-5">
      <div>
        <label className={label}>Name <span className="text-[#bbb] font-normal">optional, for the list</span></label>
        <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Monthly billing reminder" />
      </div>

      {/* ── Who ── */}
      <div>
        <label className={label}>Send to</label>
        <div className="flex gap-1 bg-[#f5f5f5] rounded-lg p-1 mb-3">
          <button type="button" className={tab(kind === "thread")} onClick={() => setKind("thread")}>
            <MessageSquare className="w-3.5 h-3.5" /> A conversation
          </button>
          <button type="button" className={tab(kind === "numbers")} onClick={() => setKind("numbers")}>
            <Users className="w-3.5 h-3.5" /> Contacts or numbers
          </button>
        </div>

        {kind === "thread" ? (
          <div className="space-y-2">
            {sessionId && (
              <p className="text-xs text-[#15803d]">Selected: {threadLabel || "a conversation"}</p>
            )}
            <input className={field} value={threadQuery} onChange={(e) => setThreadQuery(e.target.value)} placeholder="Find a conversation or group…" />
            <ul className="max-h-48 overflow-y-auto border border-[#eaeaea] rounded-lg divide-y divide-[#eaeaea]">
              {threadMatches.map((c) => (
                <li key={c.sessionId}>
                  <button
                    type="button"
                    onClick={() => setSessionId(c.sessionId)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      c.sessionId === sessionId ? "bg-[#eff6ff] text-[#0070f3]" : "text-[#0a0a0a] hover:bg-[#fafafa]"
                    }`}
                  >
                    {c.label}
                    {c.isGroup && <span className="text-[10px] text-[#999] ml-1.5">group</span>}
                  </button>
                </li>
              ))}
              {threadMatches.length === 0 && <li className="px-3 py-2 text-xs text-[#999]">No conversation matches.</li>}
            </ul>
            <p className="text-[10px] text-[#bbb]">Sent into that conversation from the number it already uses, like a reply.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {people.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => (
                  <span key={p.number} className="inline-flex items-center gap-1 text-xs bg-[#eff6ff] text-[#0070f3] rounded-md pl-2 pr-1 py-1">
                    {p.name ? `${p.name} · ` : ""}{formatPhone(p.number) || p.number}
                    <button
                      type="button"
                      onClick={() => setPeople((prev) => prev.filter((x) => x.number !== p.number))}
                      className="rounded p-0.5 hover:bg-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                className={field}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (matches[0]) addPerson(matches[0].number, matches[0].name);
                    else if (typedNumber) addPerson(typedNumber, "");
                  }
                }}
                placeholder="Contact name, or a ten-digit number"
              />
              {(matches.length > 0 || typedNumber) && (
                <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[#eaeaea] rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                  {matches.map((c) => (
                    <li key={c.number}>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); addPerson(c.number, c.name); }}
                        className="w-full text-left px-3 py-2 hover:bg-[#fafafa] transition-colors"
                      >
                        <span className="block text-sm text-[#0a0a0a]">{c.name}</span>
                        <span className="block text-[11px] text-[#999] tabular-nums">{formatPhone(c.number) || c.number}</span>
                      </button>
                    </li>
                  ))}
                  {typedNumber && !people.some((p) => p.number === typedNumber) && (
                    <li>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); addPerson(typedNumber, ""); }}
                        className="w-full text-left px-3 py-2 hover:bg-[#fafafa] transition-colors text-sm text-[#0070f3]"
                      >
                        Add {formatPhone(typedNumber) || typedNumber}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>

            {people.length > 1 && (
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-xs text-[#0a0a0a] cursor-pointer">
                  <input type="radio" checked={mode === "individual"} onChange={() => setMode("individual")} className="mt-0.5" />
                  <span>Each person on their own <span className="text-[#999]">— nobody sees who else got it</span></span>
                </label>
                <label className="flex items-start gap-2 text-xs text-[#0a0a0a] cursor-pointer">
                  <input type="radio" checked={mode === "group"} onChange={() => setMode("group")} className="mt-0.5" />
                  <span>One group text <span className="text-[#999]">— everyone sees everyone&apos;s replies (up to {MAX_GROUP})</span></span>
                </label>
              </div>
            )}

            <div>
              <label className={label}>From</label>
              <select className={field} value={fromNumber} onChange={(e) => setFromNumber(e.target.value)}>
                {senders.map((s) => (
                  <option key={s.number} value={s.number}>{formatPhone(s.number) || s.number} · ext {s.user}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ── What ── */}
      <div>
        <label className={label}>Message</label>
        <textarea className={`${field} resize-none`} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the text…" />
        <p className={`text-[10px] mt-1 ${text.length > MAX_TEXT_LENGTH ? "text-[#b91c1c]" : "text-[#bbb]"}`}>
          {text.length} / {MAX_TEXT_LENGTH}
        </p>
      </div>

      {/* ── When ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>{repeat === "none" ? "Send at" : "Starting"} <span className="text-[#bbb] font-normal">Pacific time</span></label>
          <input type="datetime-local" className={field} value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div>
          <label className={label}>Repeat</label>
          <select className={field} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => (
              <option key={r} value={r}>{REPEAT_LABELS[r]}</option>
            ))}
          </select>
        </div>
        {repeat !== "none" && (
          <div>
            <label className={label}>Until <span className="text-[#bbb] font-normal">optional, last day</span></label>
            <input type="date" className={field} value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        )}
      </div>

      <div className="rounded-lg bg-[#fafafa] border border-[#eaeaea] px-3 py-2.5">
        {checked.ok ? (
          <p className="text-xs text-[#444]">
            <span className="font-medium text-[#0a0a0a]">Runs: </span>
            {preview.map(showTime).join(" · ")}
            {repeat !== "none" && preview.length === 3 ? " · …" : ""}
          </p>
        ) : (
          <p className="text-xs text-[#999]">{checked.error}</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="text-sm font-medium text-[#666] px-4 h-9 rounded-lg hover:bg-[#fafafa] transition-colors">
          Back
        </button>
        <button
          onClick={save}
          disabled={!checked.ok || saving}
          className="flex items-center gap-2 bg-[#0070f3] text-white text-sm font-medium px-4 h-9 rounded-lg hover:bg-[#0060df] transition-colors disabled:opacity-40"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
          {workflow ? "Save" : "Schedule"}
        </button>
      </div>
    </div>
  );
}
