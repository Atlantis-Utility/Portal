"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";
import { Menu, Bell, LogOut, User, ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getUnreadCount } from "@/lib/notifications";
import { expandAccess, hasPageAccess, NAV_PAGES } from "@/lib/nav-pages";
import { ACCENT, areaFor } from "@/lib/areas";
import { useAuth } from "@/lib/auth-context";
import { getInitials } from "@/lib/utils";
import { useUnreadMessages, useUnreadPoller } from "@/lib/unread-messages";
import { PhoneProvider } from "@/components/phone/PhoneProvider";
import PhoneWidget from "@/components/phone/PhoneWidget";

// Notifications live in localStorage and announce themselves with an
// "app-notification" event, so the unread count is read as an external store.
function subscribeNotifications(onChange: () => void) {
  window.addEventListener("app-notification", onChange);
  return () => window.removeEventListener("app-notification", onChange);
}

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authUser, logout } = useAuth();

  // AuthGuard renders a spinner until sign-in resolves, so this shell never
  // hydrates against server HTML and can read localStorage straight away.
  const [collapsed, setCollapsed]       = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen]     = useState(false);

  // Page-access permissions come live from auth-context (backed by a Supabase
  // realtime subscription on the employee row) — not a localStorage snapshot,
  // so changes an admin makes elsewhere take effect immediately.
  // The dashboard is everyone's (lib/nav-pages.ts), so it belongs in the
  // sidebar whatever the grant list says: without this, somebody granted
  // only Leads stood on the dashboard with no link to it in the nav.
  const allowedHrefs = authUser?.access ? [...new Set(["/", ...expandAccess(authUser.access)])] : undefined;

  // The bell used to go to the Logs feed unconditionally, which 404s for
  // anybody not granted Logs. The dashboard's own notification panel is the
  // fallback, since the dashboard is everyone's.
  const notificationsHref = hasPageAccess("/logs", authUser?.access) ? "/logs?filter=notifications" : "/";

  // The badge counts what this person is allowed to read, so it can't send
  // them to a feed where the thing it counted isn't shown — and it counts
  // nothing until the grants have resolved, rather than counting everything
  // for a moment.
  const access = authUser?.access;
  // The badge on Messages: polled while signed in and allowed to see it.
  useUnreadPoller(Boolean(authUser) && hasPageAccess("/messages", access));
  const unreadMessages = useUnreadMessages();
  const signedIn = Boolean(authUser);
  const unreadCount = useSyncExternalStore(
    subscribeNotifications,
    () => (signedIn ? getUnreadCount(access) : 0),
    () => 0,
  );

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayName = authUser?.displayName ?? "User";
  const userEmail   = authUser?.email ?? "";

  const area = areaFor(pathname);
  const accent = ACCENT[area.accent];
  const pageLabel =
    NAV_PAGES.find((p) => p.href === area.href)?.label ??
    (area.href === "/account" ? "My profile" : "");
  const initials = getInitials(displayName);

  const bell = (
    <Link
      href={notificationsHref}
      className="relative flex items-center justify-center w-9 h-9 rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors"
      aria-label="Notifications"
    >
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-ink-rose text-white text-[9px] font-bold flex items-center justify-center leading-none ring-2 ring-surface">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );

  return (
    // The phone sits above the pages, so a call survives moving between them.
    <PhoneProvider enabled={signedIn}>
    <div
      className="flex h-screen overflow-hidden bg-canvas"
      style={{ "--area-ink": accent.cssInk } as React.CSSProperties}
    >
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-30 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        allowedHrefs={allowedHrefs}
        userDisplayName={displayName}
        userInitials={initials}
        userSubtext={authUser?.employeeAccessRole || (authUser?.isAdmin ? "Administrator" : "Contributor")}
        unreadMessages={unreadMessages}
      />

      <main
        className={`relative flex-1 flex flex-col min-h-0 overflow-hidden transition-[margin] duration-200 ease-in-out ${
          collapsed ? "md:ml-17" : "md:ml-64"
        }`}
      >
        {/* The area's colour, as a soft glow behind the top of the page. */}
        <div className="area-glow pointer-events-none absolute inset-x-0 top-0 h-72 z-0" aria-hidden />

        {/* ── Top bar ── */}
        <header className="relative z-20 shrink-0 flex items-center gap-3 h-14 px-3 md:px-6 border-b border-line bg-surface/70 backdrop-blur-xl">
          {/* Left: navigation toggle, then search. */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-fg hover:bg-surface-3 transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={toggle}
            className="hidden md:flex items-center justify-center w-9 h-9 rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors shrink-0"
            data-tip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="w-4.5 h-4.5" /> : <PanelLeftClose className="w-4.5 h-4.5" />}
          </button>
          <div className="hidden md:block w-full max-w-md">
            <GlobalSearch allowedHrefs={allowedHrefs} />
          </div>

          {/* Right: notifications and you, pinned to the edge. */}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            {bell}
            <span className="hidden sm:block w-px h-6 bg-line mx-2" aria-hidden />
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className="flex items-center gap-2.5 rounded-lg hover:bg-surface-3 pl-1 pr-2 py-1 transition-colors"
                aria-label="Your account"
              >
                <span className="w-8 h-8 rounded-full bg-fg flex items-center justify-center shrink-0">
                  <span className="text-surface text-[11px] font-semibold">{initials}</span>
                </span>
                <span className="hidden lg:block text-left min-w-0 max-w-44">
                  <span className="block text-[13px] font-medium text-fg leading-tight truncate">{displayName}</span>
                  <span className="block text-[11px] text-fg-subtle leading-tight truncate">{userEmail}</span>
                </span>
                <ChevronDown className={`hidden sm:block w-3.5 h-3.5 text-fg-subtle transition-transform ${profileOpen ? "rotate-180" : ""}`} />
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-line rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-line flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-fg flex items-center justify-center shrink-0">
                      <span className="text-surface text-xs font-semibold">{initials}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg truncate">{displayName}</span>
                      <span className="block text-[11px] text-fg-subtle truncate">{userEmail}</span>
                    </span>
                  </div>
                  <div className="p-1">
                    <Link
                      href="/account"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-fg hover:bg-surface-3 transition-colors"
                    >
                      <User className="w-4 h-4 text-fg-muted" /> Your profile
                    </Link>
                    <button
                      onClick={() => { setProfileOpen(false); handleLogout(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-ink-rose hover:bg-tint-rose transition-colors"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Search gets its own row on phones, where the bar has no room. */}
        <div className="md:hidden relative z-10 px-3 py-2.5 border-b border-line bg-surface/70 backdrop-blur-xl">
          <GlobalSearch allowedHrefs={allowedHrefs} />
        </div>

        <div className="relative z-10 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          <div className="w-full">
            {pageLabel && (
              <p className="text-xs text-fg-subtle mb-5">
                Atlantis Portal <span className="mx-1 text-line-strong">/</span>{" "}
                <span className="text-fg-muted">{pageLabel}</span>
              </p>
            )}
            {children}
          </div>
        </div>
      </main>
    </div>
    <PhoneWidget />
    </PhoneProvider>
  );
}
