"use client";

import { usePathname } from "next/navigation";
import { ACCENT, areaFor } from "@/lib/areas";

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** Tighter bottom margin, for pages that want the content below closer to the title. */
  compact?: boolean;
  /** Overrides the default/compact bottom margin entirely — for pages controlling their own spacing. */
  className?: string;
}

/**
 * The title block at the top of a page. Takes its icon and colour from the
 * area the page belongs to (lib/areas.ts), so every page is marked the same
 * way without passing anything in.
 */
export default function Header({ title, subtitle, actions, compact, className }: HeaderProps) {
  const pathname = usePathname();
  const area = areaFor(pathname);
  const accent = ACCENT[area.accent];
  const Icon = area.icon;
  const margin = className ?? (compact ? "mb-4" : "mb-6 md:mb-8");

  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${margin}`}>
      <div className="flex items-start gap-3.5 min-w-0">
        <span className={`hidden sm:flex items-center justify-center w-11 h-11 rounded-xl shrink-0 ring-1 ring-inset ${accent.tile} ${accent.ring}`}>
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl md:text-[26px] font-semibold tracking-tight text-fg leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-fg-muted mt-1">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
