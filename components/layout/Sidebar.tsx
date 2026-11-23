"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, X, Sun, Moon } from "lucide-react";
import { NAV_PAGES } from "@/lib/nav-pages";
import { ACCENT, areaFor } from "@/lib/areas";
import { useTheme } from "@/lib/theme-context";
import BrandMark from "@/components/ui/BrandMark";

interface NavItem {
  label: string;
  href: string;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  allowedHrefs?: string[]; // undefined = admin, show all
  userDisplayName?: string;
  userInitials?: string;
  userSubtext?: string;
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
  href, label, active, collapsed, onClick,
}: { href: string; label: string; active: boolean; collapsed: boolean; onClick?: () => void }) {
  const area = areaFor(href);
  const accent = ACCENT[area.accent];
  const Icon = area.icon;
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center rounded-lg transition-colors ${
        collapsed ? "w-10 h-10 mx-auto justify-center" : "gap-2.5 px-2 py-1.5 w-full"
      } ${active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg"}`}
    >
      {/* The accent bar marks where you are. */}
      {active && !collapsed && <span className={`absolute -left-2 top-1.5 bottom-1.5 w-0.75 rounded-r ${accent.bar}`} />}
      <span
        className={`flex items-center justify-center w-7 h-7 rounded-md shrink-0 transition-colors ${
          active ? accent.tile : `text-fg-subtle ${accent.hoverInk}`
        }`}
      >
        <Icon className="w-4 h-4" />
      </span>
      {!collapsed && <span className="text-[13px] font-medium leading-none whitespace-nowrap flex-1">{label}</span>}
      {collapsed && <RailTip>{label}</RailTip>}
      {collapsed && active && <span className={`absolute -right-0.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full ${accent.bar}`} />}
    </Link>
  );
}

export default function Sidebar({
  collapsed, onToggle, mobileOpen = false, onMobileClose, allowedHrefs,
  userDisplayName = "", userInitials = "", userSubtext = "",
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
      {/* Desktop collapse toggle */}
      <button
        onClick={onToggle}
        className="hidden md:flex absolute -right-3 top-5 w-6 h-6 rounded-full bg-surface border border-line-strong items-center justify-center shadow-sm hover:shadow-md transition-all z-50 text-fg-muted hover:text-fg"
        data-tip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>

      <aside className="h-full w-full bg-surface border-r border-line flex flex-col overflow-hidden">
        {/* Brand */}
        <div className={`h-14 flex items-center shrink-0 ${collapsed ? "justify-center" : "px-4"}`}>
          <Link href="/" className="flex items-center gap-2.5 min-w-0" onClick={onMobileClose} data-tip={collapsed ? "Atlantis Portal" : undefined}>
            <BrandMark size={32} />
            {!collapsed && (
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg leading-tight whitespace-nowrap">Atlantis Portal</span>
                <span className="block text-[11px] text-fg-subtle leading-tight whitespace-nowrap">Atlantis Utility</span>
              </span>
            )}
          </Link>
          {!collapsed && (
            <button
              onClick={onMobileClose}
              className="md:hidden ml-auto p-1.5 rounded-lg hover:bg-surface-3 transition-colors text-fg-muted"
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
                <p className="text-[10px] font-semibold text-fg-subtle uppercase tracking-[0.14em] px-2 mb-1.5">
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
            className={`group relative flex items-center rounded-lg transition-colors text-fg-muted hover:bg-surface-2 hover:text-fg ${
              collapsed ? "w-10 h-10 mx-auto justify-center" : "gap-2.5 px-2 py-1.5 w-full"
            }`}
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-md text-fg-subtle group-hover:text-ink-amber">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
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
            <span className="w-8 h-8 rounded-full bg-linear-to-br from-ink-indigo to-ink-violet flex items-center justify-center shrink-0 ring-2 ring-surface">
              <span className="text-[11px] font-semibold text-white">{userInitials || "?"}</span>
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
