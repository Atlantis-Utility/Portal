"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "@/components/ui/Select";
import { TagChips } from "@/components/ui/TagPicker";
import { MESSAGE_TAGS, TAG_BY_KEY } from "@/lib/message-tags";
import Link from "next/link";
import Header from "@/components/layout/Header";
import AddTaskDrawer, { type KanbanCard, type KanbanColumn } from "@/components/tasks/AddTaskDrawer";
import TaskDetailDrawer from "@/components/tasks/TaskDetailDrawer";
import { subscribeTasks, addTask, updateTask, removeTask } from "@/lib/db/tasks";
import { useAuth } from "@/lib/auth-context";
import { Plus, Search, RefreshCw, MessageSquare } from "lucide-react";

/**
 * The task board.
 *
 * Written for this app rather than carried over: the ERP's board also
 * showed tickets and project phases, neither of which exist here, and
 * most of that page was the machinery for merging the three.
 */
const COLUMNS: Array<{ key: KanbanColumn; label: string; tone: string }> = [
  { key: "backlog", label: "Backlog", tone: "bg-[#f5f5f5] text-[#666]" },
  { key: "in-progress", label: "In progress", tone: "bg-[#eff6ff] text-[#0070f3]" },
  { key: "review", label: "Review", tone: "bg-[#fff7e6] text-[#92400e]" },
  { key: "done", label: "Done", tone: "bg-[#f0fdf4] text-[#15803d]" },
];

const PRIORITY: Record<string, string> = {
  high: "bg-[#fef2f2] text-[#b91c1c]",
  medium: "bg-[#fff7e6] text-[#92400e]",
  low: "bg-[#f5f5f5] text-[#666]",
};

function dueLabel(card: KanbanCard): { text: string; late: boolean } {
  if (card.dueDateTbd || !card.dueDate) return { text: "No date", late: false };
  const due = new Date(card.dueDate);
  if (Number.isNaN(due.getTime())) return { text: card.dueDate, late: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    text: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    late: due < today && card.column !== "done",
  };
}

