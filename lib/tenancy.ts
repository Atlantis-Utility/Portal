import "server-only";
import { ourDomain } from "@/lib/ringlogix";

/**
 * Which RingLogix domain a request acts on.
 *
 * THE rule of the customer portal (docs/PORTAL-PLAN.md): the domain comes
 * from the signed-in user, never from the browser. Every route that talks
 * to the phone system calls this instead of reading a `domain` parameter,
 * so a customer who edits a request can't reach another customer's data -
 * nothing they send decides it.
 *
 * Phase 0: only Atlantis staff can sign in, and they work on Atlantis's
 * own domain. Phase 1 resolves a customer user's account here, and a staff
 * member's chosen "viewing as" account, validated against the accounts
 * table.
 */
export async function tenantDomain(): Promise<string> {
  return ourDomain();
}
