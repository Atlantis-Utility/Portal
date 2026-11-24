import { NextResponse } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { extensionFor, phoneLogin } from "@/lib/phone";
import { getErrorMessage } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The SIP login for the signed-in person's portal phone.
 *
 * Only ever their own: the extension comes from phone_extensions, which
 * only an administrator can set, never from the request. The password has
 * to reach the browser (that's what registers), so it's sent to nobody
 * else and never cached.
 */
export async function GET() {
  const noStore = { "Cache-Control": "no-store, private" };
  try {
    const actor = await requireEmployee();
    const extension = await extensionFor(actor.email);
    if (!extension) return NextResponse.json({ extension: null }, { headers: noStore });
    const login = await phoneLogin(extension, actor.name);
    return NextResponse.json(login, { headers: noStore });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = getErrorMessage(err, "Couldn't set up the phone");
    if (/phone_extensions/.test(message) && /does not exist|schema cache/.test(message)) {
      return NextResponse.json({ extension: null, setup: "Run supabase/migration-phone.sql to switch the phone on." }, { headers: noStore });
    }
    console.error("[phone:login]", message);
    return NextResponse.json({ error: "Couldn't reach the phone system to set up calling." }, { status: 502 });
  }
}
