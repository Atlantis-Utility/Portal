import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { IntegrationEvent, IntegrationView, ProviderId } from "./catalog";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Reads and writes integrations with the service key. The tables have RLS
 * on and no policies; API routes check the caller first.
 */

export interface IntegrationRow {
  id: string;
  provider: ProviderId;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secret: string | null;
  hook_token_hash: string | null;
  last_sync_at: string | null;
  last_status: "never" | "ok" | "error";
  last_error: string;
  created_by_email: string;
  created_by_name: string;
  created_at: string;
}

/** A contact as a connector hands it over. */
export interface IncomingContact {
  externalId: string;
  name: string;
  company?: string;
  email?: string;
  /** Any format; reduced to ten digits on the way in. */
  phone?: string;
  fields?: Record<string, unknown>;
  sourceUrl?: string;
}

const db = () => createServiceRoleClient();

export function toView(r: IntegrationRow, contactCount = 0): IntegrationView {
  return {
    id: r.id,
    provider: r.provider,
    name: r.name,
    enabled: r.enabled,
    config: r.config ?? {},
    hasSecret: Boolean(r.secret),
    lastSyncAt: r.last_sync_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    contactCount,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  };
}

/** The decrypted credential, for a connector to use. Never for a browser. */
export function secretOf(r: IntegrationRow): Record<string, string> {
  if (!r.secret) return {};
  try {
    return JSON.parse(decryptSecret(r.secret)) as Record<string, string>;
  } catch {
    throw new Error("The saved credential can't be read. Reconnect this integration.");
  }
}

export function sealSecret(values: Record<string, string>): string | null {
  const kept = Object.fromEntries(Object.entries(values).filter(([, v]) => v));
  return Object.keys(kept).length ? encryptSecret(JSON.stringify(kept)) : null;
}

export async function listIntegrations(): Promise<IntegrationView[]> {
  const { data, error } = await db()
    .from("integrations")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = data as IntegrationRow[];
  const counts = await Promise.all(
    rows.map(async (r) => {
      const { count } = await db()
        .from("external_contacts")
        .select("id", { count: "exact", head: true })
        .eq("integration_id", r.id);
      return count ?? 0;
    }),
  );
  return rows.map((r, i) => toView(r, counts[i]));
}

export async function getIntegration(id: string): Promise<IntegrationRow | null> {
  const { data, error } = await db().from("integrations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as IntegrationRow) ?? null;
}

export async function getByHookHash(hash: string): Promise<IntegrationRow | null> {
  const { data, error } = await db()
    .from("integrations")
    .select("*")
    .eq("hook_token_hash", hash)
    .eq("provider", "webhook_in")
    .maybeSingle();
  if (error) throw error;
  return (data as IntegrationRow) ?? null;
}

export async function insertIntegration(row: {
  provider: ProviderId;
  name: string;
  config: Record<string, unknown>;
  secret: string | null;
  hookTokenHash?: string;
  createdByName: string;
  createdByEmail: string;
}): Promise<IntegrationRow> {
  const { data, error } = await db()
    .from("integrations")
    .insert({
      provider: row.provider,
      name: row.name,
      config: row.config,
      secret: row.secret,
      hook_token_hash: row.hookTokenHash ?? null,
      created_by_name: row.createdByName,
      created_by_email: row.createdByEmail,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as IntegrationRow;
}

export async function patchIntegration(id: string, patch: Record<string, unknown>): Promise<IntegrationRow | null> {
  const { data, error } = await db()
    .from("integrations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as IntegrationRow) ?? null;
}

export async function deleteIntegration(id: string): Promise<void> {
  const { error } = await db().from("integrations").delete().eq("id", id);
  if (error) throw error;
}

export async function logEvent(
  integrationId: string,
  e: { kind: string; ok: boolean; summary: string; detail?: Record<string, unknown> },
): Promise<void> {
  await db().from("integration_events").insert({
    integration_id: integrationId,
    kind: e.kind,
    ok: e.ok,
    summary: e.summary.slice(0, 500),
    detail: e.detail ?? {},
  });
}

export async function listEvents(integrationId: string, limit = 30): Promise<IntegrationEvent[]> {
  const { data, error } = await db()
    .from("integration_events")
    .select("id, at, kind, ok, summary")
    .eq("integration_id", integrationId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as IntegrationEvent[];
}

/** Ten-digit US number, or "". */
export function phoneDigits(raw: unknown): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? n : "";
}

/**
 * Writes what a connector brought in, replacing that integration's earlier
 * copy of each record. With `prune`, records the source no longer has are
 * removed too - right for a full sync, wrong for a webhook that sends one
 * contact at a time.
 */
export async function saveContacts(
  integrationId: string,
  contacts: IncomingContact[],
  opts: { prune: boolean },
): Promise<{ saved: number; withPhone: number; removed: number }> {
  const now = new Date().toISOString();
  const rows = contacts
    .filter((c) => c.externalId)
    .map((c) => ({
      integration_id: integrationId,
      external_id: String(c.externalId).slice(0, 200),
      name: (c.name ?? "").trim().slice(0, 200),
      company: (c.company ?? "").trim().slice(0, 200),
      email: (c.email ?? "").trim().slice(0, 200),
      phone: phoneDigits(c.phone),
      fields: c.fields ?? {},
      source_url: c.sourceUrl ?? "",
      synced_at: now,
    }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db()
      .from("external_contacts")
      .upsert(rows.slice(i, i + 500), { onConflict: "integration_id,external_id" });
    if (error) throw error;
  }

  let removed = 0;
  if (opts.prune) {
    const { data, error } = await db()
      .from("external_contacts")
      .delete()
      .eq("integration_id", integrationId)
      .lt("synced_at", now)
      .select("id");
    if (error) throw error;
    removed = data?.length ?? 0;
  }
  return { saved: rows.length, withPhone: rows.filter((r) => r.phone).length, removed };
}

/**
 * Names for numbers, from every enabled integration: ten digits -> who.
 * Read by Messages so a text from a CRM contact shows their name.
 */
export async function externalContactsByPhone(): Promise<Record<string, { name: string; company: string; source: string }>> {
  const out: Record<string, { name: string; company: string; source: string }> = {};
  const { data: live } = await db().from("integrations").select("id, provider, name").eq("enabled", true);
  const sources = new Map((live ?? []).map((r) => [r.id as string, (r.name as string) || (r.provider as string)]));
  if (sources.size === 0) return out;

  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("external_contacts")
      .select("integration_id, name, company, phone")
      .neq("phone", "")
      .in("integration_id", [...sources.keys()])
      .order("synced_at", { ascending: false })
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    for (const r of data as Array<{ integration_id: string; name: string; company: string; phone: string }>) {
      if (!r.name || out[r.phone]) continue;
      out[r.phone] = { name: r.name, company: r.company, source: sources.get(r.integration_id) ?? "" };
    }
    if (data.length < 1000) break;
  }
  return out;
}
