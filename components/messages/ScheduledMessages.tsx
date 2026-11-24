"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Select from "@/components/ui/Select";
import {
  CalendarClock, X, Plus, Pause, Play, Ban, Trash2, Pencil, RefreshCw, ChevronDown, ChevronRight,
  Users, MessageSquare, AlertCircle, Search, MoreHorizontal, ArrowLeft, Repeat as RepeatIcon,
  CheckCircle2, Clock, Zap, FileText, Send, LayoutTemplate,
} from "lucide-react";
import Overlay from "@/components/ui/Overlay";
import FloatingLayer from "@/components/ui/FloatingLayer";
import DateTimePicker from "@/components/ui/DateTimePicker";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import { formatPhone } from "@/lib/utils";
import {
  REPEAT_LABELS, MAX_TEXT_LENGTH, MAX_GROUP,
  type Repeat, type SmsTarget, type Workflow, type WorkflowRun, type WorkflowStatus,
} from "@/lib/workflows/types";
import { fromLocalInput, showTime, toLocalInput, upcomingRuns } from "@/lib/workflows/schedule";
import { checkScheduledSms, tenDigits } from "@/lib/workflows/validate";
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template, type TemplateCategory } from "@/lib/workflows/templates";

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

type View = { mode: "list" } | { mode: "templates" } | { mode: "edit"; workflow: Workflow | null; template?: Template | null };
type Filter = "all" | WorkflowStatus;

const STATUS: Record<WorkflowStatus, { label: string; dot: string; text: string }> = {
  active:    { label: "Active",    dot: "bg-ink-green",  text: "text-ink-green" },
  paused:    { label: "Paused",    dot: "bg-ink-amber",  text: "text-ink-amber" },
  completed: { label: "Completed", dot: "bg-fg-subtle",  text: "text-fg-muted" },
  canceled:  { label: "Canceled",  dot: "bg-line-strong", text: "text-fg-subtle" },
};

const OUTCOME: Record<WorkflowRun["outcome"], { label: string; text: string; dot: string }> = {
  sent:    { label: "Sent",        text: "text-ink-green", dot: "bg-ink-green" },
  dry_run: { label: "Not sent",    text: "text-ink-amber", dot: "bg-ink-amber" },
  partial: { label: "Partly sent", text: "text-ink-amber", dot: "bg-ink-amber" },
  failed:  { label: "Failed",      text: "text-ink-rose",  dot: "bg-ink-rose" },
  skipped: { label: "Skipped",     text: "text-fg-muted",  dot: "bg-fg-subtle" },
  missed:  { label: "Missed",      text: "text-ink-rose",  dot: "bg-ink-rose" },
};

/**
 * Scheduled texts - the first kind of workflow: the list, and the editor.
 *
 * Everything goes through /api/workflows, which checks the "Schedule
 * messages" grant; this component only decides what to show. Used as the
 * Workflows page (inline) and as a pop-up over Messages.
 */
