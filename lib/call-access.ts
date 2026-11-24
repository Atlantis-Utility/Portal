import "server-only";
import { ApiAuthError, requireEmployee, requirePageAccess, type EmployeeActor } from "@/lib/api-auth";
import { extensionFor } from "@/lib/phone";

/**
 * Who may open a call's recording and transcript: anyone holding the Inbox
 * page (it shows every extension's calls), or the person whose own
 * extension was on the call (the phone's Recents).
 */
export async function requireCallAccess(extensions: string[]): Promise<EmployeeActor> {
  try {
    return await requirePageAccess("/inbox");
  } catch (err) {
    if (!(err instanceof ApiAuthError) || err.status !== 403) throw err;
    const actor = await requireEmployee();
    const mine = await extensionFor(actor.email);
    if (mine && extensions.includes(mine)) return actor;
    throw err;
  }
}
