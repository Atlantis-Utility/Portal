/**
 * Grants that live *inside* a page rather than deciding whether you reach it.
 *
 * Page access (lib/nav-pages.ts) is all-or-nothing: you hold /customers or
 * you don't. That isn't enough for money. Somebody who answers the phone
 * needs the customer, their contacts, their extensions and their circuits —
 * and has no business knowing what the account owes or what Atlantis pays
 * for the line. Before this, handing over the Customers page handed over
 * both.
 *
 * So: a page option is a second checkbox under the page it belongs to.
 * It only means anything to somebody who already holds that page, and it is
 * stored separately from `access` (employees.data.pageOptions) so nothing
 * that walks the grant list as a list of routes trips over it.
 *
 * Administrators hold every option by definition — the Employees page calls
 * that role "Administrator: Full access", and the drawer shows these ticked
 * and fixed for them, the same way it treats dashboard panels.
 */

export interface PageOption {
  /** Stored in employees.data.pageOptions. Never a route. */
  key: string;
  /** The NAV_PAGES href this hangs off; meaningless without that grant. */
  page: string;
  label: string;
  hint: string;
}



// None yet in this app. The mechanism is kept because a page option
// is the natural way to split a page's powers, and the first one will
// want it already here rather than invented in a hurry.
export const PAGE_OPTIONS: PageOption[] = [];

export const ALL_PAGE_OPTIONS: string[] = PAGE_OPTIONS.map((o) => o.key);

/**
 * What somebody holds when nothing has been recorded for them.
 *
 * An administrator holds everything, so nobody loses sight of the money the
 * day this ships. Anyone else holds nothing, because a grant you were never
 * given is not a grant.
 *
 * It is only a *default*. Once there is a list on the record, the list
 * decides - for administrators too. That is the same rule page access
 * already follows (see lib/auth-context.tsx): being an administrator settles
 * which records you can see, not which switches someone may turn off. An
 * administrator who ticks their own billing off should stop seeing billing,
 * which is also the only way to check what everyone else sees.
 */
export function defaultPageOptions(unrestricted: boolean): string[] {
  return unrestricted ? [...ALL_PAGE_OPTIONS] : [];
}

/**
 * Whether this person holds an option. The list is the whole answer: see
 * defaultPageOptions for what fills it in when the record is silent.
 */
export function hasPageOption(
  key: string,
  who: { pageOptions?: string[] } | null | undefined,
): boolean {
  return Boolean(who?.pageOptions?.includes(key));
}

/** The options that belong to one page, for grouping them under it. */
export function optionsForPage(href: string): PageOption[] {
  return PAGE_OPTIONS.filter((o) => o.page === href);
}

/** Whether a stored key is still one we recognise. */
export function isPageOption(key: string): boolean {
  return ALL_PAGE_OPTIONS.includes(key);
}
