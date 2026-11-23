"use client";

import { useEffect, useMemo, useState } from "react";
import { useUnreadMessages } from "@/lib/unread-messages";
import Link from "next/link";
import Header from "@/components/layout/Header";
import TodaySchedule from "@/components/dashboard/TodaySchedule";
import { useAuth } from "@/lib/auth-context";
import { canSeeWidget } from "@/lib/dashboard-widgets";
import { subscribeTasks } from "@/lib/db/tasks";
import { subscribeNotes, type Note } from "@/lib/db/notes";
import type { KanbanCard } from "@/components/tasks/AddTaskDrawer";
import { MessageSquare, CheckSquare, StickyNote, CalendarDays, ArrowRight } from "lucide-react";

/**
 * The dashboard, written for this app.
 *
 * The ERP's version answered to customers, leads, projects, tickets and
 * UniFi; none of those are here. What is here is a day's work: what is
 * waiting for a reply, what is assigned to you, what is booked, and what
 * anybody has written down.
 */

function Panel({
  title, href, icon, children,
}: {
  title: string;
  href?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-[#eaeaea] rounded-xl">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-[#f0f0f0]">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-semibold text-[#0a0a0a]">{title}</p>
        </div>
        {href && (
          <Link href={href} className="text-[11px] text-[#0070f3] hover:underline inline-flex items-center gap-1">
            Open <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  const { authUser } = useAuth();
  const widgets = authUser?.dashboardWidgets;

  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => subscribeTasks(setCards), []);
  useEffect(() => subscribeNotes(setNotes), []);

  // The one number worth putting on a dashboard for a shared inbox: how
  // many conversations are waiting on somebody here.
  // Kept live by the shell (lib/unread-messages.ts), the same count as the
  // badge on Messages - no need to fetch the whole inbox for one number.
  const unread = useUnreadMessages();

  const me = (authUser?.displayName ?? "").trim().toLowerCase();
  const mine = useMemo(
    () =>
      cards
        .filter((c) => c.column !== "done" && c.assignees.some((a) => a.trim().toLowerCase() === me))
        .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
        .slice(0, 6),
    [cards, me],
  );

  const overdue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return cards.filter((c) => c.column !== "done" && !c.dueDateTbd && c.dueDate && c.dueDate < today).length;
  }, [cards]);

  const show = (key: string) => canSeeWidget(key, widgets);

  return (
    <div>
      <Header
        title={authUser?.displayName ? `Hello, ${authUser.displayName.split(" ")[0]}` : "Dashboard"}
        subtitle="What is waiting, what is yours, and what is booked"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Unread messages", value: unread ?? "—", href: "/messages", tone: "text-[#0070f3]" },
          { label: "My open tasks", value: mine.length, href: "/tasks", tone: "text-[#0a0a0a]" },
          { label: "Overdue", value: overdue, href: "/tasks", tone: overdue > 0 ? "text-[#b91c1c]" : "text-[#0a0a0a]" },
          { label: "Notes", value: notes.length, href: "/notes", tone: "text-[#0a0a0a]" },
        ].map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="bg-white border border-[#eaeaea] rounded-xl p-5 hover:border-[#d4d4d4] transition-colors"
          >
            <p className={`text-3xl font-semibold leading-none mb-1.5 ${k.tone}`}>{k.value}</p>
            <p className="text-sm text-[#666]">{k.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          {show("work") && (
            <Panel title="My tasks" href="/tasks" icon={<CheckSquare className="w-4 h-4 text-[#0070f3]" />}>
              {mine.length === 0 ? (
                <p className="text-xs text-[#999] py-4 text-center">Nothing assigned to you.</p>
              ) : (
                <ul className="divide-y divide-[#f5f5f5] -my-2">
                  {mine.map((c) => (
                    <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-sm text-[#0a0a0a] truncate">{c.title}</span>
                        <span className="block text-[11px] text-[#999]">{c.column.replace("-", " ")}</span>
                      </span>
                      <span className="text-[11px] text-[#999] shrink-0">
                        {c.dueDateTbd || !c.dueDate
                          ? "No date"
                          : new Date(c.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {show("schedule") && (
            <Panel title="Today" href="/calendar" icon={<CalendarDays className="w-4 h-4 text-[#0070f3]" />}>
              <TodaySchedule cards={cards} />
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          {show("messages") && (
            <Panel title="Messages" href="/messages" icon={<MessageSquare className="w-4 h-4 text-[#0070f3]" />}>
              {unread === null ? (
                <p className="text-xs text-[#999]">Couldn&apos;t reach the phone system.</p>
              ) : unread === 0 ? (
                <p className="text-xs text-[#999]">Nothing unread.</p>
              ) : (
                <p className="text-sm text-[#0a0a0a]">
                  <span className="font-semibold">{unread}</span> conversation{unread === 1 ? "" : "s"} waiting on a reply.
                </p>
              )}
            </Panel>
          )}

          {show("notes") && (
            <Panel title="Recent notes" href="/notes" icon={<StickyNote className="w-4 h-4 text-[#0070f3]" />}>
              {notes.length === 0 ? (
                <p className="text-xs text-[#999]">Nothing written down yet.</p>
              ) : (
                <ul className="space-y-3">
                  {notes.slice(0, 5).map((n) => (
                    <li key={n.id}>
                      <p className="text-sm text-[#0a0a0a] truncate">{n.title || "Untitled"}</p>
                      <p className="text-[11px] text-[#999] truncate">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