export default function ScheduledMessages({ conversations, contacts, senders, prefill, onClose, inline = false }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>(() => (prefill ? { mode: "edit", workflow: null } : { mode: "list" }));
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const loadedOnce = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/workflows");
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? "Couldn't load workflows");
        setWorkflows(data.workflows ?? []);
        setError("");
        loadedOnce.current = true;
      } catch (e) {
        // A background refresh that fails keeps the list it has; only a
        // first load that fails has nothing better to show than the error.
        if (alive && !loadedOnce.current) setError(e instanceof Error ? e.message : "Couldn't load workflows");
      }
    })();
    return () => { alive = false; };
  }, [version]);

  const reload = () => setVersion((v) => v + 1);

  // Live: the workflow tables are closed to the browser (the server reads
  // them for it), so Supabase's realtime feed can't reach this page. It
  // asks again every ten seconds while being looked at instead, and the
  // moment the tab is looked at again.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") setVersion((v) => v + 1); };
    const timer = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);

  async function act(flow: Workflow, what: "pause" | "resume" | "cancel" | "delete" | "run_now") {
    if (what === "run_now") {
      const ok = await confirm({
        title: `Run “${flow.name || "this workflow"}” now?`,
        description: `This texts ${describeTarget(flow.action.target)} right now. Its schedule doesn't change.`,
        confirmLabel: "Send now",
      });
      if (!ok) return;
    }
    if (what === "cancel" || what === "delete") {
      const ok = await confirm({
        title: what === "cancel" ? `Cancel “${flow.name || "this workflow"}”?` : `Delete “${flow.name || "this workflow"}”?`,
        description: what === "cancel"
          ? "Nothing more will be sent from it. Its history is kept."
          : "It and its history are removed for good.",
        confirmLabel: what === "cancel" ? "Cancel workflow" : "Delete",
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
      if (what === "run_now") {
        const r = (data.result ?? {}) as { outcome?: string; summary?: string };
        (r.outcome === "failed" ? toast.error : toast.success)(r.summary ?? "Ran.");
      } else {
        toast.success({ pause: "Paused.", resume: "Resumed.", cancel: "Canceled.", delete: "Deleted." }[what]);
      }
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, active: 0, paused: 0, completed: 0, canceled: 0 };
    for (const w of workflows ?? []) { c.all++; c[w.status]++; }
    return c;
  }, [workflows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (workflows ?? [])
      .filter((w) => filter === "all" || w.status === filter)
      .filter((w) => !q || w.name.toLowerCase().includes(q) || w.action.text.toLowerCase().includes(q) ||
        describeTarget(w.action.target).toLowerCase().includes(q));
  }, [workflows, filter, query]);

  const nextUp = useMemo(
    () => (workflows ?? [])
      .filter((w) => w.status === "active" && w.nextRunAt)
      .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!))[0] ?? null,
    [workflows],
  );

  const totalRuns = (workflows ?? []).reduce((n, w) => n + w.runCount, 0);
  const startNew = (template: Template | null = null) => setView({ mode: "edit", workflow: null, template });

  // ── Editing ──
  if (view.mode === "edit") {
    const editor = (
      <Editor
        key={view.workflow?.id ?? view.template?.id ?? "new"}
        workflow={view.workflow}
        template={view.template ?? null}
        prefill={view.workflow ? null : prefill ?? null}
        conversations={conversations}
        contacts={contacts}
        senders={senders}
        onCancel={() => (prefill && !inline && onClose ? onClose() : setView({ mode: "list" }))}
        onSaved={() => { setView({ mode: "list" }); reload(); }}
      />
    );
    return inline ? editor : <Modal onClose={onClose}>{editor}</Modal>;
  }

  // ── Browsing templates ──
  if (view.mode === "templates") {
    const gallery = (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setView({ mode: "list" })} className="flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <span className="text-line-strong">/</span>
          <p className="text-sm font-semibold text-fg">Templates</p>
        </div>
        <Templates onPick={startNew} showBlank={false} />
      </div>
    );
    return inline ? gallery : <Modal onClose={onClose} title="Templates"><div className="p-4">{gallery}</div></Modal>;
  }

  // ── The list ──
  const list = (
    <div className="space-y-5">
      {inline && workflows !== null && workflows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Active" value={counts.active} icon={Zap} hint={counts.active === 1 ? "workflow running" : "workflows running"} />
          <Stat label="Paused" value={counts.paused} icon={Pause} hint="waiting to resume" />
          <Stat
            label="Next run"
            value={nextUp ? showTime(nextUp.nextRunAt).replace(/^\w+, /, "") : "—"}
            icon={Clock}
            hint={nextUp ? nextUp.name || nextUp.action.text.slice(0, 32) : "nothing scheduled"}
            small
          />
          <Stat label="Total runs" value={totalRuns} icon={CheckCircle2} hint="across all workflows" />
        </div>
      )}


      {error ? (
        <Panel>
          <div className="p-10 text-center">
            <AlertCircle className="w-6 h-6 text-ink-rose mx-auto mb-3" />
            <p className="text-sm font-medium text-fg mb-1">Couldn&apos;t load workflows</p>
            <p className="text-xs text-fg-muted max-w-md mx-auto">{error}</p>
            <button onClick={reload} className="mt-4 text-xs font-medium text-fg underline underline-offset-4">Try again</button>
          </div>
        </Panel>
      ) : workflows === null ? (
        <Panel>
          <div className="divide-y divide-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 w-48 rounded bg-surface-3" />
                <div className="h-3 w-32 rounded bg-surface-3 ml-auto" />
              </div>
            ))}
          </div>
        </Panel>
      ) : workflows.length === 0 ? (
        <Templates onPick={startNew} />
      ) : (
        <Panel>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
            <div className="flex items-center gap-1 overflow-x-auto">
              {(["all", "active", "paused", "completed", "canceled"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    filter === f ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg hover:bg-surface-2"
                  }`}
                >
                  {f === "all" ? "All" : STATUS[f].label}
                  <span className="text-[11px] tabular-nums text-fg-subtle">{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workflows"
                className="w-full h-8 text-[13px] bg-surface-2 border border-line rounded-lg pl-8 pr-3 outline-none focus:border-line-strong focus:bg-surface transition-colors"
              />
            </div>
            <button
              onClick={() => setView({ mode: "templates" })}
              className="flex items-center gap-1.5 border border-line bg-surface text-fg text-[13px] font-medium rounded-lg px-3 h-8 hover:bg-surface-2 transition-colors"
            >
              <LayoutTemplate className="w-3.5 h-3.5" /> Templates
            </button>
            {inline && (
              <button
                onClick={() => startNew()}
                className="flex items-center gap-1.5 bg-fg text-surface text-[13px] font-medium rounded-lg px-3 h-8 hover:opacity-90 transition-opacity"
              >
                <Plus className="w-3.5 h-3.5" /> New workflow
              </button>
            )}
          </div>

          {/* Column heads */}
          <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_2.5rem] gap-4 px-5 py-2.5 border-b border-line bg-surface-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            <span>Workflow</span><span>Audience</span><span>Schedule</span><span>Last run</span><span />
          </div>

          {shown.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-fg-muted">No workflows match.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((w) => (
                <Row
                  key={w.id}
                  flow={w}
                  busy={busy === w.id}
                  onEdit={() => setView({ mode: "edit", workflow: w })}
                  onAct={(what) => act(w, what)}
                />
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );

  if (inline) return list;

  return (
    <Modal
      onClose={onClose}
      title="Scheduled messages"
      action={
        <button
          onClick={() => startNew()}
          className="flex items-center gap-1.5 bg-fg text-surface text-xs font-medium rounded-lg px-3 h-8 hover:opacity-90 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      }
    >
      <div className="p-4">{list}</div>
    </Modal>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface border border-line rounded-xl overflow-hidden">{children}</div>;
}

function Modal({
  onClose, title, action, children,
}: { onClose?: () => void; title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Overlay onDismiss={onClose ?? (() => {})} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-3 md:p-6">
      <div className="bg-canvas border border-line rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-5 h-14 border-b border-line bg-surface shrink-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <CalendarClock className="w-4 h-4 text-fg-muted" /> {title ?? "Workflow"}
          </p>
          <div className="flex items-center gap-2">
            {action}
            {onClose && (
              <button onClick={onClose} className="flex items-center justify-center w-8 h-8 rounded-lg text-fg-muted hover:bg-surface-3" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </Overlay>
  );
}

function Stat({
  label, value, hint, icon: Icon, small = false,
}: { label: string; value: React.ReactNode; hint: string; icon: React.ElementType; small?: boolean }) {
  return (
    <div className="bg-surface border border-line rounded-xl px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-fg-muted">{label}</p>
        <Icon className="w-3.5 h-3.5 text-fg-subtle" />
      </div>
      <p className={`mt-1.5 font-semibold tracking-tight text-fg tabular-nums truncate ${small ? "text-base" : "text-2xl"}`}>{value}</p>
      <p className="text-[11px] text-fg-subtle mt-0.5 truncate">{hint}</p>
    </div>
  );
}

function describeTarget(t: SmsTarget): string {
  if (t.kind === "thread") return t.label || "A conversation";
  const names = t.numbers.map((n) => t.labels?.[n] || formatPhone(n) || n);
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

function Audience({ target }: { target: SmsTarget }) {
  const Icon = target.kind === "thread" ? MessageSquare : Users;
  const sub = target.kind === "thread"
    ? "Conversation"
    : target.numbers.length === 1 ? "1 person" : `${target.numbers.length} people · ${target.mode === "group" ? "group text" : "one by one"}`;
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-surface-3 text-fg-muted shrink-0">
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] text-fg truncate">{describeTarget(target)}</span>
        <span className="block text-[11px] text-fg-subtle truncate">{sub}</span>
      </span>
    </div>
  );
}

// ── One row ──────────────────────────────────────────────────────────────

function Row({
  flow, busy, onEdit, onAct,
}: {
  flow: Workflow;
  busy: boolean;
  onEdit: () => void;
  onAct: (what: "pause" | "resume" | "cancel" | "delete" | "run_now") => void;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const status = STATUS[flow.status];
  const done = flow.status === "completed" || flow.status === "canceled";

  function toggle() {
    setOpen((o) => !o);
  }

  // Fetched when opened, and again whenever the list reports a newer run.
  const latestRun = flow.lastRun?.id ?? "";
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/workflows/${flow.id}`);
        const data = await res.json();
        if (alive) setRuns(res.ok ? data.runs ?? [] : []);
      } catch {
        if (alive) setRuns((r) => r ?? []);
      }
    })();
    return () => { alive = false; };
  }, [open, flow.id, latestRun]);

  const item = "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-left transition-colors hover:bg-surface-3";

  return (
    <li className={open ? "bg-surface-2" : ""}>
      <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_2.5rem] gap-x-4 gap-y-2 items-center px-5 py-3.5">
        {/* Name + preview */}
        <button onClick={toggle} className="flex items-start gap-2.5 min-w-0 text-left">
          <span className="mt-0.5 text-fg-subtle">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-fg truncate">{flow.name || "Untitled workflow"}</span>
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${status.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} /> {status.label}
              </span>
            </span>
            <span className="block text-[12px] text-fg-muted truncate mt-0.5">{flow.action.text}</span>
          </span>
        </button>

        {/* Actions (mobile: top right) */}
        <div className="relative md:order-last justify-self-end">
          <button
            ref={menuButton}
            onClick={() => setMenu((m) => !m)}
            disabled={busy}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:opacity-40 ${
              menu ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-3 hover:text-fg"
            }`}
            aria-label="Actions"
            aria-expanded={menu}
          >
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
          </button>
          {menu && (
            <FloatingLayer anchorRef={menuButton} width={184} onClose={() => setMenu(false)}>
              <div className="bg-surface border border-line rounded-xl shadow-xl p-1 mt-1">
                {flow.status !== "canceled" && <button className={item} onClick={() => { setMenu(false); onAct("run_now"); }}><Send className="w-3.5 h-3.5 text-fg-muted" /> Run now</button>}
                {!done && <button className={item} onClick={() => { setMenu(false); onEdit(); }}><Pencil className="w-3.5 h-3.5 text-fg-muted" /> Edit</button>}
                {flow.status === "active" && <button className={item} onClick={() => { setMenu(false); onAct("pause"); }}><Pause className="w-3.5 h-3.5 text-fg-muted" /> Pause</button>}
                {flow.status === "paused" && <button className={item} onClick={() => { setMenu(false); onAct("resume"); }}><Play className="w-3.5 h-3.5 text-fg-muted" /> Resume</button>}
                <button className={item} onClick={() => { setMenu(false); toggle(); }}><FileText className="w-3.5 h-3.5 text-fg-muted" /> {open ? "Hide history" : "History"}</button>
                {!done && <button className={`${item} text-ink-rose hover:bg-tint-rose`} onClick={() => { setMenu(false); onAct("cancel"); }}><Ban className="w-3.5 h-3.5" /> Cancel</button>}
                {done && <button className={`${item} text-ink-rose hover:bg-tint-rose`} onClick={() => { setMenu(false); onAct("delete"); }}><Trash2 className="w-3.5 h-3.5" /> Delete</button>}
              </div>
            </FloatingLayer>
          )}
        </div>

        <div className="col-span-2 md:col-span-1 pl-6.5 md:pl-0"><Audience target={flow.action.target} /></div>

        <div className="col-span-2 md:col-span-1 pl-6.5 md:pl-0 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-fg">
            {flow.trigger.repeat === "none" ? <Clock className="w-3.5 h-3.5 text-fg-subtle" /> : <RepeatIcon className="w-3.5 h-3.5 text-fg-subtle" />}
            {REPEAT_LABELS[flow.trigger.repeat]}
          </span>
          <span className="block text-[11px] text-fg-subtle truncate mt-0.5">
            {flow.status === "active" && flow.nextRunAt ? `Next ${showTime(flow.nextRunAt)}` : flow.trigger.until ? `Until ${flow.trigger.until}` : "No upcoming run"}
          </span>
        </div>

        <div className="col-span-2 md:col-span-1 pl-6.5 md:pl-0 min-w-0">
          {flow.lastRun ? (
            <>
              <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${OUTCOME[flow.lastRun.outcome].text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${OUTCOME[flow.lastRun.outcome].dot}`} />
                {OUTCOME[flow.lastRun.outcome].label}
              </span>
              <span className="block text-[11px] text-fg-subtle truncate mt-0.5">{showTime(flow.lastRun.startedAt)}</span>
            </>
          ) : (
            <span className="text-[12px] text-fg-subtle">Not run yet</span>
          )}
        </div>
      </div>

      {open && (
        <div className="px-5 pb-5 md:pl-12">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle mb-2">Message</p>
              <p className="text-[13px] text-fg whitespace-pre-wrap">{flow.action.text}</p>
              <p className="text-[11px] text-fg-subtle mt-3">Created by {flow.createdByName || flow.createdByEmail} · {showTime(flow.createdAt)}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle mb-2">Run history</p>
              {runs === null ? (
                <RefreshCw className="w-4 h-4 animate-spin text-fg-subtle" />
              ) : runs.length === 0 ? (
                <p className="text-[13px] text-fg-muted">It hasn&apos;t run yet.</p>
              ) : (
                <ol className="relative space-y-3 before:absolute before:left-0.75 before:top-1.5 before:bottom-1.5 before:w-px before:bg-line">
                  {runs.map((r) => (
                    <li key={r.id} className="relative pl-5">
                      <span className={`absolute left-0 top-1.5 w-2 h-2 rounded-full ring-2 ring-surface ${OUTCOME[r.outcome].dot}`} />
                      <p className="text-[12px]">
                        <span className={`font-medium ${OUTCOME[r.outcome].text}`}>{OUTCOME[r.outcome].label}</span>
                        <span className="text-fg-subtle"> · {showTime(r.startedAt)}</span>
                      </p>
                      <p className="text-[12px] text-fg-muted">{r.summary}</p>
                      {r.detail.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {r.detail.map((d, i) => (
                            <li key={i} className="text-[11px] text-fg-subtle">
                              {d.to} — <span className={d.error ? "text-ink-rose" : ""}>{d.error ?? d.skipped ?? (d.ok ? "sent" : "")}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Empty state: start from a template ───────────────────────────────────

function Templates({ onPick, showBlank = true }: { onPick: (t: Template | null) => void; showBlank?: boolean }) {
  const [category, setCategory] = useState<TemplateCategory | "all">("all");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = TEMPLATES.filter((t) =>
    (category === "all" || t.category === category) &&
    (!query || t.name.toLowerCase().includes(query) || t.blurb.toLowerCase().includes(query) || t.text.toLowerCase().includes(query)),
  );
  const countIn = (c: TemplateCategory) => TEMPLATES.filter((t) => t.category === c).length;

  return (
    <div className="space-y-4">
      {showBlank && (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-8 text-center">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-surface-3 text-fg-muted mb-3">
            <CalendarClock className="w-5 h-5" />
          </span>
          <p className="text-base font-semibold text-fg">No workflows yet</p>
          <p className="text-sm text-fg-muted mt-1 max-w-md mx-auto">
            Send texts on their own: reminders, notices and follow-ups, once or on a repeat. Start from one of {TEMPLATES.length} templates below, or a blank one.
          </p>
          <button
            onClick={() => onPick(null)}
            className="mt-4 inline-flex items-center gap-2 bg-fg text-surface text-sm font-medium rounded-lg px-3.5 h-9 hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> Blank workflow
          </button>
        </div>
      )}

      <div className="bg-surface border border-line rounded-xl">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
          <div className="flex items-center gap-1 overflow-x-auto">
            {(["all", ...TEMPLATE_CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  category === c ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg hover:bg-surface-2"
                }`}
              >
                {c === "all" ? "All" : c}
                <span className="text-[11px] tabular-nums text-fg-subtle">{c === "all" ? TEMPLATES.length : countIn(c)}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search templates"
              className="w-full h-8 text-[13px] bg-surface-2 border border-line rounded-lg pl-8 pr-3 outline-none focus:border-line-strong focus:bg-surface transition-colors"
            />
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-muted">No template matches.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
            {shown.map((t) => (
              <button
                key={t.id}
                onClick={() => onPick(t)}
                className="group text-left rounded-xl border border-line bg-surface p-4 hover:border-line-strong hover:shadow-sm transition-all flex flex-col"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-3 text-fg-muted group-hover:text-fg">
                    <t.icon className="w-4 h-4" />
                  </span>
                  <span className="text-[11px] text-fg-subtle">{REPEAT_LABELS[t.repeat]}</span>
                </div>
                <p className="text-sm font-medium text-fg mt-3">{t.name}</p>
                <p className="text-[12px] text-fg-muted mt-0.5">{t.blurb}</p>
                <p className="text-[12px] text-fg-subtle mt-2 line-clamp-2 italic">“{t.text}”</p>
                <span className="mt-3 text-[11px] font-medium text-fg-subtle">{t.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── The editor ───────────────────────────────────────────────────────────

/** An hour from now, on the next quarter hour. */
function defaultWhen(): number {
  const t = Date.now() + 60 * 60 * 1000;
  return Math.ceil(t / (15 * 60 * 1000)) * 15 * 60 * 1000;
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-xl">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-line">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-fg text-surface text-[11px] font-semibold tabular-nums">{n}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{title}</p>
          {hint && <p className="text-[12px] text-fg-subtle">{hint}</p>}
        </div>
      </header>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

function Editor({
  workflow, template, prefill, conversations, contacts, senders, onCancel, onSaved,
}: {
  workflow: Workflow | null;
  template: Template | null;
  prefill: SchedulePrefill | null;
  conversations: ScheduleConversation[];
  contacts: Array<{ number: string; name: string }>;
  senders: Array<{ number: string; user: string }>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const target = workflow?.action.target;

  const [name, setName] = useState(workflow?.name ?? template?.name ?? "");
  const [text, setText] = useState(workflow?.action.text ?? prefill?.text ?? template?.text ?? "");
  const [kind, setKind] = useState<"thread" | "numbers">(target?.kind ?? (prefill ? "thread" : "numbers"));
  const [sessionId, setSessionId] = useState(target?.kind === "thread" ? target.sessionId : prefill?.sessionId ?? "");
  const [people, setPeople] = useState<Array<{ number: string; name: string }>>(() =>
    target?.kind === "numbers" ? target.numbers.map((n) => ({ number: n, name: target.labels?.[n] ?? "" })) : [],
  );
  const [mode, setMode] = useState<"individual" | "group">(target?.kind === "numbers" ? target.mode : "individual");
  const [fromNumber, setFromNumber] = useState(target?.kind === "numbers" ? target.fromNumber : senders[0]?.number ?? "");
  const [when, setWhen] = useState(() => toLocalInput(workflow ? Date.parse(workflow.nextRunAt ?? workflow.trigger.at) : defaultWhen()));
  const [repeat, setRepeat] = useState<Repeat>(workflow?.trigger.repeat ?? template?.repeat ?? "none");
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
  const threadLabel =
    conversation?.label ||
    (prefill?.sessionId === sessionId ? prefill.label : "") ||
    (target?.kind === "thread" && target.sessionId === sessionId ? target.label : "");

  const atMs = fromLocalInput(when);
  const payload = {
    name,
    trigger: { at: atMs ? new Date(atMs).toISOString() : "", repeat, ...(repeat !== "none" && until ? { until } : {}) },
    action: {
      text,
      target: kind === "thread"
        ? { kind: "thread", sessionId, user: conversation?.user ?? (target?.kind === "thread" ? target.user : prefill?.user ?? ""), label: threadLabel || "" }
        : {
            kind: "numbers", numbers: people.map((p) => p.number), fromNumber, mode,
            labels: Object.fromEntries(people.filter((p) => p.name).map((p) => [p.number, p.name])),
          },
    },
  };
  const checked = checkScheduledSms(payload, now);
  const preview = checked.ok ? upcomingRuns(checked.trigger, now, 4) : [];

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
    return (q ? conversations.filter((c) => c.label.toLowerCase().includes(q)) : conversations).slice(0, 50);
  }, [threadQuery, conversations]);

  function addPerson(number: string, personName: string) {
    const n = tenDigits(number);
    if (!n || people.some((p) => p.number === n)) return;
    setPeople((prev) => [...prev, { number: n, name: personName }]);
    setQuery("");
  }

  const audienceLabel = kind === "thread"
    ? threadLabel || "No conversation picked"
    : people.length === 0 ? "Nobody added yet" : people.length === 1 ? (people[0].name || formatPhone(people[0].number)) : `${people.length} people`;

  async function save() {
    if (!checked.ok || saving) {
      if (!checked.ok) toast.error(checked.error);
      return;
    }
    const ok = await confirm({
      title: workflow ? "Save changes?" : "Create this workflow?",
      description:
        `It texts ${audienceLabel}, first at ${showTime(checked.firstRunAt)}` +
        `${repeat !== "none" ? `, then ${REPEAT_LABELS[repeat].toLowerCase()}` : ""}.`,
      confirmLabel: workflow ? "Save" : "Create workflow",
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

  const field = "w-full text-sm bg-surface-2 border border-line rounded-lg px-3 py-2 outline-none focus:border-line-strong focus:bg-surface transition-colors";
  const label = "block text-[12px] font-medium text-fg-muted mb-1.5";
  const seg = (on: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
      on ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
    }`;

  return (
    <div className="p-4 md:p-0 space-y-5">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onCancel} className="flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <span className="text-line-strong">/</span>
        <p className="text-sm font-semibold text-fg">{workflow ? "Edit workflow" : template ? template.name : "New workflow"}</p>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onCancel} className="text-sm font-medium text-fg-muted px-3 h-9 rounded-lg hover:bg-surface-3">Cancel</button>
          <button
            onClick={save}
            disabled={!checked.ok || saving}
            className="flex items-center gap-2 bg-fg text-surface text-sm font-medium px-4 h-9 rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
            {workflow ? "Save changes" : "Create workflow"}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-5 items-start">
        <div className="space-y-4">
          <div>
            <label className={label}>Workflow name</label>
            <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly billing reminder" />
          </div>

          <Step n={1} title="Audience" hint="Who receives the text">
            <div className="flex gap-1 bg-surface-3 rounded-lg p-1">
              <button type="button" className={seg(kind === "thread")} onClick={() => setKind("thread")}>
                <MessageSquare className="w-3.5 h-3.5" /> Existing conversation
              </button>
              <button type="button" className={seg(kind === "numbers")} onClick={() => setKind("numbers")}>
                <Users className="w-3.5 h-3.5" /> Contacts or numbers
              </button>
            </div>

            {kind === "thread" ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
                  <input className={`${field} pl-8`} value={threadQuery} onChange={(e) => setThreadQuery(e.target.value)} placeholder="Find a conversation or group" />
                </div>
                <ul className="max-h-56 overflow-y-auto border border-line rounded-lg divide-y divide-line">
                  {threadMatches.map((c) => {
                    const on = c.sessionId === sessionId;
                    return (
                      <li key={c.sessionId}>
                        <button
                          type="button"
                          onClick={() => setSessionId(c.sessionId)}
                          className={`w-full flex items-center gap-2.5 text-left px-3 py-2 text-[13px] transition-colors ${on ? "bg-surface-3 text-fg" : "text-fg hover:bg-surface-2"}`}
                        >
                          <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${on ? "border-fg bg-fg ring-2 ring-inset ring-surface" : "border-line-strong"}`} />
                          <span className="truncate flex-1">{c.label}</span>
                          {c.isGroup && <span className="text-[10px] text-fg-subtle">Group</span>}
                        </button>
                      </li>
                    );
                  })}
                  {threadMatches.length === 0 && <li className="px-3 py-3 text-[13px] text-fg-muted">No conversation matches.</li>}
                </ul>
                <p className="text-[12px] text-fg-subtle">Sent into the conversation from the number it already uses, like a reply.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className={`${field} pl-8`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (matches[0]) addPerson(matches[0].number, matches[0].name);
                        else if (typedNumber) addPerson(typedNumber, "");
                      }
                    }}
                    placeholder="Search contacts, or type a ten-digit number"
                  />
                  {(matches.length > 0 || typedNumber) && (
                    <ul className="absolute z-20 left-0 right-0 mt-1 bg-surface border border-line rounded-lg shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                      {matches.map((c) => (
                        <li key={c.number}>
                          <button type="button" onMouseDown={(e) => { e.preventDefault(); addPerson(c.number, c.name); }} className="w-full text-left px-3 py-2 hover:bg-surface-2">
                            <span className="block text-[13px] text-fg">{c.name}</span>
                            <span className="block text-[11px] text-fg-subtle tabular-nums">{formatPhone(c.number) || c.number}</span>
                          </button>
                        </li>
                      ))}
                      {typedNumber && !people.some((p) => p.number === typedNumber) && (
                        <li>
                          <button type="button" onMouseDown={(e) => { e.preventDefault(); addPerson(typedNumber, ""); }} className="w-full flex items-center gap-2 text-left px-3 py-2 hover:bg-surface-2 text-[13px] text-fg">
                            <Plus className="w-3.5 h-3.5 text-fg-muted" /> Add {formatPhone(typedNumber) || typedNumber}
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>

                {people.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <span key={p.number} className="inline-flex items-center gap-1.5 text-[12px] bg-surface-3 text-fg rounded-full pl-2.5 pr-1 py-1">
                        {p.name ? <span className="font-medium">{p.name}</span> : null}
                        <span className="text-fg-muted tabular-nums">{formatPhone(p.number) || p.number}</span>
                        <button type="button" onClick={() => setPeople((prev) => prev.filter((x) => x.number !== p.number))} className="rounded-full p-0.5 text-fg-subtle hover:text-fg hover:bg-surface" aria-label="Remove">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-fg-subtle">Nobody added yet.</p>
                )}

                {people.length > 1 && (
                  <div className="grid sm:grid-cols-2 gap-2">
                    {([
                      ["individual", "One by one", "Each person gets their own text; nobody sees who else got it."],
                      ["group", "Group text", `Everyone sees everyone's replies (up to ${MAX_GROUP}).`],
                    ] as const).map(([value, title, hint]) => (
                      <label
                        key={value}
                        className={`flex gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${mode === value ? "border-fg bg-surface-2" : "border-line hover:border-line-strong"}`}
                      >
                        <input type="radio" className="mt-0.5" checked={mode === value} onChange={() => setMode(value)} />
                        <span>
                          <span className="block text-[13px] font-medium text-fg">{title}</span>
                          <span className="block text-[12px] text-fg-muted">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <div>
                  <label className={label}>Send from</label>
                  <Select
                    value={fromNumber}
                    onChange={setFromNumber}
                    options={senders.map((s) => ({ value: s.number, label: formatPhone(s.number) || s.number }))}
                  />
                </div>
              </div>
            )}
          </Step>

          <Step n={2} title="Message" hint="What they'll receive">
            {!workflow && (
              <Select
                value=""
                onChange={(id) => {
                  const t = TEMPLATES.find((x) => x.id === id);
                  if (!t) return;
                  setText(t.text);
                  if (!name) setName(t.name);
                  if (repeat === "none") setRepeat(t.repeat);
                }}
                options={TEMPLATES.map((t) => ({ value: t.id, label: `${t.category} · ${t.name}` }))}
                placeholder="Start from a template…"
                searchable
              />
            )}
            <textarea className={`${field} resize-none leading-relaxed`} rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the text…" />
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fg-subtle">Replace anything in [brackets] before saving.</span>
              <span className={`tabular-nums ${text.length > MAX_TEXT_LENGTH ? "text-ink-rose" : "text-fg-subtle"}`}>
                {text.length} / {MAX_TEXT_LENGTH} · {Math.max(1, Math.ceil(text.length / 160))} SMS
              </span>
            </div>
          </Step>

          <Step n={3} title="Schedule" hint="When it goes out, in Pacific time">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className={label}>{repeat === "none" ? "Send at" : "Starting"}</label>
                <DateTimePicker value={when} onChange={setWhen} quickDates />
              </div>
              <div>
                <label className={label}>Repeat</label>
                <Select
                  value={repeat}
                  onChange={(v) => setRepeat(v as Repeat)}
                  options={(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => ({ value: r, label: REPEAT_LABELS[r] }))}
                />
              </div>
              {repeat !== "none" && (
                <div>
                  <label className={label}>Ends <span className="font-normal text-fg-subtle">(optional)</span></label>
                  <DateTimePicker dateOnly clearable value={until} onChange={setUntil} placeholder="No end date" />
                </div>
              )}
            </div>
          </Step>
        </div>

        {/* ── Live preview ── */}
        <aside className="lg:sticky lg:top-0 space-y-4">
          <div className="bg-surface border border-line rounded-xl p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle mb-3">Preview</p>
            <div className="rounded-2xl bg-surface-2 border border-line p-3 min-h-40">
              <p className="text-center text-[10px] text-fg-subtle mb-2">
                {checked.ok ? showTime(checked.firstRunAt) : "Text message"}
              </p>
              {text.trim() ? (
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink-blue text-white text-[13px] leading-snug px-3 py-2 whitespace-pre-wrap wrap-break-word">
                    {text}
                  </p>
                </div>
              ) : (
                <p className="text-center text-[12px] text-fg-subtle mt-6">Your message appears here.</p>
              )}
            </div>
          </div>

          <div className="bg-surface border border-line rounded-xl p-4 space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">Summary</p>
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">To</dt><dd className="text-fg text-right truncate">{audienceLabel}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">Repeats</dt><dd className="text-fg">{REPEAT_LABELS[repeat]}</dd></div>
            </dl>
            <div className="border-t border-line pt-3">
              <p className="text-[12px] font-medium text-fg-muted mb-1.5">Upcoming runs</p>
              {checked.ok ? (
                <ul className="space-y-1">
                  {preview.map((t, i) => (
                    <li key={t} className="flex items-center gap-2 text-[12px] text-fg tabular-nums">
                      <span className={`w-1.5 h-1.5 rounded-full ${i === 0 ? "bg-fg" : "bg-line-strong"}`} /> {showTime(t)}
                    </li>
                  ))}
                  {repeat !== "none" && preview.length === 4 && <li className="text-[12px] text-fg-subtle pl-3.5">…and so on</li>}
                </ul>
              ) : (
                <p className="text-[12px] text-fg-subtle">{checked.error}</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
