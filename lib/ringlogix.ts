import { withCache, invalidate } from "./server-cache";
export { invalidate as invalidateRinglogixCache };

const RINGLOGIX_API_BASE = "https://api.ringlogix.com/pbx/v1";
const API_ID     = process.env.RINGLOGIX_API_ID;
const API_SECRET = process.env.RINGLOGIX_API_SECRET;
const RL_USER    = process.env.RINGLOGIX_USERNAME;
const RL_PASS    = process.env.RINGLOGIX_PASSWORD;

export function isConfigured(): boolean {
  return Boolean(API_ID && API_SECRET && RL_USER && RL_PASS);
}

/**
 * Our own PBX domain - the one Atlantis's extensions and SMS numbers live
 * on, as opposed to a customer's.
 *
 * Read from the API user's own name (`api@277215`), which is where it is
 * least likely to drift: an account that moves domains brings its username
 * with it. The client id carries the same number in its `c<domain>`
 * segment, which is the fallback.
 */
export function ourDomain(): string {
  const fromUser = (RL_USER ?? "").split("@")[1]?.trim();
  if (fromUser) return fromUser;
  return (API_ID ?? "").match(/-c(\d+)/)?.[1] ?? "";
}

type RLToken = { value: string; type: string; expiresAt: number; refreshToken: string };

// In-memory token cache (per server process)
let cachedToken: RLToken | null = null;

