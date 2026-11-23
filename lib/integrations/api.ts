import "server-only";
import { NextResponse } from "next/server";
import { ApiAuthError } from "@/lib/api-auth";
import { getErrorMessage } from "@/lib/utils";
import { OUTGOING_EVENTS, type Provider } from "./catalog";
import { checkOutgoingUrl } from "./providers";

/** Shared by the /api/integrations routes. */

export const PAGE = "/integrations";

export function refuse(err: unknown) {
  if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = getErrorMessage(err, "Something went wrong");
  if (/integrations|external_contacts/.test(message) && /does not exist|schema cache/.test(message)) {
    return NextResponse.json(
      { error: "Integrations aren't set up yet: run supabase/migration-integrations.sql." },
      { status: 503 },
    );
  }
  console.error("[integrations]", message);
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Splits what was typed into the connect form: secret fields go to the
 * encrypted credential, the rest to plain settings. A secret field left
 * blank on an edit keeps what was saved.
 */
export function splitValues(
  provider: Provider,
  values: Record<string, unknown>,
  existing: { config: Record<string, unknown>; secret: Record<string, string> },
): { config: Record<string, unknown>; secret: Record<string, string> } {
  const config: Record<string, unknown> = { ...existing.config };
  const secret: Record<string, string> = { ...existing.secret };

  for (const f of provider.fields) {
    const raw = values[f.key];
    if (raw === undefined) continue;
    const value = String(raw ?? "").trim();
    if (f.secret) {
      if (value) secret[f.key] = value;
    } else if (f.key === "syncMinutes") {
      const n = Math.round(Number(value || 0));
      config.syncMinutes = Number.isFinite(n) ? Math.min(Math.max(n, 0), 7 * 24 * 60) : 0;
    } else {
      config[f.key] = value;
    }
  }
  if (provider.syncs && config.syncMinutes === undefined) config.syncMinutes = 60;
  // Fifteen minutes at the shortest: a CRM's rate limits are shared with
  // everything else that uses it.
  if (typeof config.syncMinutes === "number" && config.syncMinutes > 0 && config.syncMinutes < 15) {
    config.syncMinutes = 15;
  }

  if (provider.id === "webhook_out") {
    checkOutgoingUrl(String(config.url ?? ""));
    const wanted = Array.isArray(values.events) ? values.events.map(String) : (config.events as string[] | undefined);
    config.events = (wanted ?? []).filter((e) => OUTGOING_EVENTS.some((o) => o.key === e));
  }

  for (const f of provider.fields) {
    if (f.optional) continue;
    const present = f.secret ? Boolean(secret[f.key]) : Boolean(String(config[f.key] ?? "").trim());
    if (!present) throw new ApiAuthError(`${f.label} is needed.`, 400);
  }
  return { config, secret };
}
