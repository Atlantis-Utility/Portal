"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MessageSquare, CheckSquare, StickyNote, CalendarDays, ArrowRight, Phone, PhoneMissed, Voicemail as VoicemailIcon,
  Plus, PenSquare, Check, Inbox, AlertTriangle, Sparkles,
} from "lucide-react";
import TodaySchedule from "@/components/dashboard/TodaySchedule";
import StatCard from "@/components/ui/StatCard";
import AddTaskDrawer, { type KanbanCard } from "@/components/tasks/AddTaskDrawer";
import CallLink from "@/components/phone/CallLink";
import { usePhone } from "@/components/phone/PhoneProvider";
import { TagChips } from "@/components/ui/TagPicker";
import { colourFor, initialsFor } from "@/components/messages/Avatar";
import { useAuth } from "@/lib/auth-context";
import { canSeeWidget } from "@/lib/dashboard-widgets";
import { hasPageAccess } from "@/lib/nav-pages";
import { addTask, subscribeTasks, updateTask } from "@/lib/db/tasks";
import { subscribeNotes, type Note } from "@/lib/db/notes";
import { useUnreadMessages } from "@/lib/unread-messages";
import { useToast } from "@/lib/toast";
import { formatPhone } from "@/lib/utils";
import type { SmsConversation } from "@/lib/ringlogix-messages";

/**
 * The dashboard: what needs you, in the order it needs you.
 *
 * Replies waiting, calls missed, what's yours and late, what's booked, and
 * anything written down - each one actionable where it sits (open the
 * thread, call back, tick the task off) rather than a count that sends you
 * to another page to find out what it meant.
 */

