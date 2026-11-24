"use client";

import { X } from "lucide-react";
import { MESSAGE_TAGS, TAG_BY_KEY } from "@/lib/message-tags";

/**
 * Tags shared by conversations and tasks: one fixed set (lib/message-tags),
 * so "Follow up" on a text and "Follow up" on a task are the same thing and
 * filter together. Tags typed freely before this existed are kept and shown
 * in grey, removable, so nothing already saved disappears.
 */

export function TagPicker({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const set = new Set(value);
  const legacy = value.filter((t) => !TAG_BY_KEY[t]);
  const toggle = (key: string) => onChange(set.has(key) ? value.filter((t) => t !== key) : [...value, key]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {MESSAGE_TAGS.map((t) => {
        const on = set.has(t.key);
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => toggle(t.key)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              on ? `${t.className} border-transparent` : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            {t.label}
          </button>
        );
      })}
      {legacy.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-surface-3 text-fg-muted">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="hover:text-fg">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** A task's or conversation's tags as small coloured chips. */
export function TagChips({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (!tags?.length) return null;
  const shown = tags.slice(0, max);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((key) => {
        const t = TAG_BY_KEY[key];
        return (
          <span key={key} className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded-md ${t ? t.className : "bg-surface-3 text-fg-muted"}`}>
            {t ? t.label : key}
          </span>
        );
      })}
      {tags.length > max && <span className="text-[10.5px] text-fg-subtle">+{tags.length - max}</span>}
    </span>
  );
}
