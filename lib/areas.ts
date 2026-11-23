import {
  LayoutDashboard, MessageSquare, Workflow, BookUser, Users, CalendarDays, KanbanSquare,
  StickyNote, Plug, ScrollText, Settings2, UserCircle, Circle,
} from "lucide-react";

/**
 * Each area of the app owns one accent colour, so colour carries meaning:
 * Messages is always blue, Workflows always violet. Used by the sidebar,
 * the top bar and every page header.
 *
 * Class strings are written out in full (not built from the accent name)
 * because Tailwind only generates classes it can find literally in source.
 */
export type Accent =
  | "indigo" | "blue" | "violet" | "teal" | "cyan" | "amber"
  | "orange" | "green" | "pink" | "rose" | "slate";

export const ACCENT: Record<Accent, { tile: string; ink: string; hoverInk: string; bar: string; soft: string; ring: string; cssInk: string }> = {
  indigo: {
    tile: "bg-tint-indigo text-ink-indigo", ink: "text-ink-indigo", hoverInk: "group-hover:text-ink-indigo",
    bar: "bg-ink-indigo", soft: "bg-tint-indigo", ring: "ring-ink-indigo/30", cssInk: "var(--ink-indigo)",
  },
  blue: {
    tile: "bg-tint-blue text-ink-blue", ink: "text-ink-blue", hoverInk: "group-hover:text-ink-blue",
    bar: "bg-ink-blue", soft: "bg-tint-blue", ring: "ring-ink-blue/30", cssInk: "var(--ink-blue)",
  },
  violet: {
    tile: "bg-tint-violet text-ink-violet", ink: "text-ink-violet", hoverInk: "group-hover:text-ink-violet",
    bar: "bg-ink-violet", soft: "bg-tint-violet", ring: "ring-ink-violet/30", cssInk: "var(--ink-violet)",
  },
  teal: {
    tile: "bg-tint-teal text-ink-teal", ink: "text-ink-teal", hoverInk: "group-hover:text-ink-teal",
    bar: "bg-ink-teal", soft: "bg-tint-teal", ring: "ring-ink-teal/30", cssInk: "var(--ink-teal)",
  },
  cyan: {
    tile: "bg-tint-cyan text-ink-cyan", ink: "text-ink-cyan", hoverInk: "group-hover:text-ink-cyan",
    bar: "bg-ink-cyan", soft: "bg-tint-cyan", ring: "ring-ink-cyan/30", cssInk: "var(--ink-cyan)",
  },
  amber: {
    tile: "bg-tint-amber text-ink-amber", ink: "text-ink-amber", hoverInk: "group-hover:text-ink-amber",
    bar: "bg-ink-amber", soft: "bg-tint-amber", ring: "ring-ink-amber/30", cssInk: "var(--ink-amber)",
  },
  orange: {
    tile: "bg-tint-orange text-ink-orange", ink: "text-ink-orange", hoverInk: "group-hover:text-ink-orange",
    bar: "bg-ink-orange", soft: "bg-tint-orange", ring: "ring-ink-orange/30", cssInk: "var(--ink-orange)",
  },
  green: {
    tile: "bg-tint-green text-ink-green", ink: "text-ink-green", hoverInk: "group-hover:text-ink-green",
    bar: "bg-ink-green", soft: "bg-tint-green", ring: "ring-ink-green/30", cssInk: "var(--ink-green)",
  },
  pink: {
    tile: "bg-tint-pink text-ink-pink", ink: "text-ink-pink", hoverInk: "group-hover:text-ink-pink",
    bar: "bg-ink-pink", soft: "bg-tint-pink", ring: "ring-ink-pink/30", cssInk: "var(--ink-pink)",
  },
  rose: {
    tile: "bg-tint-rose text-ink-rose", ink: "text-ink-rose", hoverInk: "group-hover:text-ink-rose",
    bar: "bg-ink-rose", soft: "bg-tint-rose", ring: "ring-ink-rose/30", cssInk: "var(--ink-rose)",
  },
  slate: {
    tile: "bg-tint-slate text-ink-slate", ink: "text-ink-slate", hoverInk: "group-hover:text-ink-slate",
    bar: "bg-ink-slate", soft: "bg-tint-slate", ring: "ring-ink-slate/30", cssInk: "var(--ink-slate)",
  },
};

export interface Area {
  href: string;
  accent: Accent;
  icon: React.ElementType;
}

export const AREAS: Area[] = [
  { href: "/",             accent: "indigo", icon: LayoutDashboard },
  { href: "/messages",     accent: "blue",   icon: MessageSquare },
  { href: "/workflows",    accent: "violet", icon: Workflow },
  { href: "/contacts",     accent: "cyan",   icon: BookUser },
  { href: "/employees",    accent: "orange", icon: Users },
  { href: "/calendar",     accent: "amber",  icon: CalendarDays },
  { href: "/tasks",        accent: "rose",   icon: KanbanSquare },
  { href: "/notes",        accent: "pink",   icon: StickyNote },
  { href: "/integrations", accent: "teal",   icon: Plug },
  { href: "/logs",         accent: "slate",  icon: ScrollText },
  { href: "/settings",     accent: "slate",  icon: Settings2 },
  { href: "/account",      accent: "slate",  icon: UserCircle },
];

/** The area a path belongs to: the longest matching href. */
export function areaFor(pathname: string): Area {
  const match = AREAS
    .filter((a) => (a.href === "/" ? pathname === "/" : pathname === a.href || pathname.startsWith(`${a.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ?? { href: pathname, accent: "slate", icon: Circle };
}