export default function TasksPage() {
  const { authUser } = useAuth();
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [tag, setTag] = useState("");
  const [adding, setAdding] = useState<KanbanColumn | null>(null);
  const [open, setOpen] = useState<KanbanCard | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeTasks((next) => {
      setCards(next);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const me = (authUser?.displayName ?? "").trim().toLowerCase();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (mineOnly && me && !c.assignees.some((a) => a.trim().toLowerCase() === me)) return false;
      if (tag && !(c.tags ?? []).includes(tag)) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        // By key or by the label people see ("follow-up" / "Follow up").
        (c.tags ?? []).some((t) => t.toLowerCase().includes(q) || (TAG_BY_KEY[t]?.label ?? "").toLowerCase().includes(q)) ||
        c.assignees.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [cards, search, mineOnly, me, tag]);

  // How many tasks carry each tag, for the filter row.
  const tagCounts = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of cards) for (const t of c.tags ?? []) n[t] = (n[t] ?? 0) + 1;
    return n;
  }, [cards]);

  const move = useCallback(async (card: KanbanCard, column: KanbanColumn) => {
    // Optimistic: the board should answer the click, not the network.
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, column } : c)));
    await updateTask(card.id, { column, columnSetAt: new Date().toISOString() });
  }, []);

  return (
    <div>
      <Header
        title="Tasks"
        subtitle="What is on, who has it, and what is overdue"
        actions={
          <button
            onClick={() => setAdding("backlog")}
            className="flex items-center gap-2 bg-[#0a0a0a] text-white text-sm font-medium px-4 h-9 rounded-lg hover:bg-[#333] transition-colors"
          >
            <Plus className="w-4 h-4" />
            New task
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#999] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks"
            className="w-full text-sm bg-white border border-[#eaeaea] rounded-lg pl-9 pr-3 h-9 outline-none focus:border-[#0070f3] transition-colors"
          />
        </div>
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={`text-xs font-medium px-3 h-9 rounded-lg border transition-colors ${
            mineOnly
              ? "border-[#0070f3] bg-[#eff6ff] text-[#0070f3]"
              : "border-[#eaeaea] bg-white text-[#444] hover:bg-[#fafafa]"
          }`}
        >
          Only mine
        </button>
      </div>

      {/* The same tags as Messages: one click shows only those tasks. */}
      <div className="flex items-center gap-1.5 mb-5 -mt-2 overflow-x-auto pb-1">
        <span className="text-[11px] font-medium text-fg-subtle mr-1 shrink-0">Tags</span>
        {MESSAGE_TAGS.map((t) => {
          const on = tag === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTag(on ? "" : t.key)}
              aria-pressed={on}
              className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                on ? `${t.className} border-transparent` : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
              {t.label}
              {tagCounts[t.key] ? <span className="tabular-nums opacity-70">{tagCounts[t.key]}</span> : null}
            </button>
          );
        })}
        {tag && (
          <button onClick={() => setTag("")} className="shrink-0 text-xs text-fg-subtle hover:text-fg px-2">Clear</button>
        )}
      </div>

      {loading ? (
        <div className="bg-white border border-[#eaeaea] rounded-xl p-12 text-center">
          <RefreshCw className="w-5 h-5 animate-spin text-[#999] mx-auto mb-3" />
          <p className="text-sm text-[#666]">Loading the board…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {COLUMNS.map((col) => {
            const inColumn = visible.filter((c) => c.column === col.key);
            return (
              <section key={col.key} className="bg-white border border-[#eaeaea] rounded-xl flex flex-col min-h-40">
                <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#f0f0f0]">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${col.tone}`}>
                      {col.label}
                    </span>
                    <span className="text-[11px] text-[#bbb]">{inColumn.length}</span>
                  </div>
                  <button
                    onClick={() => setAdding(col.key)}
                    data-tip={`Add to ${col.label}`}
                    className="flex items-center justify-center w-6 h-6 rounded-md text-[#bbb] hover:text-[#0070f3] hover:bg-[#fafafa] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </header>

                <div className="p-2.5 space-y-2">
                  {inColumn.length === 0 && (
                    <p className="text-[11px] text-[#bbb] text-center py-6">Nothing here.</p>
                  )}
                  {inColumn.map((card) => {
                    const due = dueLabel(card);
                    return (
                      <article
                        key={card.id}
                        className="rounded-lg border border-[#eaeaea] p-3 hover:border-[#d4d4d4] transition-colors"
                      >
                        <button onClick={() => setOpen(card)} className="w-full text-left">
                          <p className="text-sm font-medium text-[#0a0a0a] leading-snug">{card.title}</p>
                          {card.description && (
                            <p className="text-[11px] text-[#999] mt-1 line-clamp-2">{card.description}</p>
                          )}
                          {(card.tags ?? []).length > 0 && <div className="mt-2"><TagChips tags={card.tags} /></div>}
                        </button>

                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY[card.priority] ?? PRIORITY.low}`}>
                            {card.priority}
                          </span>
                          <span className={`text-[10px] ${due.late ? "text-[#b91c1c] font-medium" : "text-[#999]"}`}>
                            {due.text}
                          </span>
                          {card.conversation && (
                            <Link
                              href={`/messages?session=${encodeURIComponent(card.conversation.sessionId)}`}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-blue bg-tint-blue rounded px-1.5 py-0.5 hover:opacity-80"
                              title={`Open the conversation with ${card.conversation.name}`}
                            >
                              <MessageSquare className="w-2.5 h-2.5" /> Conversation
                            </Link>
                          )}
                          {card.assignees.slice(0, 2).map((a) => (
                            <span key={a} className="text-[10px] text-[#666] bg-[#fafafa] rounded px-1.5 py-0.5">
                              {a}
                            </span>
                          ))}
                        </div>

                        {/* Moving a card without dragging it: unglamorous,
                            and it works on a phone, which drag and drop
                            does not. */}
                        <div className="mt-2">
                          <Select
                            value={card.column}
                            onChange={(v) => move(card, v as KanbanColumn)}
                            options={COLUMNS.map((c) => ({ value: c.key, label: `Move to ${c.label}` }))}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <AddTaskDrawer
        open={adding !== null}
        defaultColumn={adding ?? "backlog"}
        onClose={() => setAdding(null)}
        onAdd={async (card) => {
          await addTask({ ...card, createdBy: authUser?.accessEmployeeId ?? undefined });
          setAdding(null);
        }}
      />

      <TaskDetailDrawer
        card={open}
        open={open !== null}
        onClose={() => setOpen(null)}
        onUpdate={async (id, patch) => { await updateTask(id, patch); }}
        onDelete={async (id) => { await removeTask(id); setOpen(null); }}
      />
    </div>
  );
}
