import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { coreApi, createDevice, getDevice, getSubscribers, ourDomain } from "@/lib/ringlogix";

/**
 * The portal phone, server side: who calls as which extension, and the SIP
 * login the browser uses.
 *
 * The browser registers to RingLogix as its own device on the person's
 * extension, "<ext>pt" (portal), created the first time they open the
 * phone. Its own device so it never knocks the desk phone, SNAPmobile
 * ("<ext>m") or the SNAP.GO Webphone ("<ext>wp") offline: every device on
 * an extension rings together, and each answers for itself.
 */

/** RingLogix's WebRTC entry points: SIP over WebSocket on port 9002. */
export function phoneServers(): string[] {
  const configured = (process.env.RINGLOGIX_WSS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return configured.length
    ? configured
    : ["wss://core2-mia.ringlogix.com:9002", "wss://core2-dfw.ringlogix.com:9002", "wss://core1-sjc.ringlogix.com:9002"];
}

export const portalDevice = (extension: string) => `${extension}pt`;

const db = () => createServiceRoleClient();

export async function extensionFor(email: string): Promise<string | null> {
  const { data, error } = await db().from("phone_extensions").select("extension").eq("email", email.toLowerCase()).maybeSingle();
  if (error) throw error;
  return (data?.extension as string | undefined) ?? null;
}

export interface ExtensionChoice {
  user: string;
  name: string;
  email: string;
  /** Who in the portal already calls as it. */
  assignedTo: string | null;
}

export async function extensionChoices(): Promise<ExtensionChoice[]> {
  const [subs, { data: rows }] = await Promise.all([
    getSubscribers(ourDomain()) as Promise<Array<{ user?: string; first_name?: string; last_name?: string; email?: string }>>,
    db().from("phone_extensions").select("email, extension"),
  ]);
  const owner = new Map((rows ?? []).map((r) => [String(r.extension), String(r.email)]));
  return (subs ?? [])
    .filter((s) => s.user && s.user !== "api")
    .map((s) => ({
      user: String(s.user),
      name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.replace(/\s+/g, " ").trim(),
      email: String(s.email ?? "").trim().toLowerCase(),
      assignedTo: owner.get(String(s.user)) ?? null,
    }))
    .sort((a, b) => a.user.localeCompare(b.user, undefined, { numeric: true }));
}

/** Sets (or, with null, clears) someone's extension. Admin routes only. */
export async function setExtension(email: string, extension: string | null, by: string): Promise<void> {
  const key = email.toLowerCase();
  if (!extension) {
    const { error } = await db().from("phone_extensions").delete().eq("email", key);
    if (error) throw error;
    return;
  }
  const { error } = await db()
    .from("phone_extensions")
    .upsert({ email: key, extension, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) throw error;
}

export interface PhoneLogin {
  extension: string;
  device: string;
  domain: string;
  password: string;
  servers: string[];
  displayName: string;
}

// The password doesn't change unless someone resets it in RingLogix, so a
// page load needn't ask the PBX every time.
const cache = new Map<string, { login: PhoneLogin; until: number }>();

/** The portal device for this extension, created if it isn't there yet. */
export async function phoneLogin(extension: string, displayName: string): Promise<PhoneLogin> {
  const hit = cache.get(extension);
  if (hit && hit.until > Date.now()) return { ...hit.login, displayName };

  const domain = ourDomain();
  const device = portalDevice(extension);
  let found = await getDevice(domain, extension, device);
  if (!found) {
    console.log(`[phone] creating device ${device} on extension ${extension}`);
    found = await createDevice(domain, extension, device);
  }
  const password = found["device-sip-registration-password"] ?? "";
  if (!password) throw new Error(`RingLogix didn't return a password for ${device}.`);
  const login = { extension, device, domain, password, servers: phoneServers(), displayName };
  cache.set(extension, { login, until: Date.now() + 10 * 60_000 });
  return login;
}

export interface ParkSpot {
  /** What to transfer to (park) or dial (pick up): "710". */
  spot: string;
  label: string;
  /** Who's parked there, if anyone. */
  parked: { name: string; number: string; since: number | null } | null;
}

/**
 * The domain's park spots and who is in them.
 *
 * Park spots here are call queues ("Park 1" = 710, 711, 712), reached
 * through the "Directed-Parktrieve" dial rule on 71x: transferring a call
 * to one parks it, dialing it picks the call back up, and after a while it
 * rings back whoever parked it.
 */
export async function parkSpots(): Promise<ParkSpot[]> {
  const domain = ourDomain();
  const { status, data } = await coreApi("GET", `/domains/${encodeURIComponent(domain)}/callqueues`);
  if (status !== 200 || !Array.isArray(data)) return [];
  const queues = (data as Array<{ callqueue?: string; description?: string; "active-queued-calls-total-current"?: number }>)
    .filter((q) => /^park/i.test(q.description ?? "") || /^7[1-4]\d$/.test(q.callqueue ?? ""))
    .sort((a, b) => String(a.callqueue).localeCompare(String(b.callqueue), undefined, { numeric: true }));
  // Who is in them: the domain's active calls, where a parked call is one
  // whose far end is the spot (term user "712"). queuedcall/list answers
  // null even with a call parked (seen 2026-11-24), so it isn't used.
  const busy = queues.some((q) => (q["active-queued-calls-total-current"] ?? 0) > 0);
  let calls: Array<Record<string, unknown>> = [];
  if (busy) {
    const r = await coreApi("GET", `/domains/${encodeURIComponent(domain)}/calls`);
    if (r.status === 200 && Array.isArray(r.data)) calls = r.data as Array<Record<string, unknown>>;
  }
  return queues.map((q) => {
    const spot = String(q.callqueue);
    let parked: ParkSpot["parked"] = null;
    if ((q["active-queued-calls-total-current"] ?? 0) > 0) {
      const c = calls.find((x) => String(x["call-term-user"] ?? "") === spot) ?? {};
      const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
      const number = [c["caller-id-number"], c["call-orig-from-user"], c["call-orig-user"]].map(digits).find((d) => d.length >= 3) ?? "";
      const name = String(c["caller-id-name"] ?? c["call-orig-from-name"] ?? c["call-orig-name"] ?? "").trim();
      const since = Date.parse(String(c["call-answer-datetime"] ?? c["call-start-datetime"] ?? ""));
      parked = { name: name && name.replace(/\D/g, "") !== number ? name : "", number, since: Number.isFinite(since) ? since : null };
    }
    return { spot, label: q.description || `Park ${spot}`, parked };
  });
}
