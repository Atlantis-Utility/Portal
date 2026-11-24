import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  createContact, deleteContact, getContacts, getSubscribers, invalidateRinglogixCache, ourDomain, RingLogixError,
} from "@/lib/ringlogix";
import { getErrorMessage } from "@/lib/utils";

/**
 * Google Contacts -> RingLogix, one person at a time.
 *
 * Each person connects their own Google account (OAuth, contacts read-only)
 * and picks their extension. Their saved Google contacts are copied into
 * that extension's RingLogix book, and kept current by the minute timer
 * (/api/cron/workflows): every few minutes Google is asked only what
 * changed since last time (its sync token), and the changes are written.
 *
 * Two steps, so a big first sync can't time a request out:
 *   pull   Google -> google_contacts, marking anything changed "pending"
 *   apply  pending rows -> RingLogix, a bounded number per run
 *
 * What the sync may touch: only the RingLogix contacts it wrote itself,
 * recorded on the row (rl_extension / rl_first / rl_last). RingLogix keeps
 * ONE contact per name in a book, and creating a second "John Smith"
 * overwrites the first, so a Google contact whose name is already in the
 * book (saved by hand, or in the shared book) is left alone and listed as
 * a clash instead. Deleting a contact in Google deletes the copy the sync
 * made, and nothing else.
 */

export const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/contacts.readonly";
const PERSON_FIELDS = "names,phoneNumbers,emailAddresses,organizations,metadata";
/** How often Google is asked for changes once everything is written. */
const PULL_EVERY_MS = 5 * 60_000;
/** RingLogix writes per person per run; the rest wait for the next minute. */
const WRITES_PER_RUN = 60;

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export const googleRedirectUri = (origin: string) => `${origin}/api/google-contacts/callback`;

export function googleAuthUrl(origin: string, state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    // A refresh token, every time: without prompt=consent Google only hands
    // one out on the very first grant, and a reconnect would come back
    // without the thing the timer needs.
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenCall(body: Record<string, string>): Promise<TokenAnswer> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      ...body,
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as TokenAnswer;
  if (!res.ok && !data.error) data.error = `http_${res.status}`;
  return data;
}

/** The code Google sent back -> the account's email and a refresh token. */
export async function exchangeCode(code: string, origin: string): Promise<{ refreshToken: string; email: string; scope: string }> {
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: googleRedirectUri(origin) });
  if (t.error || !t.refresh_token) {
    throw new Error(`Google refused the sign-in (${t.error ?? "no refresh token"}${t.error_description ? `: ${t.error_description}` : ""}).`);
  }
  // Straight from Google's token endpoint over TLS, so the payload can be
  // read without checking the signature (Google's own guidance).
  let email = "";
  try {
    const payload = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    email = payload.email ?? "";
  } catch { /* the address is for display only */ }
  return { refreshToken: t.refresh_token, email, scope: t.scope ?? "" };
}

/** Google said the grant is gone: revoked by the person, or expired. */
class GoogleAccessLost extends Error {}

async function accessToken(sealedRefresh: string): Promise<string> {
  const t = await tokenCall({ grant_type: "refresh_token", refresh_token: decryptSecret(sealedRefresh) });
  if (t.error === "invalid_grant") throw new GoogleAccessLost("Google access was withdrawn or has expired. Connect Google again.");
  if (t.error || !t.access_token) throw new Error(`Google wouldn't hand out a token (${t.error}).`);
  return t.access_token;
}

/** Best effort: tells Google to forget the grant. */
export async function revokeGoogle(sealedRefresh: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptSecret(sealedRefresh))}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch { /* the row is gone either way */ }
}

export const sealToken = (refreshToken: string) => encryptSecret(refreshToken);

// ── Rows ────────────────────────────────────────────────────────────────

export interface LinkRow {
  owner_email: string;
  google_email: string;
  extension: string;
  refresh_token: string;
  sync_token: string | null;
  enabled: boolean;
  removing: boolean;
  next_sync_at: string;
  locked_until: string | null;
  last_sync_at: string | null;
  last_status: "never" | "ok" | "error";
  last_error: string;
}

interface ContactFields {
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  cell_phone: string;
  work_phone: string;
  home_phone: string;
}

interface ContactRow extends ContactFields {
  owner_email: string;
  resource_name: string;
  deleted: boolean;
  state: "pending" | "synced" | "clash" | "skipped" | "error";
  note: string;
  rl_extension: string;
  rl_first: string;
  rl_last: string;
}

