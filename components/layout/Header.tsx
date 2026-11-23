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
 * The title block at the top of a page: plain text. The area's colour and
 * icon already show in the sidebar and the top bar's breadcrumb, so the
 * title doesn't repeat them.
 */
export default function Header({ title, subtitle, actions, compact, className }: HeaderProps) {
  const margin = className ?? (compact ? "mb-4" : "mb-6 md:mb-8");
  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${margin}`}>
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="text-sm text-fg-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
