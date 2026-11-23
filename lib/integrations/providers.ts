import "server-only";
import { createSign } from "node:crypto";
import { mapRecord, rowsToRecords } from "./mapping";
import type { IncomingContact } from "./store";

/**
 * The connectors: how each system is reached.
 *
 * Each one can `test` (prove the credential works, touching nothing) and,
 * where it syncs, `pull` (read its contacts). Every call here only READS
 * from the other system; nothing is written back.
 */

export interface ConnectorInput {
  config: Record<string, unknown>;
  secret: Record<string, string>;
}

export interface Connector {
  test(input: ConnectorInput): Promise<string>;
  pull?(input: ConnectorInput): Promise<IncomingContact[]>;
}

const TIMEOUT_MS = 20_000;
/** A sync stops here rather than walking an enormous CRM for ever. */
const MAX_RECORDS = 25_000;

async function getJson(url: string, init: RequestInit, who: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new Error(`Couldn't reach ${who}.`);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const message =
      (body as { message?: string; error?: { message?: string } } | null)?.message ??
      (body as { error?: { message?: string } } | null)?.error?.message ?? "";
    throw new Error(`${who} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return body;
}

// ── HubSpot ──────────────────────────────────────────────────────────────

const HUBSPOT = "https://api.hubapi.com";
const HS_PROPS = ["firstname", "lastname", "email", "phone", "mobilephone", "company", "jobtitle", "lifecyclestage", "hs_lead_status"];

const hubspot: Connector = {
  async test({ secret }) {
    if (!secret.token) throw new Error("Paste the private app access token.");
    try {
      await getJson(`${HUBSPOT}/crm/v3/objects/contacts?limit=1`, { headers: { Authorization: `Bearer ${secret.token}` } }, "HubSpot");
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (/ 401/.test(m)) throw new Error("HubSpot didn't accept that token. Copy it again from the private app.");
      if (/ 403/.test(m)) throw new Error("That token can't read contacts. Give the private app the crm.objects.contacts.read scope.");
      throw e;
    }
    return "Connected to HubSpot. Contacts can be read.";
  },

  async pull({ secret }) {
    const out: IncomingContact[] = [];
    let after = "";
    do {
      const url = `${HUBSPOT}/crm/v3/objects/contacts?limit=100&archived=false&properties=${HS_PROPS.join(",")}` +
        (after ? `&after=${encodeURIComponent(after)}` : "");
      const page = (await getJson(url, { headers: { Authorization: `Bearer ${secret.token}` } }, "HubSpot")) as {
        results?: Array<{ id: string; properties?: Record<string, unknown> }>;
        paging?: { next?: { after?: string } };
      };
      for (const r of page.results ?? []) {
        const m = mapRecord({ id: r.id, ...(r.properties ?? {}) });
        out.push({ externalId: r.id, name: m.name, company: m.company, email: m.email, phone: m.phone, fields: r.properties ?? {} });
      }
      after = page.paging?.next?.after ?? "";
    } while (after && out.length < MAX_RECORDS);
    return out;
  },
};

// ── Google Sheets ────────────────────────────────────────────────────────

interface ServiceAccount { client_email?: string; private_key?: string; token_uri?: string }

function readServiceAccount(raw: string | undefined): Required<ServiceAccount> {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw ?? "") as ServiceAccount;
  } catch {
    throw new Error("The service account key isn't valid JSON. Paste the whole downloaded file.");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("That JSON isn't a service account key (it needs client_email and private_key).");
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri || "https://oauth2.googleapis.com/token" };
}

/** A read-only Sheets access token, from the service account's own key. */
async function googleToken(sa: Required<ServiceAccount>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  } catch {
    throw new Error("The service account's private key couldn't be used. Download a fresh JSON key.");
  }
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`,
  });
  const res = (await getJson(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, "Google")) as { access_token?: string };
  if (!res.access_token) throw new Error("Google didn't hand back an access token.");
  return res.access_token;
}

function sheetId(config: Record<string, unknown>): string {
  const url = String(config.sheetUrl ?? "");
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? (/^[a-zA-Z0-9_-]{20,}$/.test(url) ? url : "");
  if (!id) throw new Error("Paste the sheet's link (it contains /spreadsheets/d/…).");
  return id;
}

async function sheetsCall<T>(input: ConnectorInput, path: string): Promise<T> {
  const sa = readServiceAccount(input.secret.serviceAccount);
  const token = await googleToken(sa);
  try {
    return (await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, "Google Sheets")) as T;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/ 403/.test(m)) {
      throw new Error(`The sheet isn't shared with ${sa.client_email}. Share it with that address (Viewer is enough).`);
    }
    if (/ 404/.test(m)) throw new Error("No sheet at that link. Check the link, and the tab name if you gave one.");
    if (/has not been used|disabled/.test(m)) throw new Error("Turn on the Google Sheets API in the service account's Cloud project.");
    throw e;
  }
}

const googleSheets: Connector = {
  async test(input) {
    const id = sheetId(input.config);
    const meta = await sheetsCall<{ properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> }>(
      input, `${id}?fields=properties.title,sheets.properties.title`,
    );
    const tabs = (meta.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
    const tab = String(input.config.range ?? "").trim();
    if (tab && !tabs.includes(tab)) throw new Error(`There's no tab called "${tab}". Tabs: ${tabs.join(", ")}.`);
    return `Connected to “${meta.properties?.title ?? "the sheet"}”${tab ? `, tab “${tab}”` : ""}.`;
  },

  async pull(input) {
    const id = sheetId(input.config);
    const tab = String(input.config.range ?? "").trim();
    const range = tab ? `'${tab.replace(/'/g, "''")}'` : "A:ZZ";
    const data = await sheetsCall<{ values?: unknown[][] }>(input, `${id}/values/${encodeURIComponent(range)}`);
    const link = `https://docs.google.com/spreadsheets/d/${id}`;
    return rowsToRecords(data.values ?? []).slice(0, MAX_RECORDS).map(({ row, record }) => {
      const m = mapRecord(record);
      return {
        externalId: m.externalId || `row-${row}`,
        name: m.name, company: m.company, email: m.email, phone: m.phone,
        fields: { ...record, _row: row },
        sourceUrl: link,
      };
    });
  },
};

// ── Webhooks ─────────────────────────────────────────────────────────────

const webhookIn: Connector = {
  async test() {
    return "Ready. Send a POST with a JSON body to its URL.";
  },
};

const webhookOut: Connector = {
  async test({ config }) {
    checkOutgoingUrl(String(config.url ?? ""));
    return "The URL looks right. Use “Send test event” to try it.";
  },
};

/**
 * Where an outgoing webhook may post. https only in production; plain http
 * is allowed while developing so it can be pointed at this app's own
 * incoming webhook on localhost.
 */
export function checkOutgoingUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("That isn't a URL."); }
  const dev = process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) {
    throw new Error("The URL must start with https://.");
  }
  if (!dev && /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?)/i.test(url.hostname)) {
    throw new Error("That address points inside a private network.");
  }
  return url;
}

export const CONNECTORS: Partial<Record<string, Connector>> = {
  hubspot,
  google_sheets: googleSheets,
  webhook_in: webhookIn,
  webhook_out: webhookOut,
};