const FIELD_KEYS: Array<keyof ContactFields> = ["first_name", "last_name", "company", "email", "cell_phone", "work_phone", "home_phone"];
const db = () => createServiceRoleClient();

export async function getLink(ownerEmail: string): Promise<LinkRow | null> {
  const { data, error } = await db().from("google_contact_links").select("*").eq("owner_email", ownerEmail.toLowerCase()).maybeSingle();
  if (error) throw error;
  return (data as LinkRow) ?? null;
}

async function patchLink(ownerEmail: string, patch: Partial<LinkRow>) {
  const { error } = await db()
    .from("google_contact_links")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("owner_email", ownerEmail);
  if (error) throw error;
}

async function allRows(ownerEmail: string): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  // Paged: PostgREST stops a plain select at 1000 rows without saying so.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("google_contacts")
      .select("*")
      .eq("owner_email", ownerEmail)
      .order("resource_name")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ContactRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function upsertRows(rows: Array<Partial<ContactRow> & { owner_email: string; resource_name: string }>) {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db()
      .from("google_contacts")
      .upsert(rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now })), { onConflict: "owner_email,resource_name" });
    if (error) throw error;
  }
}

// ── Google -> rows ──────────────────────────────────────────────────────

interface Person {
  resourceName: string;
  metadata?: { deleted?: boolean };
  names?: Array<{ givenName?: string; familyName?: string; displayName?: string; metadata?: { primary?: boolean } }>;
  phoneNumbers?: Array<{ value?: string; canonicalForm?: string; type?: string; metadata?: { primary?: boolean } }>;
  emailAddresses?: Array<{ value?: string; metadata?: { primary?: boolean } }>;
  organizations?: Array<{ name?: string; metadata?: { primary?: boolean } }>;
}

const primaryFirst = <T extends { metadata?: { primary?: boolean } }>(list: T[] | undefined): T[] =>
  [...(list ?? [])].sort((a, b) => Number(Boolean(b.metadata?.primary)) - Number(Boolean(a.metadata?.primary)));