async function fetchToken(body: Record<string, string>): Promise<RLToken> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.append(k, v);

  const res = await fetch(`${RINGLOGIX_API_BASE}/oauth2/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // The token endpoint answers failures with an empty body and puts the
    // actual reason in a "Warning" header — "Invalid User Login" when the
    // user lacks API access, "Invalid_client [OA051]" for a bad
    // client_id/secret. Without it every failure reads as a bare 403.
    const reason = res.headers.get("warning") ?? text.slice(0, 300);
    throw new Error(`RingLogix auth failed ${res.status}: ${reason || "no reason given"}`);
  }

  const data = await res.json();
  const expiresIn: number = data.expires_in ?? 3600;

  return {
    value: data.access_token,
    type: data.token_type ?? "Bearer",
    expiresAt: Date.now() + expiresIn * 1000,
    refreshToken: data.refresh_token ?? "",
  };
}

async function getToken(): Promise<{ token: string; type: string }> {
  const now = Date.now();

  // Use cached token if still valid (60s buffer)
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return { token: cachedToken.value, type: cachedToken.type };
  }

  // Try refresh token first if we have one
  if (cachedToken?.refreshToken) {
    try {
      cachedToken = await fetchToken({
        grant_type: "refresh_token",
        client_id: API_ID!,
        client_secret: API_SECRET!,
        refresh_token: cachedToken.refreshToken,
        scope: "office_manager",
      });
      return { token: cachedToken.value, type: cachedToken.type };
    } catch {
      cachedToken = null;
    }
  }

  // Full password grant
  cachedToken = await fetchToken({
    grant_type: "password",
    client_id: API_ID!,
    client_secret: API_SECRET!,
    username: RL_USER!,
    password: RL_PASS!,
    scope: "office_manager",
  });

  return { token: cachedToken.value, type: cachedToken.type };
}

/**
 * The Authorization header the API expects, for the one case that needs
 * to fetch a RingLogix URL directly rather than through pbxApi: an
 * attachment, which lives behind its own token-protected address.
 */
export async function ringlogixAuthHeader(): Promise<string> {
  const { token, type } = await getToken();
  return `${type} ${token}`;
}

/**
 * A refusal from the RingLogix API, with the reason it actually gave.
 *
 * `denied` separates "we are not allowed to ask this" from "the request
 * went wrong". It is the difference between a Retry button that might work
 * and one that cannot: an account whose scope has been changed will answer
 * 401 "Invalid Scope [APP001]" to every object, for as long as it takes
 * somebody to put the scope back in the RingLogix portal.
 *
 * 401 and 403 both mean permissions here, despite what the numbers usually
 * say. The token is fine - it is issued, it just carries whatever scope the
 * API user holds - and 403 is how a single object is blocked for an account
 * that otherwise works.
 */
export class RingLogixError extends Error {
  readonly object: string;
  readonly action: string;
  readonly status: number;
  /** What the Warning header said, e.g. "Invalid Scope [APP001]". */
  readonly reason: string;
  readonly denied: boolean;

  constructor(object: string, action: string, status: number, reason: string) {
    super(`RingLogix ${object}/${action} ${status}: ${reason || "no reason given"}`);
    this.name = "RingLogixError";
    this.object = object;
    this.action = action;
    this.status = status;
    this.reason = reason;
    this.denied = status === 401 || status === 403;
  }
}

const READ_ACTIONS = new Set(["read", "list"]);
const RL_TTL = 3 * 60_000; // 3 minutes for read-only data

/**
 * Messages are the exception to the three-minute cache.
 *
 * Everything else here - numbers, devices, subscribers - changes when
 * somebody provisions something, so three minutes is generous. A text
 * arrives whenever the customer decides to send one, and a message list
 * served from a three-minute cache cannot be polled: the page would ask
 * every ten seconds and be told the same thing for three minutes.
 *
 * Short enough to feel live, long enough that ten people watching the
 * inbox is still a handful of calls a minute rather than sixty.
 */
const RL_MESSAGE_TTL = 5_000;
const LIVE_OBJECTS = new Set(["messagesession", "message"]);

/**
 * Contacts sit in between: people save them from the inbox and expect the
 * name to appear at once. Saving or deleting one clears this server's copy
 * (see createContact), but a deployment runs several servers, each with its
 * own cache, so the others catch up within this long rather than three
 * minutes.
 */
const RL_CONTACT_TTL = 20_000;
const CONTACT_OBJECTS = new Set(["contact"]);

/**
 * The Inbox (voicemails via UC Inbox, calls via call history): a new
 * voicemail should show within a minute, but reading every extension's box
 * is ~50 calls under a rate limit, so not every poll.
 */
const RL_INBOX_TTL = 45_000;
const INBOX_OBJECTS = new Set(["conversation", "cdr2"]);

async function pbxApiRaw(
  object: string,
  action: string,
  params: Record<string, string> = {},
) {
  if (!isConfigured()) throw new Error("RINGLOGIX_NOT_CONFIGURED");

  const { token, type } = await getToken();

  const url = `${RINGLOGIX_API_BASE}/?object=${encodeURIComponent(object)}&action=${encodeURIComponent(action)}`;

  const form = new FormData();
  form.append("format", "json");
  for (const [k, v] of Object.entries(params)) form.append(k, v);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `${type} ${token}` },
    body: form,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Same trick as the token endpoint: the body is empty and the reason is
    // in a "Warning" header. Without reading it, every refusal arrives as a
    // bare "401: " and the next person has no idea the API user's scope was
    // changed out from under them.
    const reason = res.headers.get("warning") ?? text.slice(0, 300);
    throw new RingLogixError(object, action, res.status, reason);
  }

  // An accepted write answers 202 with no body at all - messagesession's
  // update does, and so does a media send. res.json() on an empty body
  // throws "Unexpected end of JSON input", which surfaced as a failed
  // mark-as-read for a change that had in fact been made.
  const body = await res.text();
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    // 200 with something that isn't JSON is not a failure either; the
    // caller asked for `format=json` and got what it got.
    return null;
  }
}

function pbxApi(
  object: string,
  action: string,
  params: Record<string, string> = {},
) {
  const doFetch = () => pbxApiRaw(object, action, params);
  if (!READ_ACTIONS.has(action)) return doFetch();
  // Stable cache key from sorted params
  const paramStr = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const ttl = LIVE_OBJECTS.has(object) ? RL_MESSAGE_TTL
    : CONTACT_OBJECTS.has(object) ? RL_CONTACT_TTL
    : INBOX_OBJECTS.has(object) ? RL_INBOX_TTL
    : RL_TTL;
  return withCache(`rl:${object}:${action}:${paramStr}`, ttl, doFetch);
}

// Domains = customer accounts in reseller context
export async function getCustomers() {
  return pbxApi("domain", "read");
}

export async function getCustomer(domain: string) {
  return pbxApi("domain", "read", { domain });
}

// Phone numbers / DIDs. The "smsnumber" object name is misleading — it's
// SMS-only and returns null for every domain in this account. The real DID
// inventory (with a human label per number, e.g. "Main Number", "Fax") lives
// in the "phonenumber" object's dial-plan rules, tagged per-row with
// "domain_owner" (the customer's domain id). The API's own domain_owner
// filter proved unreliable (returned the unfiltered list on repeat calls
// with identical params), so this always fetches the full list — cached for
// 3 minutes and shared across every customer — and filters locally instead.
export async function getDIDs(domain?: string) {
  const rows = ((await pbxApi("phonenumber", "read", {})) ?? []) as Array<Record<string, unknown>>;
  if (!domain) return rows;
  return rows.filter((r) => String(r.domain_owner) === domain);
}

// Call records (CDRs)
export async function getCDRs(opts?: {
  domain?: string;
  limit?: string;
  startDate?: string;
  endDate?: string;
}) {
  const params: Record<string, string> = {};
  if (opts?.domain)    params.domain     = opts.domain;
  if (opts?.limit)     params.limit      = opts.limit;
  if (opts?.startDate) params.start_time = opts.startDate;
  if (opts?.endDate)   params.end_time   = opts.endDate;
  return pbxApi("cdr2", "read", params);
}

/**
 * SMS/MMS conversations for one extension.
 *
 * Texts to our numbers surface in Teams through the RingLogix connector,
 * but Teams is only displaying them - the messages themselves live here,
 * and this is the only place they can be read from.
 *
 * Both `domain` and `user` are required: the API answers "Please include
 * domain and user fields" without them, because a session belongs to the
 * extension that holds the conversation rather than to the number.
 */
export async function getMessageSessions(domain: string, user: string) {
  return pbxApi("messagesession", "read", { domain, user });
}

/** Every message in one conversation, newest first as stored. */
/**
 * UC Inbox: one extension's chats and voicemails in one list, each tagged
 * `conversation_type` ("chat", "vmail"; the docs also name "call" and "fax",
 * which this tenant never returns - calls come from call history instead).
 * Refuses `user=*`, so a whole-domain read walks the extensions.
 */
export async function getUcConversations(domain: string, user: string) {
  return pbxApi("conversation", "read", { domain, user });
}

/**
 * Call history for the domain between two UTC times ("YYYY-MM-DD HH:MM:SS").
 * Rows carry `type` 0 = outgoing, 1 = incoming, 3 = internal, and epoch
 * seconds in `time_start` / `time_answer` / `time_release`.
 */
export async function getCallHistory(domain: string, startDate: string, endDate: string, limit = 500) {
  return pbxApi("cdr2", "read", { domain, start_date: startDate, end_date: endDate, limit: String(limit) });
}

export async function getMessages(domain: string, user: string, sessionId: string) {
  return pbxApi("message", "read", { domain, user, session_id: sessionId });
}

/**
 * Sends a message: a text to the outside world, or a chat to a colleague.
 *
 * `type` is the difference and the default is wrong for our purposes.
 * Without it RingLogix creates a *chat* - an internal message addressed to
 * a user inside the domain. Aimed at a customer's number that user does
 * not exist, so the message is accepted (202, no warning) and simply never
 * goes anywhere. It took sending one to our own second line to see it:
 * `"type":"chat"`, `term_uid:"18054833939@277215"`, and no carrier.
 *
 * An SMS additionally needs `from_num` - which of our numbers it comes
 * from - and RingLogix refuses without it. The answer is the `smsani` on
 * the conversation, so a reply arrives from the number they already know.
 *
 * Passing no `fromNumber` sends an internal chat, which is the right
 * behaviour when the other party is an extension rather than a number.
 *
 * A write, so it deliberately bypasses the read cache in pbxApi.
 */
export async function sendMessage(opts: {
  domain: string;
  user: string;
  destination: string;
  message: string;
  /** Our number, for a text. Omit to send an internal chat. */
  fromNumber?: string;
}) {
  const params: Record<string, string> = {
    domain: opts.domain,
    user: opts.user,
    destination: opts.destination,
    message: opts.message,
  };
  if (opts.fromNumber) {
    params.type = "sms";
    params.from_num = opts.fromNumber;
  }
  const sent = await pbxApi("message", "create", params);
  // Drop the cached view of this mailbox so the next poll sees the reply
  // rather than a list from before it was sent.
  invalidate("rl:messagesession");
  invalidate("rl:message:");
  return sent;
}

/**
 * The PBX's own API, v2, on the core server rather than the v1 gateway.
 *
 * The gateway (api.ringlogix.com/pbx/v1) has no way to attach a file:
 * `upload/create` answers nothing and `upload_id` goes undocumented. The
 * core server runs NetSapiens v2, which takes the file inline in the send
 * itself, and our gateway token is accepted there unchanged (verified
 * 2026-11-23, NetSapiens 44.4.8). It's the host every received attachment's
 * `remotepath` already points at.
 */
const RINGLOGIX_CORE_BASE = (process.env.RINGLOGIX_CORE_URL || "https://core2-mia.ringlogix.com").replace(/\/+$/, "") + "/ns-api/v2";

/**
 * Sends a picture or file into an existing conversation: an MMS to numbers
 * outside, or a media chat to a colleague's extension.
 *
 * v2 requires `message` (at least one character), so a file sent on its own
 * carries a single space. Answers 202 with no id - the caller finds the
 * stored message by reading the conversation back.
 */
export async function sendMedia(opts: {
  domain: string;
  user: string;
  sessionId: string;
  /** Numbers (a group lists several), or one extension for a chat. */
  destination: string[];
  message: string;
  /** Our number, for an MMS. Omit for an internal media chat. */
  fromNumber?: string;
  file: { data: Buffer; mimeType: string };
}) {
  if (!isConfigured()) throw new Error("RINGLOGIX_NOT_CONFIGURED");
  const { token, type } = await getToken();
  const body: Record<string, unknown> = {
    type: opts.fromNumber ? "mms" : "chat-media",
    message: opts.message.trim() || " ",
    destination: opts.destination.length === 1 ? opts.destination[0] : opts.destination,
    data: opts.file.data.toString("base64"),
    "mime-type": opts.file.mimeType,
    size: opts.file.data.length,
  };
  if (opts.fromNumber) body["from-number"] = opts.fromNumber;

  const path = `/domains/${encodeURIComponent(opts.domain)}/users/${encodeURIComponent(opts.user)}` +
    `/messagesessions/${encodeURIComponent(opts.sessionId)}/messages`;
  const res = await fetch(RINGLOGIX_CORE_BASE + path, {
    method: "POST",
    headers: { Authorization: `${type} ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let reason = res.headers.get("warning") ?? "";
    if (!reason) {
      try { reason = String(JSON.parse(text).message ?? ""); } catch { reason = text.slice(0, 300); }
    }
    throw new RingLogixError("message", "create-media", res.status, reason);
  }
  invalidate("rl:messagesession");
  invalidate("rl:message:");
}

