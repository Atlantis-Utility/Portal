import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { requestOrigin } from "@/lib/app-origin";
import { extensionOptions, googleAuthUrl, googleConfigured } from "@/lib/google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts "Connect Google": checks who's asking and which extension they
 * chose, then sends them to Google's consent screen. The extension and a
 * one-time state value ride along in an httpOnly cookie, so the callback
 * can't be fed somebody else's choice.
 */
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const back = (q: string) => NextResponse.redirect(`${origin}/account?google=${q}`);
  if (!googleConfigured()) return back("not_configured");
  try {
    const actor = await requireEmployee();
    const ext = (req.nextUrl.searchParams.get("ext") ?? "").trim();
    const option = (await extensionOptions(actor.email)).find((o) => o.user === ext);
    if (!option) return back("bad_extension");
    if (option.takenBy) return back("extension_taken");

    const state = randomBytes(24).toString("base64url");
    const res = NextResponse.redirect(googleAuthUrl(origin, state));
    res.cookies.set("google_contacts_oauth", JSON.stringify({ state, ext }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60,
      path: "/api/google-contacts",
    });
    return res;
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.redirect(`${origin}/login`);
    console.error("[google-contacts:connect]", err);
    return back("error");
  }
}