function greeting(hour: number) {
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function ago(ms: number, now: number) {
  const m = Math.round((now - ms) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The note colours from the Notes board, as card tints. */
const NOTE_TINT: Record<string, string> = {
  amber: "bg-tint-amber", green: "bg-tint-green", blue: "bg-tint-blue",
  violet: "bg-tint-violet", pink: "bg-tint-pink", teal: "bg-tint-teal",
};

function Panel({
  title, href, icon, tone, count, children, action,
}: {
  title: string;
  href?: string;
  icon: React.ReactNode;
  tone: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border border-line rounded-2xl overflow-hidden flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-line">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>{icon}</span>
          <p className="text-sm font-semibold text-fg truncate">{title}</p>
          {count !== undefined && count > 0 && (
            <span className="text-[11px] font-semibold tabular-nums px-1.5 rounded-full bg-surface-3 text-fg-muted">{count}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          {href && (
            <Link href={href} className="text-xs font-medium text-fg-muted hover:text-fg inline-flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </header>
      <div className="flex-1 min-h-[12rem] max-h-[22rem] overflow-y-auto">{children}</div>
    </section>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Inbox; text: string }) {
  return (
    <div className="px-5 py-8 text-center">
      <Icon className="w-5 h-5 text-fg-subtle mx-auto mb-2" />
      <p className="text-xs text-fg-subtle">{text}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { authUser } = useAuth();
  const toast = useToast();
  const phone = usePhone();
  const widgets = authUser?.dashboardWidgets;
  const access = authUser?.access;
  const show = (key: string) => canSeeWidget(key, widgets);
  const canMessages = hasPageAccess("/messages", access);
  const canTasks = hasPageAccess("/tasks", access);

  // Taken once: the greeting and "2h ago" don't need to tick.
  const [now] = useState(() => Date.now());
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  // Starts from the copy Messages keeps in this tab (sc:inbox-v1), so the
  // list paints at once; the fetch below brings it up to date.
  const [threads, setThreads] = useState<{ list: SmsConversation[]; names: Record<string, string>; contacts: Record<string, { name: string }> } | null>(() => {
    try {
      const raw = typeof window === "undefined" ? null : sessionStorage.getItem("sc:inbox-v1");
      const c = raw ? JSON.parse(raw) : null;
      return c && Array.isArray(c.conversations) ? { list: c.conversations, names: c.names ?? {}, contacts: c.contacts ?? {} } : null;
    } catch {
      return null;
    }
  });
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);

  useEffect(() => subscribeTasks(setCards), []);
  useEffect(() => subscribeNotes(setNotes), []);
  // The conversations waiting on a reply, for the "Needs a reply" list.
  useEffect(() => {
    if (!canMessages) return;
    let live = true;
    fetch("/api/ringlogix/messages")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!live || !b) return;
        setThreads({ list: b.conversations ?? [], names: b.names ?? {}, contacts: b.contacts ?? {} });
        try {
          sessionStorage.setItem("sc:inbox-v1", JSON.stringify({ conversations: b.conversations ?? [], names: b.names ?? {}, contacts: b.contacts ?? {}, senders: b.senders ?? [] }));
        } catch { /* only costs the instant paint next time */ }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [canMessages]);

  const unread = useUnreadMessages();
  const me = (authUser?.displayName ?? "").trim().toLowerCase();
  const today = new Date(now).toISOString().slice(0, 10);

  const mine = useMemo(
    () =>
      cards
        .filter((c) => c.column !== "done" && c.assignees.some((a) => a.trim().toLowerCase() === me))
        .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")),
    [cards, me],
  );
  const overdue = mine.filter((c) => !c.dueDateTbd && c.dueDate && c.dueDate < today);
  const dueToday = mine.filter((c) => c.dueDate === today);

  const waiting = useMemo(() => (threads?.list ?? []).filter((t) => t.unread).sort((a, b) => b.lastAt - a.lastAt), [threads]);
  const person = (t: SmsConversation) => {
    if (t.name) return t.name;
    if (t.remoteExtension) return threads?.names[t.remoteExtension] ?? `Extension ${t.remoteExtension}`;
    const d = (t.remoteNumbers[0] ?? t.remote).slice(-10);
    return threads?.contacts[d]?.name || formatPhone(t.remoteNumbers[0] ?? t.remote) || "Unknown";
  };

  // Calls and voicemail for your own extension, from the portal phone.
  const recents = phone?.recents ?? null;
  const missed = useMemo(() => {
    if (!recents) return [];
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    return recents.calls.filter((c) =>
      !c.answered && c.at >= startOfDay.getTime() &&
      (c.direction === "in" || (c.direction === "internal" && c.toExtension === recents.extension && c.fromExtension !== recents.extension)),
    );
  }, [recents, now]);
  const voicemails = recents?.voicemails ?? [];

  async function complete(card: KanbanCard) {
    setCompleting(card.id);
    try {
      await updateTask(card.id, { column: "done", columnSetAt: new Date().toISOString() });
      toast.success(`Done: ${card.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the task");
    } finally {
      setCompleting(null);
    }
  }

  const first = authUser?.displayName?.split(" ")[0] ?? "";
  const nextMeeting = useMemo(() => {
    const t = new Date(now);
    const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    return cards
      .filter((c) => c.type === "meeting" && c.meetingDate === today && (c.meetingTime ?? "") >= hhmm)
      .sort((a, b) => (a.meetingTime ?? "").localeCompare(b.meetingTime ?? ""))[0];
  }, [cards, today, now]);

  const summary = [
    canMessages && unread ? `${unread} conversation${unread === 1 ? "" : "s"} need${unread === 1 ? "s" : ""} a reply` : "",
    missed.length ? `${missed.length} missed call${missed.length === 1 ? "" : "s"}` : "",
    dueToday.length ? `${dueToday.length} task${dueToday.length === 1 ? "" : "s"} due today` : "",
    overdue.length ? `${overdue.length} overdue` : "",
    nextMeeting ? `next: ${nextMeeting.title} at ${nextMeeting.meetingTime}` : "",
  ].filter(Boolean);

  const stats = [
    canMessages && { label: "Need a reply", value: unread ?? "–", href: "/messages", Icon: MessageSquare, tone: "bg-tint-blue text-ink-blue", alert: Boolean(unread) },
    phone && { label: "Missed today", value: recents ? missed.length : "–", onClick: () => phone.setOpen(true), Icon: PhoneMissed, tone: "bg-tint-rose text-ink-rose", alert: missed.length > 0 },
    canTasks && { label: "My open tasks", value: mine.length, href: "/tasks", Icon: CheckSquare, tone: "bg-tint-violet text-ink-violet", alert: false },
    canTasks && { label: "Overdue", value: overdue.length, href: "/tasks", Icon: AlertTriangle, tone: "bg-tint-amber text-ink-amber", alert: overdue.length > 0 },
    !phone && { label: "Notes", value: notes.length, href: "/notes", Icon: StickyNote, tone: "bg-tint-pink text-ink-pink", alert: false },
  ].filter(Boolean) as Array<{ label: string; value: number | string; href?: string; onClick?: () => void; Icon: typeof Inbox; tone: string; alert: boolean }>;

  const actions = [
    canMessages && { label: "New text", Icon: PenSquare, href: "/messages", tone: "text-ink-blue" },
    phone && { label: "Call", Icon: Phone, onClick: () => phone.setOpen(true), tone: "text-ink-green" },
    canTasks && { label: "New task", Icon: Plus, onClick: () => setAdding(true), tone: "text-ink-violet" },
    hasPageAccess("/notes", access) && { label: "New note", Icon: StickyNote, href: "/notes", tone: "text-ink-pink" },
  ].filter(Boolean) as Array<{ label: string; Icon: typeof Inbox; href?: string; onClick?: () => void; tone: string }>;

  return (
    <div className="max-w-7xl">
      {/* ── Hello, and what today looks like ── */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 md:p-7 mb-5">
        <div className="absolute -right-16 -top-20 w-72 h-72 rounded-full bg-tint-indigo opacity-70 blur-2xl pointer-events-none" aria-hidden />
        <div className="absolute right-24 -bottom-24 w-56 h-56 rounded-full bg-tint-blue opacity-60 blur-2xl pointer-events-none" aria-hidden />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
          <div>
            <p className="text-xs font-medium text-fg-subtle">
              {new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-fg mt-1">
              {greeting(new Date(now).getHours())}{first ? `, ${first}` : ""}
            </h1>
            <p className="text-sm text-fg-muted mt-1.5 flex items-center gap-1.5 flex-wrap">
              {summary.length ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-ink-indigo shrink-0" />
                  {summary.join(" · ")}
                </>
              ) : (
                "You're all caught up. Nothing is waiting on you."
              )}
            </p>
          </div>
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => {
                const inner = (
                  <>
                    <a.Icon className={`w-4 h-4 ${a.tone}`} />
                    {a.label}
                  </>
                );
                const cls = "inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-medium text-fg hover:bg-surface-3 hover:border-line-strong transition-colors";
                return a.href
                  ? <Link key={a.label} href={a.href} className={cls}>{inner}</Link>
                  : <button key={a.label} type="button" onClick={a.onClick} className={cls}>{inner}</button>;
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── At a glance ── */}
      {stats.length > 0 && (
        // auto-fit: however many cards this person gets, they fill the row.
        <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3 mb-5">
          {stats.map((st) => (
            <StatCard key={st.label} label={st.label} value={st.value} icon={st.Icon} tone={st.tone} href={st.href} onClick={st.onClick} alert={st.alert} />
          ))}
        </div>
      )}

      {/* Two even columns: what needs a reply and the calls beside it, your
          tasks and today's schedule beside them, then recent notes. Panels
          in a row share a height; long lists scroll inside their panel. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {show("messages") && canMessages && (
            <Panel title="Needs a reply" href="/messages" icon={<MessageSquare className="w-4 h-4" />} tone="bg-tint-blue text-ink-blue" count={waiting.length}>
              {!threads ? (
                <div className="divide-y divide-line">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-3">
                      <span className="w-9 h-9 rounded-full bg-surface-3 animate-pulse" />
                      <span className="flex-1 space-y-1.5"><span className="block h-3 w-32 rounded bg-surface-3 animate-pulse" /><span className="block h-2.5 w-56 rounded bg-surface-3 animate-pulse" /></span>
                    </div>
                  ))}
                </div>
              ) : waiting.length === 0 ? (
                <Empty icon={Inbox} text="Every conversation has an answer." />
              ) : (
                <ul className="divide-y divide-line">
                  {waiting.slice(0, 5).map((t) => {
                    const who = person(t);
                    return (
                      <li key={t.sessionId}>
                        <Link href={`/messages?session=${encodeURIComponent(t.sessionId)}`} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-3 transition-colors">
                          <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${colourFor(who)}`}>{initialsFor(who)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-fg truncate">{who}</span>
                              <span className="w-1.5 h-1.5 rounded-full bg-[#0070f3] shrink-0" />
                            </span>
                            <span className="block text-[13px] text-fg-muted truncate">{t.lastMessage || (t.hasMedia ? "Picture" : "")}</span>
                          </span>
                          <span className="text-[11px] text-fg-subtle shrink-0 tabular-nums">{ago(t.lastAt, now)}</span>
                          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-ink-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Reply <ArrowRight className="w-3 h-3" /></span>
                        </Link>
                      </li>
                    );
                  })}
                  {waiting.length > 5 && (
                    <li><Link href="/messages" className="block px-5 py-2.5 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-3">+{waiting.length - 5} more waiting</Link></li>
                  )}
                </ul>
              )}
            </Panel>
          )}
          {phone && (
            <Panel
              title="Calls & voicemail"
              icon={<Phone className="w-4 h-4" />}
              tone="bg-tint-green text-ink-green"
              count={missed.length + voicemails.length}
              action={<button type="button" onClick={() => phone.setOpen(true)} className="text-xs font-medium text-fg-muted hover:text-fg inline-flex items-center gap-1">Open phone <ArrowRight className="w-3 h-3" /></button>}
            >
              {!recents ? (
                <p className="px-5 py-6 text-xs text-fg-subtle text-center">Loading your calls…</p>
              ) : missed.length === 0 && voicemails.length === 0 ? (
                <Empty icon={Phone} text="No missed calls or voicemail." />
              ) : (
                <ul className="divide-y divide-line">
                  {missed.slice(0, 4).map((c) => {
                    const number = c.direction === "in" ? c.fromNumber : c.fromExtension;
                    const who = c.fromName || formatPhone(number) || number || "Unknown";
                    return (
                      <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                        <span className="w-8 h-8 rounded-full bg-tint-rose text-ink-rose flex items-center justify-center shrink-0"><PhoneMissed className="w-3.5 h-3.5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-fg truncate">{who}</span>
                          <span className="block text-[11px] text-fg-subtle">Missed · {ago(c.at, now)} ago{c.voicemail ? " · left voicemail" : ""}</span>
                        </span>
                        {number && (
                          <CallLink number={number} name={c.fromName} className="text-xs font-semibold rounded-lg px-2.5 py-1 bg-tint-green text-ink-green hover:opacity-80">Call back</CallLink>
                        )}
                      </li>
                    );
                  })}
                  {voicemails.slice(0, 3).map((v) => {
                    const number = v.fromNumber || v.fromExtension;
                    const who = v.fromName || formatPhone(number) || number || "Unknown caller";
                    return (
                      <li key={v.id} className="px-5 py-2.5">
                        <button type="button" onClick={() => phone.setOpen(true)} className="w-full flex items-start gap-3 text-left">
                          <span className="w-8 h-8 rounded-full bg-tint-violet text-ink-violet flex items-center justify-center shrink-0"><VoicemailIcon className="w-3.5 h-3.5" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-fg truncate">{who}</span>
                              <span className="text-[11px] text-fg-subtle shrink-0">{ago(v.at, now)}</span>
                            </span>
                            <span className="block text-[12px] text-fg-muted line-clamp-2">{v.transcription || "Voicemail"}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}
          {show("work") && canTasks && (
            <Panel
              title="My tasks"
              href="/tasks"
              icon={<CheckSquare className="w-4 h-4" />}
              tone="bg-tint-violet text-ink-violet"
              count={mine.length}
              action={
                <button type="button" onClick={() => setAdding(true)} className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3 hover:text-fg" aria-label="New task" title="New task">
                  <Plus className="w-4 h-4" />
                </button>
              }
            >
              {mine.length === 0 ? (
                <Empty icon={CheckSquare} text="Nothing assigned to you." />
              ) : (
                <ul className="divide-y divide-line">
                  {mine.slice(0, 6).map((c) => {
                    const late = !c.dueDateTbd && c.dueDate && c.dueDate < today;
                    const isToday = c.dueDate === today;
                    return (
                      <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                        {/* Tick it off from here. */}
                        <button
                          type="button"
                          onClick={() => complete(c)}
                          disabled={completing === c.id}
                          aria-label={`Mark "${c.title}" done`}
                          title="Mark done"
                          className="group w-5 h-5 rounded-md border-2 border-line-strong hover:border-ink-green hover:bg-tint-green flex items-center justify-center shrink-0 transition-colors"
                        >
                          <Check className="w-3 h-3 text-ink-green opacity-0 group-hover:opacity-100" />
                        </button>
                        <Link href="/tasks" className="min-w-0 flex-1">
                          <span className="block text-sm text-fg truncate">{c.title}</span>
                          <span className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-fg-subtle capitalize">{c.column.replace("-", " ")}</span>
                            {(c.tags ?? []).length > 0 && <TagChips tags={c.tags} max={2} />}
                          </span>
                        </Link>
                        <span className={`text-[11px] font-medium shrink-0 px-2 py-0.5 rounded-full ${
                          late ? "bg-tint-rose text-ink-rose" : isToday ? "bg-tint-amber text-ink-amber" : "text-fg-subtle"
                        }`}>
                          {c.dueDateTbd || !c.dueDate ? "No date" : late ? "Overdue" : isToday ? "Today" : new Date(`${c.dueDate}T12:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}
          {show("schedule") && (
            <Panel title="Today" href="/calendar" icon={<CalendarDays className="w-4 h-4" />} tone="bg-tint-amber text-ink-amber">
              <div className="p-5"><TodaySchedule cards={cards} /></div>
            </Panel>
          )}
        {/* Full width when the panels above pair up; otherwise it takes the
            empty half beside the last one. */}
        <div className={[show("messages") && canMessages, phone, show("work") && canTasks, show("schedule")].filter(Boolean).length % 2 === 0 ? "lg:col-span-2" : ""}>
          {show("notes") && hasPageAccess("/notes", access) && (
            <Panel title="Recent notes" href="/notes" icon={<StickyNote className="w-4 h-4" />} tone="bg-tint-pink text-ink-pink">
              {notes.length === 0 ? (
                <Empty icon={StickyNote} text="Nothing written down yet." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 p-4">
                  {[...notes].sort((x, y) => Number(Boolean(y.pinned)) - Number(Boolean(x.pinned)) || y.updatedAt.localeCompare(x.updatedAt)).slice(0, 4).map((n) => (
                    <Link
                      key={n.id}
                      href={`/notes?note=${encodeURIComponent(n.id)}`}
                      className={`block rounded-xl border border-line p-3.5 hover:shadow-sm hover:-translate-y-0.5 transition-all ${NOTE_TINT[n.color ?? ""] ?? "bg-surface"}`}
                    >
                      <p className="text-sm font-semibold text-fg truncate">{n.title || "Untitled"}</p>
                      <p className="text-[12px] text-fg-muted line-clamp-3 mt-1 whitespace-pre-line">{n.body || "No text"}</p>
                      <p className="text-[11px] text-fg-subtle mt-2">{ago(Date.parse(n.updatedAt), now)} ago</p>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>

      {adding && (
        <AddTaskDrawer
          open
          onClose={() => setAdding(false)}
          initial={{}}
          onAdd={async (card) => {
            try {
              await addTask({ ...card, createdBy: authUser?.accessEmployeeId ?? undefined });
              toast.success("Task added.");
              setAdding(false);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Couldn't add the task");
            }
          }}
        />
      )}
    </div>
  );
}
