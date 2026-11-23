export interface NavPage {
  href: string;
  label: string;
  section: string;
}

// This list is the access-control surface, not just a nav menu: AuthGuard
// treats any route missing from it as ungated (`isAllowed` returns true when
// no entry matches), and EditEmployeeDrawer only offers checkboxes for what's
// here. A new page under app/(dashboard) must be added or it is reachable by
// everyone regardless of their grants.
//
// Sections are the grouping the Edit Employee drawer shows, so they're named
// for the job a person does rather than the system a page happens to talk to:
// an admin granting access thinks "this person does sales", not "this person
// needs the RingLogix API". Grants are stored as hrefs, so regrouping or
// renaming a section never invalidates an existing grant.
//
// Nesting matters: AuthGuard matches the longest href, so "/leads/campaigns"
// is granted separately from "/leads" and covers "/leads/campaigns/<id>".
// Detail routes with no entry of their own inherit their parent
// ("/customers/123" is gated by "/customers").
//
// Deliberately absent: /account, which is the signed-in user's own profile and
// should never be revocable.
export const NAV_PAGES: NavPage[] = [
  { href: "/",           label: "Dashboard", section: "Workspace" },
  { href: "/messages",   label: "Messages",  section: "Workspace" },
  { href: "/workflows",  label: "Workflows", section: "Workspace" },

  { href: "/contacts",   label: "Contacts",  section: "People"    },
  { href: "/employees",  label: "Employees", section: "People"    },

  { href: "/calendar",   label: "Calendar",  section: "Work"      },
  { href: "/tasks",      label: "Tasks",     section: "Work"      },
  { href: "/notes",      label: "Notes",     section: "Work"      },

  { href: "/integrations", label: "Integrations", section: "Admin" },
  { href: "/logs",       label: "Logs",      section: "Admin"     },
  { href: "/settings",   label: "Settings",  section: "Admin"     },
];

export const ALL_HREFS = NAV_PAGES.map((p) => p.href);

/**
 * Mirrors AuthGuard's rule: `undefined` access means unrestricted, and a
 * route with no entry of its own is covered by the longest matching parent.
 * Use it to hide UI that leads somewhere the guard would 404 on, so a link
 * isn't offered and then refused.
 */
export function hasPageAccess(href: string, access: string[] | undefined): boolean {
  if (!access) return true;
  // The dashboard is everyone's. It's where every sign-in lands, and what
  // it shows is granted panel by panel instead (lib/dashboard-widgets.ts),
  // so withholding the page itself only ever produced a 404 on arrival.
  if (href === "/") return true;
  const page = NAV_PAGES.filter((p) =>
    p.href === "/" ? href === "/" : href === p.href || href.startsWith(`${p.href}/`)
  ).sort((a, b) => b.href.length - a.href.length)[0];
  if (!page) return true;
  return access.includes(page.href);
}

/**
 * The first page this person can actually open, in sidebar order.
 *
 * Signing in lands on "/", and "/" is a grantable page like any other: an
 * employee given only Leads and Settings was dropped on a dashboard they
 * aren't allowed to see, which rendered as a 404. Authenticating and then
 * being told the page doesn't exist reads as "I can't log in", which is
 * exactly how it was reported.
 */
export function firstAllowedPage(access: string[] | undefined): string | null {
  if (!access) return "/";
  const page = NAV_PAGES.find((p) => access.includes(p.href));
  return page?.href ?? null;
}
