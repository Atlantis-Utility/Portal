"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/layout/Header";
import AddTaskDrawer, { type KanbanCard, type KanbanColumn } from "@/components/tasks/AddTaskDrawer";
import TaskDetailDrawer from "@/components/tasks/TaskDetailDrawer";
import { subscribeTasks, addTask, updateTask, removeTask } from "@/lib/db/tasks";
import { useAuth } from "@/lib/auth-context";
import { Plus, Search, RefreshCw } from "lucide-react";

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
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        c.assignees.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [cards, search, mineOnly, me]);

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
                        </button>

                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY[card.priority] ?? PRIORITY.low}`}>
                            {card.priority}
                          </span>
                          <span className={`text-[10px] ${due.late ? "text-[#b91c1c] font-medium" : "text-[#999]"}`}>
                            {due.text}
                          </span>
                          {card.assignees.slice(0, 2).map((a) => (
                            <span key={a} className="text-[10px] text-[#666] bg-[#fafafa] rounded px-1.5 py-0.5">
                              {a}
                            </span>
                          ))}
                        </div>

                        {/* Moving a card without dragging it: unglamorous,
                            and it works on a phone, which drag and drop
                            does not. */}
                        <select
                          value={card.column}
                          onChange={(e) => move(card, e.target.value as KanbanColumn)}
                          className="mt-2 w-full text-[11px] text-[#666] bg-[#fafafa] border border-[#eaeaea] rounded-md px-2 py-1 outline-none focus:border-[#0070f3] transition-colors"
                        >
                          {COLUMNS.map((c) => (
                            <option key={c.key} value={c.key}>Move to {c.label}</option>
                          ))}
                        </select>
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
