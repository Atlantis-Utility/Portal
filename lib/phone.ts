import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createDevice, getDevice, getSubscribers, ourDomain } from "@/lib/ringlogix";

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
