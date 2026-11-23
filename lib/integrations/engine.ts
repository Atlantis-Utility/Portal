import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils";
import { CONNECTORS, checkOutgoingUrl } from "./providers";
import { hmacHex } from "./crypto";
import {
  logEvent, patchIntegration, saveContacts, secretOf, type IntegrationRow,
} from "./store";
import type { OutgoingEvent } from "./catalog";

/**
 * Running integrations: testing a connection, syncing one, syncing every
 * one that's due, and telling outgoing webhooks what happened.
 */

export async function testIntegration(row: IntegrationRow): Promise<{ ok: boolean; message: string }> {
  const connector = CONNECTORS[row.provider];
  if (!connector) return { ok: false, message: "This connector isn't available yet." };
  try {
    const message = await connector.test({ config: row.config, secret: secretOf(row) });
    await logEvent(row.id, { kind: "test", ok: true, summary: message });
    return { ok: true, message };
  } catch (err) {
    const message = getErrorMessage(err, "The connection test failed.");
    await logEvent(row.id, { kind: "test", ok: false, summary: message });
    return { ok: false, message };
  }
}

export async function syncIntegration(row: IntegrationRow): Promise<{ ok: boolean; message: string }> {
  const connector = CONNECTORS[row.provider];
  if (!connector?.pull) return { ok: false, message: "This integration doesn't sync." };
  try {
    const contacts = await connector.pull({ config: row.config, secret: secretOf(row) });
    const r = await saveContacts(row.id, contacts, { prune: true });
    const message =
      `Synced ${r.saved} record${r.saved === 1 ? "" : "s"}, ${r.withPhone} with a phone number` +
      (r.removed ? `; ${r.removed} no longer in the source were removed` : "") + ".";
    await patchIntegration(row.id, {
      last_sync_at: new Date().toISOString(), last_status: "ok", last_error: "", locked_until: null,
    });
    await logEvent(row.id, { kind: "sync", ok: true, summary: message, detail: { ...r } });
    await emit("contacts.synced", { integration: row.name || row.provider, ...r });
    return { ok: true, message };
  } catch (err) {
    const message = getErrorMessage(err, "The sync failed.");
    await patchIntegration(row.id, {
      last_sync_at: new Date().toISOString(), last_status: "error", last_error: message, locked_until: null,
    });
    await logEvent(row.id, { kind: "sync", ok: false, summary: message });
    return { ok: false, message };
  }
}

/** Syncs whatever is due, by each integration's own interval. */
export async function runDueSyncs(): Promise<Array<{ id: string; ok: boolean; message: string }>> {
  const { data, error } = await createServiceRoleClient().rpc("claim_due_integrations", {
    p_limit: 5, p_lease_seconds: 600,
  });
  if (error) {
    // Before migration-integrations.sql is run there is nothing to sync.
    if (/claim_due_integrations/.test(error.message)) return [];
    throw error;
  }
  const out = [];
  for (const row of (data ?? []) as IntegrationRow[]) {
    out.push({ id: row.id, ...(await syncIntegration(row)) });
  }
  return out;
}

/**
 * Tells every enabled outgoing webhook that listens for this event.
 *
 * Never throws: a CRM that's down must not fail the scheduled text or the
 * sync that triggered the notice. Each delivery is logged instead.
 */
export async function emit(event: OutgoingEvent, data: Record<string, unknown>): Promise<void> {
  let hooks: IntegrationRow[] = [];
  try {
    const { data: rows } = await createServiceRoleClient()
      .from("integrations")
      .select("*")
      .eq("provider", "webhook_out")
      .eq("enabled", true);
    hooks = (rows ?? []) as IntegrationRow[];
  } catch {
    return;
  }
  await Promise.all(
    hooks
      .filter((h) => {
        const events = h.config.events;
        return !Array.isArray(events) || events.length === 0 || events.includes(event);
      })
      .map((h) => deliver(h, event, data)),
  );
}

export async function deliver(
  hook: IntegrationRow,
  event: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const url = checkOutgoingUrl(String(hook.config.url ?? ""));
    const body = JSON.stringify({ event, at: new Date().toISOString(), source: "atlantis-portal", data });
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Atlantis-Portal-Webhook/1" };
    const signing = secretOf(hook).signingSecret;
    if (signing) headers["X-Portal-Signature"] = `sha256=${hmacHex(signing, body)}`;
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
    const ok = res.ok;
    const message = ok ? `Delivered “${event}” (${res.status}).` : `“${event}” was refused: ${res.status}.`;
    await logEvent(hook.id, { kind: "webhook_out", ok, summary: message });
    return { ok, message };
  } catch (err) {
    const message = `“${event}” couldn't be delivered: ${getErrorMessage(err, "no answer")}`;
    await logEvent(hook.id, { kind: "webhook_out", ok: false, summary: message }).catch(() => {});
    return { ok: false, message };
  }
}
