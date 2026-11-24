"use client";

import { supabase } from "@/lib/supabase/client";
import { TAG_BY_KEY } from "@/lib/message-tags";
import type { KanbanCard } from "@/components/tasks/AddTaskDrawer";

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
