"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Sun, Moon } from "lucide-react";
import { NAV_PAGES } from "@/lib/nav-pages";
import { ACCENT, areaFor } from "@/lib/areas";
import { useTheme } from "@/lib/theme-context";

interface NavItem {
  label: string;
  href: string;
}

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  allowedHrefs?: string[]; // undefined = admin, show all
  userDisplayName?: string;
  userInitials?: string;
  userSubtext?: string;
  /** Unread texts, shown on Messages. */
  unreadMessages?: number;
}

// Built from NAV_PAGES rather than kept as its own list, so a page can't be
// in the access list and missing here (or the other way round). Settings
// lives in the footer, so it is left out of the sections.
const navSections: { label: string; items: NavItem[] }[] = [];
for (const page of NAV_PAGES) {
  if (page.href === "/settings") continue;
  let section = navSections.find((s) => s.label === page.section);
  if (!section) navSections.push((section = { label: page.section, items: [] }));
  section.items.push({ label: page.label, href: page.href });
}

/** The floating label a collapsed rail shows on hover. */
function RailTip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-full ml-3 px-2 py-1.5 bg-[#111] text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg">
      {children}
    </span>
  );
}

function NavLink({
  href, label, active, collapsed, onClick, badge = 0,
}: { href: string; label: string; active: boolean; collapsed: boolean; onClick?: () => void; badge?: number }) {
  const area = areaFor(href);
  const Icon = area.icon;
  const tone = ACCENT[area.accent];
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center rounded-lg transition-colors ${
        collapsed ? "w-10 h-10 mx-auto justify-center" : "gap-2.5 px-2 py-1.5 w-full"
      } ${active ? "bg-surface-3 text-fg font-semibold" : "text-fg font-medium hover:bg-surface-2"}`}
    >
      {/* Each area's own colour, softly: a tinted tile behind the icon. */}
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${tone.tile} ${active ? "ring-1 " + tone.ring : ""}`}>
        <Icon className="w-[15px] h-[15px]" />
      </span>
      {!collapsed && <span className="text-[13.5px] leading-none whitespace-nowrap flex-1">{label}</span>}
      {!collapsed && badge > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-fg text-surface text-[10px] font-semibold flex items-center justify-center tabular-nums">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {collapsed && badge > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-fg ring-2 ring-surface" />}
      {collapsed && <RailTip>{badge > 0 ? `${label} · ${badge} unread` : label}</RailTip>}
    </Link>
  );
}

export default function Sidebar({
  collapsed, mobileOpen = false, onMobileClose, allowedHrefs,
  userDisplayName = "", userInitials = "", userSubtext = "", unreadMessages = 0,
}: SidebarProps) {
  const pathname = usePathname();
  const { isDark, toggleTheme } = useTheme();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !allowedHrefs || allowedHrefs.includes(item.href)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div
      className={[
        "fixed top-0 left-0 h-full z-40 w-64 transition-[width,transform] duration-200 ease-in-out",
        collapsed ? "md:w-17" : "md:w-64",
        "md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      <aside className="h-full w-full bg-surface border-r border-line flex flex-col overflow-hidden">
        {/* Brand */}
        <div className="relative h-14 flex items-center justify-center shrink-0 px-4">
          <Link href="/" onClick={onMobileClose} className="min-w-0" data-tip={collapsed ? "Atlantis Portal" : undefined}>
            {collapsed ? (
              <span className="text-base font-bold text-fg">AP</span>
            ) : (
              <span className="text-lg font-bold tracking-tight text-fg whitespace-nowrap">Atlantis Portal</span>
            )}
          </Link>
          {!collapsed && (
            <button
              onClick={onMobileClose}
              className="md:hidden absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-surface-3 transition-colors text-fg-muted"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
          {visibleSections.map((section, i) => (
            <div key={section.label || i} className="pt-3">
              {!collapsed ? (
                <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.14em] px-2 mb-1.5">
                  {section.label}
                </p>
              ) : (
                i > 0 && <div className="h-px bg-line mx-3 mb-2" />
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      href={item.href}
                      label={item.label}
                      active={isActive(item.href)}
                      collapsed={collapsed}
                      onClick={onMobileClose}
                      badge={item.href === "/messages" ? unreadMessages : 0}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer: settings, theme, you */}
        <div className="border-t border-line p-2 space-y-0.5 shrink-0">
          <NavLink href="/settings" label="Settings" active={isActive("/settings")} collapsed={collapsed} onClick={onMobileClose} />
          <button
            onClick={toggleTheme}
            className={`group relative flex items-center rounded-lg transition-colors text-fg hover:bg-surface-2 ${
              collapsed ? "w-10 h-10 mx-auto justify-center" : "gap-2.5 px-2.5 py-2 w-full"
            }`}
          >
            <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-tint-slate text-ink-slate">
              {isDark ? <Sun className="w-[15px] h-[15px]" /> : <Moon className="w-[15px] h-[15px]" />}
            </span>
            {!collapsed && <span className="text-[13px] font-medium">{isDark ? "Light mode" : "Dark mode"}</span>}
            {collapsed && <RailTip>{isDark ? "Light mode" : "Dark mode"}</RailTip>}
          </button>

          <Link
            href="/account"
            onClick={onMobileClose}
            className={`group relative flex items-center rounded-xl transition-colors hover:bg-surface-2 mt-1 ${
              collapsed ? "w-10 h-10 mx-auto justify-center" : "gap-2.5 p-2 w-full border border-line bg-surface-2"
            }`}
          >
            <span className="w-8 h-8 rounded-full bg-fg flex items-center justify-center shrink-0">
              <span className="text-[11px] font-semibold text-surface">{userInitials || "?"}</span>
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-fg truncate leading-tight">{userDisplayName}</span>
                <span className="block text-[11px] text-fg-subtle truncate leading-tight mt-0.5">{userSubtext}</span>
              </span>
            )}
            {collapsed && <RailTip>My profile</RailTip>}
          </Link>
        </div>
      </aside>
    </div>
  );
}