/** A SIP device on an extension, as the v2 core reports it. */
export interface PbxDevice {
  device: string;
  user: string;
  domain: string;
  "device-sip-registration-password"?: string;
  "device-sip-registration-state"?: string;
}

/**
 * The v2 core, for what the gateway can't do.
 *
 * The device paths answer 404, empty, unless the URL carries a query
 * string; the same URL with `?…` attached answers 200 (seen 2026-11-24 on
 * both reading and creating a device). So a harmless one is always added.
 */
export async function coreApi(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  if (!isConfigured()) throw new Error("RINGLOGIX_NOT_CONFIGURED");
  const { token, type } = await getToken();
  const url = RINGLOGIX_CORE_BASE + path + (path.includes("?") ? "&" : "?") + "client=portal";
  const res = await fetch(url, {
    method,
    headers: { Authorization: `${type} ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** One device, with its SIP password; null if there's no such device. */
export async function getDevice(domain: string, user: string, device: string): Promise<PbxDevice | null> {
  const { status, data } = await coreApi(
    "GET",
    `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(user)}/devices/${encodeURIComponent(device)}`,
  );
  if (status === 404) return null;
  if (status !== 200) throw new RingLogixError("device", "read", status, String((data as { message?: string })?.message ?? ""));
  return data as PbxDevice;
}

/** Adds a device to an extension; RingLogix picks its SIP password. */
export async function createDevice(domain: string, user: string, device: string): Promise<PbxDevice> {
  const { status, data } = await coreApi(
    "POST",
    `/domains/${encodeURIComponent(domain)}/users/${encodeURIComponent(user)}/devices?synchronous=yes`,
    { device, synchronous: "yes" },
  );
  if (status !== 200 && status !== 201) {
    throw new RingLogixError("device", "create", status, String((data as { message?: string })?.message ?? ""));
  }
  return data as PbxDevice;
}

/**
 * Marks a conversation read or unread.
 *
 * Written through to the PBX rather than kept locally, so that marking
 * something read here marks it read in Teams too - two inboxes that
 * disagree about what has been dealt with is worse than neither.
 */
export async function setMessageSessionStatus(opts: {
  domain: string;
  user: string;
  sessionId: string;
  read: boolean;
}) {
  const result = await pbxApi("messagesession", "update", {
    domain: opts.domain,
    user: opts.user,
    session_id: opts.sessionId,
    last_status: opts.read ? "read" : "unread",
  });
  invalidate("rl:messagesession");
  return result;
}

/**
 * Names a conversation, or clears the name.
 *
 * Stored in the PBX rather than in our own tables, so a group somebody
 * names here is named in Teams as well - the two are windows onto one
 * mailbox, and a name that only exists in one of them is a name half the
 * company cannot see.
 */
export async function setMessageSessionName(opts: {
  domain: string;
  user: string;
  sessionId: string;
  name: string;
}) {
  const result = await pbxApi("messagesession", "update", {
    domain: opts.domain,
    user: opts.user,
    session_id: opts.sessionId,
    session_name: opts.name,
  });
  invalidate("rl:messagesession");
  return result;
}

// Reseller client billing
export async function getBilling(domain?: string) {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  return pbxApi("reseller_client", "read", params);
}

// Subscribers / extensions
export async function getSubscribers(domain?: string) {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  return pbxApi("subscriber", "read", params);
}

// SIP devices / registered phones
/**
 * The provisioned device inventory: actual hardware, one row per MAC.
 *
 * Not the same thing as device/read, which lists SIP endpoints. Those
 * include every soft registration and every extension that answers calls
 * without being a phone at all (auto attendants, paging, "Internet
 * Service"), which is why the Devices tab used to show 193 "devices" for a
 * customer that owns 58. It also misses hardware that happens not to be
 * registered right now: two customers show 0 endpoints against 24 and 29
 * real phones.
 *
 * The object is called "mac" because that's its key. Each row carries the
 * model and device1..deviceN, the lines programmed onto that phone.
 */
export async function getDeviceInventory(domain?: string) {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  return pbxApi("mac", "read", params);
}

export async function getDevices(domain?: string) {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  return pbxApi("device", "read", params);
}

// Call queues
export async function getQueues(domain?: string) {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  return pbxApi("callqueue", "read", params);
}

// Conference rooms
export async function getConferences(domain?: string) {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  return pbxApi("conference", "read", params);
}

// Call recordings
export async function getRecordings(opts?: { domain?: string; limit?: string }) {
  const params: Record<string, string> = {};
  if (opts?.domain) params.domain = opts.domain;
  if (opts?.limit)  params.limit  = opts.limit;
  return pbxApi("recording", "read", params);
}

// Territories (reseller regions)
export async function getTerritories() {
  return pbxApi("territory", "read");
}

// Dial plans
export async function getDialplans(domain?: string) {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  return pbxApi("dialplan", "read", params);
}

// Contacts
export async function getContacts(domain: string, user: string, opts?: { first_name?: string; last_name?: string; limit?: string }) {
  const params: Record<string, string> = { domain, user };
  if (opts?.first_name) params.first_name = opts.first_name;
  if (opts?.last_name)  params.last_name  = opts.last_name;
  if (opts?.limit)      params.limit      = opts.limit;
  return pbxApi("contact", "read", params);
}

export async function createContact(domain: string, user: string, firstName: string, lastName: string, opts?: { home_phone?: string; cell_phone?: string; work_phone?: string; email?: string; company?: string }) {
  const params: Record<string, string> = { domain, user, first_name: firstName, last_name: lastName };
  if (opts?.company)    params.company    = opts.company;
  if (opts?.work_phone) params.work_phone = opts.work_phone;
  if (opts?.cell_phone) params.cell_phone = opts.cell_phone;
  if (opts?.home_phone) params.home_phone = opts.home_phone;
  if (opts?.email)      params.email      = opts.email;
  const created = await pbxApi("contact", "create", params);
  // The next read must see it: the inbox names numbers from these books.
  invalidate("rl:contact:");
  return created;
}

export async function deleteContact(domain: string, user: string, firstName: string, lastName: string, contactId: string) {
  const deleted = await pbxApi("contact", "delete", { domain, user, first_name: firstName, last_name: lastName, contact_id: contactId });
  invalidate("rl:contact:");
  return deleted;
}

// Departments
export async function getDepartments(domain: string) {
  return pbxApi("department", "list", { domain });
}

// Device Models
export async function getDeviceModels(opts?: { brand?: string; model?: string }) {
  const params: Record<string, string> = {};
  if (opts?.brand) params.brand = opts.brand;
  if (opts?.model) params.model = opts.model;
  return pbxApi("devicemodel", "read", params);
}

// Call Requests / Wake-Up Calls
export async function getCallRequests(opts?: { domain?: string; user?: string }) {
  const params: Record<string, string> = {};
  if (opts?.domain) params.domain = opts.domain;
  if (opts?.user)   params.user   = opts.user;
  return pbxApi("callrequest", "read", params);
}

export async function addWakeUpCall(uid: string, opts: { timeToCall?: string; dDay?: string; dHour?: string; dMin?: string }) {
  const params: Record<string, string> = { uid };
  if (opts.timeToCall) params.timeToCall = opts.timeToCall;
  if (opts.dDay)       params.dDay       = opts.dDay;
  if (opts.dHour)      params.dHour      = opts.dHour;
  if (opts.dMin)       params.dMin       = opts.dMin;
  return pbxApi("callrequest", "addWakeUp", params);
}

export async function deleteWakeUpCall(uid: string, requestId?: string) {
  const params: Record<string, string> = { uid };
  if (requestId) params.requestId = requestId;
  return pbxApi("callrequest", "delWakeUp", params);
}

// Dial Rules
export async function getDialRules(domain: string, dialplan: string) {
  return pbxApi("dialrule", "read", { domain, dialplan });
}

export async function createDialRule(domain: string, dialplan: string, matchrule: string, toUser: string) {
  return pbxApi("dialrule", "create", { domain, dialplan, matchrule, to_user: toUser });
}