/** Digits only; a US number loses its leading 1, as everywhere else here. */
function phoneDigits(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** A Google person -> what goes in a RingLogix contact. */
export function fieldsOf(p: Person): ContactFields {
  const name = primaryFirst(p.names)[0];
  let first = (name?.givenName ?? "").trim();
  let last = (name?.familyName ?? "").trim();
  if (!first && !last && name?.displayName) {
    const parts = name.displayName.trim().split(/\s+/);
    first = parts.shift() ?? "";
    last = parts.join(" ");
  }
  const company = (primaryFirst(p.organizations)[0]?.name ?? "").trim();
  // A business saved with only its company name is still somebody to call.
  if (!first && !last && company) first = company;

  // RingLogix has three phone slots. Google's own labels go to the matching
  // slot; anything else fills whichever is still empty, primary first.
  const slots = { cell_phone: "", work_phone: "", home_phone: "" };
  const rest: string[] = [];
  for (const ph of primaryFirst(p.phoneNumbers)) {
    const digits = phoneDigits(ph.canonicalForm || ph.value || "");
    if (!digits || Object.values(slots).includes(digits) || rest.includes(digits)) continue;
    const type = (ph.type ?? "").toLowerCase();
    const slot = type === "mobile" ? "cell_phone" : type.startsWith("work") ? "work_phone" : type === "home" ? "home_phone" : null;
    if (slot && !slots[slot]) slots[slot] = digits;
    else rest.push(digits);
  }
  for (const digits of rest) {
    const free = (["cell_phone", "work_phone", "home_phone"] as const).find((k) => !slots[k]);
    if (free) slots[free] = digits;
  }

  return {
    first_name: first.slice(0, 100),
    last_name: last.slice(0, 100),
    company: company.slice(0, 100),
    email: (primaryFirst(p.emailAddresses)[0]?.value ?? "").trim().slice(0, 200),
    ...slots,
  };
}

class SyncTokenExpired extends Error {}

async function listConnections(token: string, syncToken: string | null): Promise<{ people: Person[]; nextSyncToken: string }> {
  const people: Person[] = [];
  let pageToken = "";
  let nextSyncToken = "";
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ personFields: PERSON_FIELDS, pageSize: "1000", requestSyncToken: "true" });
    if (syncToken) params.set("syncToken", syncToken);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // A sync token lasts about a week; after that Google wants a full read.
      if (syncToken && (res.status === 410 || /EXPIRED_SYNC_TOKEN/.test(text))) throw new SyncTokenExpired();
      if (res.status === 403 && /has not been used|disabled/i.test(text)) {
        throw new Error("The People API isn't turned on in the Google Cloud project. Enable it there.");
      }
      if (res.status === 403) throw new GoogleAccessLost("Google didn't give permission to read contacts. Connect Google again and tick the contacts box.");
      throw new Error(`Google Contacts answered ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { connections?: Person[]; nextPageToken?: string; nextSyncToken?: string };
    people.push(...(data.connections ?? []));
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return { people, nextSyncToken };
}

const sameFields = (a: ContactFields, b: ContactFields) => FIELD_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));

/** Google's changes -> rows marked pending. */
async function pull(link: LinkRow): Promise<void> {
  const token = await accessToken(link.refresh_token);
  let full = !link.sync_token;
  let result: Awaited<ReturnType<typeof listConnections>>;
  try {
    result = await listConnections(token, link.sync_token);
  } catch (err) {
    if (!(err instanceof SyncTokenExpired)) throw err;
    full = true;
    result = await listConnections(token, null);
  }

  const stored = new Map((await allRows(link.owner_email)).map((r) => [r.resource_name, r]));
  const seen = new Set<string>();
  // Whole rows only: a batch upsert sets any column one row leaves out to
  // null, and every column here is NOT NULL.
  const writes: ContactRow[] = [];

  for (const p of result.people) {
    if (!p.resourceName) continue;
    seen.add(p.resourceName);
    const before = stored.get(p.resourceName);
    if (p.metadata?.deleted) {
      if (before && !before.deleted) writes.push({ ...before, deleted: true, state: "pending" });
      continue;
    }
    const fields = fieldsOf(p);
    if (before && !before.deleted && sameFields(before, fields)) continue;
    writes.push({
      owner_email: link.owner_email,
      resource_name: p.resourceName,
      rl_extension: before?.rl_extension ?? "",
      rl_first: before?.rl_first ?? "",
      rl_last: before?.rl_last ?? "",
      ...fields,
      deleted: false,
      state: "pending",
      note: "",
    });
  }

  const touched = new Set(writes.map((w) => w.resource_name));
  for (const r of stored.values()) {
    if (touched.has(r.resource_name) || r.deleted) continue;
    // A full read lists everything there is: whatever it didn't mention has
    // gone from Google (or this is a different Google account than before).
    if (full && !seen.has(r.resource_name)) {
      writes.push({ ...r, deleted: true, state: "pending" });
    } else if (r.state === "clash" || r.state === "error") {
      // Looked at again each time: the contact in the way may have been
      // renamed or deleted since, or RingLogix was only briefly unhappy.
      writes.push({ ...r, state: "pending" });
    }
  }

  await upsertRows(writes);
  await patchLink(link.owner_email, { sync_token: result.nextSyncToken || link.sync_token });
}

// ── Rows -> RingLogix ───────────────────────────────────────────────────

type BookEntry = { first_name?: string; last_name?: string; contact_id?: string; shared?: boolean | string };
const nameKey = (first: string, last: string) => `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;
const isShared = (e: BookEntry) => e.shared === true || e.shared === "yes" || e.shared === "true";

/** Writes pending rows to RingLogix. Returns how many are still waiting. */
async function apply(link: LinkRow, deadline: number): Promise<{ written: number; left: number }> {
  const domain = ourDomain();
  const books = new Map<string, Map<string, BookEntry>>();
  const book = async (ext: string) => {
    let b = books.get(ext);
    if (!b) {
      // Fresh, not cached: the clash check is only as good as this read.
      invalidateRinglogixCache("rl:contact:");
      const rows = ((await getContacts(domain, ext)) ?? []) as BookEntry[];
      b = new Map(rows.map((r) => [nameKey(r.first_name ?? "", r.last_name ?? ""), r]));
      books.set(ext, b);
    }
    return b;
  };

  const rows = await allRows(link.owner_email);
  // Names this person's own sync already holds, per book: a second Google
  // contact with the same name must not overwrite the first one's copy.
  const held = new Set(rows.filter((r) => r.rl_extension).map((r) => `${r.rl_extension}|${nameKey(r.rl_first, r.rl_last)}`));
  const pending = rows.filter((r) => r.state === "pending");
  const target = link.removing ? "" : link.extension;
  let written = 0;
  let done = 0;

  for (const row of pending) {
    if (written >= WRITES_PER_RUN || Date.now() > deadline) break;
    const f = row as ContactFields;
    const hasPhone = Boolean(f.cell_phone || f.work_phone || f.home_phone);
    const hasName = Boolean(f.first_name || f.last_name);
    const wanted = Boolean(target) && !row.deleted && hasName && hasPhone;
    const placedHere = row.rl_extension === target && nameKey(row.rl_first, row.rl_last) === nameKey(f.first_name, f.last_name);

    try {
      // Take away the old copy when it's no longer wanted, moved book, or
      // been renamed (RingLogix knows a contact by its name).
      if (row.rl_extension && !(wanted && placedHere)) {
        const b = await book(row.rl_extension);
        const k = nameKey(row.rl_first, row.rl_last);
        const there = b.get(k);
        if (there?.contact_id && !isShared(there)) {
          await deleteContact(domain, row.rl_extension, there.first_name ?? "", there.last_name ?? "", there.contact_id);
          written++;
        }
        b.delete(k);
        held.delete(`${row.rl_extension}|${k}`);
        row.rl_extension = row.rl_first = row.rl_last = "";
      }

      if (row.deleted || !target) {
        await db().from("google_contacts").delete().eq("owner_email", row.owner_email).eq("resource_name", row.resource_name);
        done++;
        continue;
      }
      if (!wanted) {
        await upsertRows([{ ...row, state: "skipped", note: hasName ? "No phone number" : "No name" }]);
        done++;
        continue;
      }

      const b = await book(target);
      const k = nameKey(f.first_name, f.last_name);
      const there = b.get(k);
      if (!placedHere && (there || held.has(`${target}|${k}`))) {
        const note = held.has(`${target}|${k}`)
          ? "Another of your Google contacts has this name"
          : there && isShared(there)
            ? "Already in the shared company book under this name"
            : "Already in RingLogix under this name";
        await upsertRows([{ ...row, state: "clash", note }]);
        done++;
        continue;
      }

      await createContact(domain, target, f.first_name, f.last_name, {
        company: f.company || undefined,
        email: f.email || undefined,
        cell_phone: f.cell_phone || undefined,
        work_phone: f.work_phone || undefined,
        home_phone: f.home_phone || undefined,
      });
      written++;
      b.set(k, { first_name: f.first_name, last_name: f.last_name });
      held.add(`${target}|${k}`);
      await upsertRows([{ ...row, state: "synced", note: "", rl_extension: target, rl_first: f.first_name, rl_last: f.last_name }]);
      done++;
    } catch (err) {
      // RingLogix busy: stop here, the rest go next minute.
      if (err instanceof RingLogixError && err.status === 429) break;
      await upsertRows([{ ...row, state: "error", note: getErrorMessage(err, "RingLogix refused it").slice(0, 300) }]);
      done++;
    }
  }
  return { written, left: pending.length - done };
}

// ── Running ─────────────────────────────────────────────────────────────

export async function syncLink(link: LinkRow, budgetMs = 40_000): Promise<{ ok: boolean; message: string }> {
  const deadline = Date.now() + budgetMs;
  try {
    if (!link.removing) await pull(link);
    const { written, left } = await apply(link, deadline);
    if (link.removing && left === 0) {
      await db().from("google_contact_links").delete().eq("owner_email", link.owner_email);
      return { ok: true, message: "Removed the synced contacts and disconnected." };
    }
    await patchLink(link.owner_email, {
      last_sync_at: new Date().toISOString(),
      last_status: "ok",
      last_error: "",
      locked_until: null,
      // Back next minute while there's still writing to do.
      next_sync_at: new Date(Date.now() + (left > 0 ? 60_000 : PULL_EVERY_MS)).toISOString(),
    });
    return { ok: true, message: `${written} change${written === 1 ? "" : "s"} written${left ? `, ${left} still to go` : ""}.` };
  } catch (err) {
    const message = getErrorMessage(err, "The sync failed.");
    console.error(`[google-contacts] ${link.owner_email}:`, message);
    await patchLink(link.owner_email, {
      last_sync_at: new Date().toISOString(),
      last_status: "error",
      last_error: message.slice(0, 500),
      locked_until: null,
      next_sync_at: new Date(Date.now() + PULL_EVERY_MS).toISOString(),
      // Retrying a dead grant every five minutes helps nobody.
      ...(err instanceof GoogleAccessLost ? { enabled: false } : {}),
    }).catch(() => {});
    return { ok: false, message };
  }
}

/** Takes one person's sync for this caller, unless a timer already has it. */
export async function claimLink(ownerEmail: string, leaseSeconds = 120): Promise<LinkRow | null> {
  const now = new Date();
  const { data, error } = await db()
    .from("google_contact_links")
    .update({ locked_until: new Date(now.getTime() + leaseSeconds * 1000).toISOString() })
    .eq("owner_email", ownerEmail.toLowerCase())
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as LinkRow) ?? null;
}

