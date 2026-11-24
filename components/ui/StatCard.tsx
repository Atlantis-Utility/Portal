"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The one KPI card used across the app: the icon and the number on one
 * line, the label under the number, an optional hint under that.
 *
 *   [icon]  114
 *           Need a reply
 *
 * A link (href), a button (onClick) or plain; `active` rings it when it's
 * the filter in force, `alert` adds a small pulsing dot.
 */

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  /** Tint + ink classes for the icon tile, e.g. "bg-tint-blue text-ink-blue". */
  tone: string;
  hint?: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  alert?: boolean;
  /** Shows a placeholder where the number goes. */
  loading?: boolean;
}

export default function StatCard({ label, value, icon: Icon, tone, hint, href, onClick, active, alert, loading }: StatCardProps) {
  const interactive = Boolean(href || onClick);
  const body = (
    <>
      <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
        <Icon className="w-5 h-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {loading
            ? <span className="inline-block w-10 h-6 rounded bg-surface-3 animate-pulse" />
            : <span className="text-2xl font-semibold text-fg tabular-nums leading-none tracking-tight truncate">{value}</span>}
          {alert && <span className="w-2 h-2 rounded-full bg-[#f31260] animate-pulse shrink-0" aria-hidden />}
        </span>
        <span className="block text-[13px] font-medium text-fg-muted mt-1 truncate">{label}</span>
        {hint && <span className="block text-[11px] text-fg-subtle truncate">{hint}</span>}
      </span>
      {interactive && <ArrowRight className="w-4 h-4 text-fg-subtle opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0" />}
    </>
  );
  const cls = `group flex items-center gap-3.5 text-left bg-surface border rounded-2xl px-4 py-3.5 transition-all ${
    active ? "border-fg ring-1 ring-fg" : "border-line"
  } ${interactive ? "hover:border-line-strong hover:shadow-sm" : ""}`;
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}
