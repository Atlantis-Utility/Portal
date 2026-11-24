import { after, NextResponse, type NextRequest } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { requestOrigin } from "@/lib/app-origin";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  claimLink, exchangeCode, extensionOptions, getLink, googleConfigured, sealToken, syncLink,
} from "@/lib/google-contacts";
import { safeEqual } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The first sync runs after the redirect, within this route's time.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const origin = requestOrigin(req);
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/account?google=${q}`);
    res.cookies.set("google_contacts_oauth", "", { path: "/api/google-contacts", maxAge: 0 });
    return res;
  };
  if (!googleConfigured()) return back("not_configured");

  const p = req.nextUrl.searchParams;
  // "Cancel" on Google's screen.
  if (p.get("error")) return back("cancelled");

  let saved: { state?: string; ext?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get("google_contacts_oauth")?.value ?? "{}");
  } catch { /* treated as missing */ }
  const state = p.get("state") ?? "";
  const code = p.get("code") ?? "";
  if (!code || !saved.state || !saved.ext || !safeEqual(state, saved.state)) return back("expired");

  try {
    const actor = await requireEmployee();
    const owner = actor.email.toLowerCase();
    // Checked again: someone may have taken the extension in the meantime.
    const option = (await extensionOptions(owner)).find((o) => o.user === saved.ext);
    if (!option) return back("bad_extension");
    if (option.takenBy) return back("extension_taken");

    const grant = await exchangeCode(code, origin);
    // Google lets people untick the contacts box on its consent screen.
    if (!grant.scope.includes("contacts.readonly")) return back("no_contacts_permission");

    const previous = await getLink(owner);
    const { error } = await createServiceRoleClient().from("google_contact_links").upsert({
      owner_email: owner,
      google_email: grant.email,
      extension: saved.ext,
      refresh_token: sealToken(grant.refreshToken),
      // A full read first: if this is a different Google account, whatever
      // the old one put in RingLogix is taken back out.
      sync_token: null,
      enabled: true,
      removing: false,
      next_sync_at: new Date().toISOString(),
      locked_until: null,
      last_status: previous?.last_status ?? "never",
      last_error: "",
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_email" });
    if (error) {
      if (/google_contact_links_extension/.test(error.message)) return back("extension_taken");
      throw error;
    }
    if (previous && previous.extension !== saved.ext) {
      // Moved book: the old copies come out, new ones go in.
      await createServiceRoleClient().from("google_contacts").update({ state: "pending" }).eq("owner_email", owner).eq("deleted", false);
    }
    // The old token is NOT revoked: for the same Google account, revoking it
    // withdraws the whole grant, the token just issued included.

    console.log(`[google-contacts] ${owner} connected ${grant.email || "a Google account"} -> ext ${saved.ext}`);
    // Started now rather than at the next timer tick, so the page shows
    // contacts arriving while the person is still looking at it.
    after(async () => {
      const link = await claimLink(owner).catch(() => null);
      if (link) await syncLink(link, 45_000);
    });
    return back("connected");
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.redirect(`${origin}/login`);
    console.error("[google-contacts:callback]", err);
    return back("error");
  }
}