/** For the minute timer: everyone whose turn it is. */
export async function runDueGoogleSyncs(): Promise<Array<{ owner: string; ok: boolean; message: string }>> {
  if (!googleConfigured()) return [];
  const { data, error } = await db().rpc("claim_due_google_links", { p_limit: 5, p_lease_seconds: 300 });
  if (error) {
    // Before migration-google-contacts.sql is run there's nothing to sync.
    if (/claim_due_google_links/.test(error.message)) return [];
    throw error;
  }
  const out = [];
  const started = Date.now();
  for (const link of (data ?? []) as LinkRow[]) {
    // Shared between everyone claimed this minute.
    const budget = Math.max(5_000, 45_000 - (Date.now() - started));
    out.push({ owner: link.owner_email, ...(await syncLink(link, budget)) });
  }
  return out;
}

// ── For the page ────────────────────────────────────────────────────────

export interface ExtensionOption {
  user: string;
  name: string;
  email: string;
  /** Someone else's sync already writes into this book. */
  takenBy: string | null;
}

export async function extensionOptions(ownerEmail: string): Promise<ExtensionOption[]> {
  const subs = ((await getSubscribers(ourDomain())) ?? []) as Array<{ user?: string; first_name?: string; last_name?: string; email?: string }>;
  const { data: links } = await db().from("google_contact_links").select("owner_email, extension");
  const taken = new Map((links ?? []).map((l) => [String(l.extension), String(l.owner_email)]));
  const me = ownerEmail.toLowerCase();
  return subs
    .filter((s) => s.user && s.user !== "api")
    .map((s) => ({
      user: String(s.user),
      name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.replace(/\s+/g, " ").trim(),
      email: String(s.email ?? "").trim().toLowerCase(),
      takenBy: taken.get(String(s.user)) && taken.get(String(s.user)) !== me ? taken.get(String(s.user))! : null,
    }))
    .sort((a, b) => a.user.localeCompare(b.user, undefined, { numeric: true }));
}

