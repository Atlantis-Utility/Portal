import { NextResponse, type NextRequest } from "next/server";
import { MS_USER_SCOPES } from "@/lib/microsoft/scopes";
import { requestOrigin } from "@/lib/app-origin";

export function GET(req: NextRequest) {
  const tenant = process.env.MS_CALENDAR_TENANT_ID ?? "common";
  const params = new URLSearchParams({
    client_id: process.env.MS_CALENDAR_CLIENT_ID!,
    response_type: "code",
    // From the request, not NEXT_PUBLIC_APP_URL: unset, that produced
    // "undefined/api/…" and Microsoft refused it (AADSTS90102); set to
    // another domain, the cookie landed where this site can't see it.
    // Each origin used must be a redirect URI on the Azure app registration.
    redirect_uri: `${requestOrigin(req)}/api/outlook-calendar/callback`,
    response_mode: "query",
    scope: MS_USER_SCOPES,
  });

  return NextResponse.redirect(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`
  );
}
