"use client";

import { supabase } from "@/lib/supabase/client";
import { TAG_BY_KEY } from "@/lib/message-tags";
import type { KanbanCard } from "@/components/tasks/AddTaskDrawer";
import { listThreadAnnotations } from "@/lib/db/message-threads";
import type { SmsConversation } from "@/lib/ringlogix-messages";
import { formatPhone } from "@/lib/utils";

/**
 * Tagging a conversation puts it on the Tasks board.
 *
 * One task per conversation (id "conv-<sessionId>"), kept in step with the
 * conversation's tags every time they're saved in Messages:
 *   tagged         the task exists, carrying the same tags
 *   Urgent         high priority
 *   Resolved       moved to Done (and back to Backlog if Resolved comes off)
 *   no tags left   the task is removed - only ever one made this way
 * Anything someone changed on the task itself (column, assignees, due date,
 * title) is kept; only the tags and what they imply are rewritten.
 *
 * The board subscribes to the tasks table, so it shows up there live.
 */

const TABLE = "tasks";
export const conversationTaskId = (sessionId: string) => `conv-${sessionId}`;

export async function syncConversationTask(
  conv: { sessionId: string; name: string; number?: string },
  tags: string[],
  actor: { name: string; employeeId?: string | null },
): Promise<"created" | "updated" | "removed" | "none"> {
  const id = conversationTaskId(conv.sessionId);
  const known = tags.filter((t) => TAG_BY_KEY[t]);
  const { data: row, error: readErr } = await supabase.from(TABLE).select("data").eq("id", id).maybeSingle();
  if (readErr) throw readErr;
  const existing = (row?.data as KanbanCard | undefined) ?? null;

  if (known.length === 0) {
    if (!existing?.conversation) return "none";
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) throw error;
    return "removed";
  }

  const resolved = known.includes("resolved");
  const urgent = known.includes("urgent");
  const now = new Date().toISOString();

  let card: KanbanCard;
  if (existing) {
    const column = resolved ? "done" : existing.column === "done" ? "backlog" : existing.column;
    card = {
      ...existing,
      tags: known,
      priority: urgent ? "high" : existing.priority === "high" && existing.tags?.includes("urgent") ? "medium" : existing.priority,
      column,
      ...(column !== existing.column ? { columnSetAt: now } : {}),
      conversation: { ...conv },
    };
  } else {
    card = {
      id,
      type: "task",
      title: `Follow up with ${conv.name}`,
      description: `Tagged in Messages${conv.number ? ` · ${conv.number}` : ""}.`,
      column: resolved ? "done" : "backlog",
      priority: urgent ? "high" : "medium",
      assignees: actor.name ? [actor.name] : [],
      dueDate: "",
      dueDateTbd: true,
      tags: known,
      createdBy: actor.employeeId ?? undefined,
      conversation: { ...conv },
    };
  }
  const { error } = await supabase.from(TABLE).upsert({ id, due_date: card.dueDate || null, data: card });
  if (error) throw error;
  return existing ? "updated" : "created";
}

/**
 * Brings the board in line with every conversation's tags, not just the
 * ones changed since this existed: a tagged conversation without its task
 * gets one, a task whose conversation has no tags left goes. Run when the
 * Tasks page opens. Cheap when nothing's out of step (two small reads).
 */
export async function reconcileConversationTasks(actor: { name: string; employeeId?: string | null }): Promise<number> {
  const annotations = await listThreadAnnotations();
  const { data: rows, error } = await supabase.from(TABLE).select("id, data").like("id", "conv-%");
  if (error) throw error;
  const existing = new Map((rows ?? []).map((r) => [r.id as string, r.data as KanbanCard]));

  const work: Array<{ sessionId: string; tags: string[]; by: string }> = [];
  for (const a of Object.values(annotations)) {
    const tags = a.tags.filter((t) => TAG_BY_KEY[t]);
    if (!tags.length) continue;
    const task = existing.get(conversationTaskId(a.sessionId));
    const same = task && [...(task.tags ?? [])].sort().join() === [...tags].sort().join();
    if (!same) work.push({ sessionId: a.sessionId, tags, by: a.updatedBy });
  }
  for (const [id, task] of existing) {
    const sessionId = id.slice("conv-".length);
    if (!task.conversation) continue;
    const a = annotations[sessionId];
    if (!a || a.tags.filter((t) => TAG_BY_KEY[t]).length === 0) work.push({ sessionId, tags: [], by: "" });
  }
  if (!work.length) return 0;

  const names = await conversationNames(work.filter((w) => w.tags.length).map((w) => w.sessionId));
  for (const w of work) {
    const who = names.get(w.sessionId);
    await syncConversationTask(
      { sessionId: w.sessionId, name: who?.name ?? "a conversation", number: who?.number },
      w.tags,
      { name: w.by || actor.name, employeeId: actor.employeeId },
    );
  }
  return work.length;
}

/** Who each conversation is with: from the copy Messages keeps, else fetched. */
async function conversationNames(sessionIds: string[]): Promise<Map<string, { name: string; number?: string }>> {
  const out = new Map<string, { name: string; number?: string }>();
  if (!sessionIds.length) return out;
  type Inbox = { conversations?: SmsConversation[]; names?: Record<string, string>; contacts?: Record<string, { name: string }> };
  let data: Inbox | null = null;
  try {
    const raw = sessionStorage.getItem("sc:inbox-v1");
    data = raw ? (JSON.parse(raw) as Inbox) : null;
  } catch { /* fetched below */ }
  const have = new Set((data?.conversations ?? []).map((c) => c.sessionId));
  if (!data || sessionIds.some((id) => !have.has(id))) {
    data = await fetch("/api/ringlogix/messages").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  for (const c of data?.conversations ?? []) {
    if (!sessionIds.includes(c.sessionId)) continue;
    const raw = c.remoteNumbers?.[0] ?? c.remote;
    const number = c.isGroup ? "" : formatPhone(raw) || raw;
    const name = c.name
      || (c.remoteExtension ? data?.names?.[c.remoteExtension] ?? `Extension ${c.remoteExtension}` : "")
      || data?.contacts?.[(raw ?? "").slice(-10)]?.name
      || number
      || "a conversation";
    out.set(c.sessionId, { name, number: number || undefined });
  }
  return out;
}