export interface SyncStatus {
  googleEmail: string;
  extension: string;
  enabled: boolean;
  removing: boolean;
  lastSyncAt: string | null;
  lastStatus: LinkRow["last_status"];
  lastError: string;
  counts: Record<ContactRow["state"], number>;
  /** Contacts that didn't go in, and why. */
  problems: Array<{ name: string; state: "clash" | "error"; note: string }>;
}

export async function statusFor(link: LinkRow): Promise<SyncStatus> {
  const rows = await allRows(link.owner_email);
  const counts = { pending: 0, synced: 0, clash: 0, skipped: 0, error: 0 };
  for (const r of rows) if (!r.deleted) counts[r.state]++;
  return {
    googleEmail: link.google_email,
    extension: link.extension,
    enabled: link.enabled,
    removing: link.removing,
    lastSyncAt: link.last_sync_at,
    lastStatus: link.last_status,
    lastError: link.last_error,
    counts,
    problems: rows
      .filter((r): r is ContactRow & { state: "clash" | "error" } => !r.deleted && (r.state === "clash" || r.state === "error"))
      .slice(0, 100)
      .map((r) => ({ name: `${r.first_name} ${r.last_name}`.trim(), state: r.state, note: r.note })),
  };
}

/** Every contact back to "pending": after a change of extension. */
export async function repend(ownerEmail: string): Promise<void> {
  const { error } = await db()
    .from("google_contacts")
    .update({ state: "pending", updated_at: new Date().toISOString() })
    .eq("owner_email", ownerEmail)
    .eq("deleted", false);
  if (error) throw error;
}
