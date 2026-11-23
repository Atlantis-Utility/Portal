import { tenantDomain } from "@/lib/tenancy";
import { NextResponse } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { externalContactsByPhone } from "@/lib/integrations/store";
import { getContacts, getMessageSessions, getSubscribers, isConfigured } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";
import {
  normalizeSession, sortConversations, dedupeConversations, namesByExtension,
  type RawMessageSession, type SmsConversation,
} from "@/lib/ringlogix-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every text conversation on a domain.
 *
 * RingLogix keys conversations by extension and refuses a read without a
 * `user`. It does, however, accept `user=*`, which returns the domain's
 * whole mailbox in one call - verified against the alternative below, which
 * walks the subscriber list and returns exactly the same 154 sessions for
 * 54 times the requests.
 *
 * The walk is kept as a fallback rather than deleted: the wildcard is not
 * in any documentation we hold, so if a future release stops honouring it
 * this degrades to slow instead of empty.
 */
const CONCURRENCY = 8;

/** Runs `work` over `items`, a few at a time, keeping the failures quiet. */
async function pooled<T, R>(items: T[], work: (item: T) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out.push(...(await work(items[i])));
      } catch {
        // One extension refusing is not a reason to show nothing: the rest
        // of the mailbox is still worth reading.
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** The slow way: one read per extension, eight at a time. */
async function everyExtension(domain: string): Promise<RawMessageSession[]> {
  const subscribers = (await getSubscribers(domain)) as Array<{ user?: string }>;
  const users = [...new Set(subscribers.map((s) => s.user).filter(Boolean) as string[])];
  return pooled(users, async (user) =>
    ((await getMessageSessions(domain, user)) ?? []) as RawMessageSession[],
  );
}

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const domain = await tenantDomain();
  if (!domain) {
    return NextResponse.json({ error: "No domain to read messages for" }, { status: 400 });
  }

  // Everything that doesn't depend on anything else starts at once: the
  // caller's check, the mailbox, the colleague list, the shared contact
  // book and what connected systems know. Run one after another these
  // added up to about two seconds on a cold start; together they cost the
  // slowest of them. Nothing is returned until the check has passed - the
  // mailbox itself is the whole shared inbox (proxy.ts leaves /api/* to
  // check for itself).
  const auth = requireEmployee().then(() => null, (err: unknown) => err);
  const mailbox = (getMessageSessions(domain, "*") as Promise<RawMessageSession[] | null>).then(
    (rows) => ({ rows: rows ?? [], via: "wildcard" as const }),
    async () => ({ rows: await everyExtension(domain), via: "per-extension" as const }),
  );
  const colleagues = (getSubscribers(domain) as Promise<Array<Record<string, string>>>).catch(() => []);
  const book = (d: string, u: string) =>
    (getContacts(d, u) as Promise<Array<Record<string, string>>>).catch(() => []);
  const sharedBook = book(domain, "*");
  // Missing tables before the integrations migration just mean nothing extra.
  const external = externalContactsByPhone().catch(() => ({} as Awaited<ReturnType<typeof externalContactsByPhone>>));

  const denied = await auth;
  if (denied) {
    if (denied instanceof ApiAuthError) return NextResponse.json({ error: denied.message }, { status: denied.status });
    return ringlogixFailure(denied);
  }

  try {
    const { rows, via } = await mailbox;

    // A conversation with no last message is an empty shell the PBX keeps
    // after a thread is cleared; it has nothing to show.
    const real: SmsConversation[] = rows
      .map(normalizeSession)
      .filter((c) => c.sessionId && (c.lastMessage || c.hasMedia));
    const conversations = sortConversations(dedupeConversations(real));

    // Contact books are per-extension with a shared flag: the shared one
    // (already on its way) plus the extensions that hold conversations,
    // which are only known now. Each is cached.
    const owners = [...new Set(conversations.map((c) => c.user).filter(Boolean))];
    const [subscribers, ...books] = await Promise.all([colleagues, sharedBook, ...owners.map((u) => book(domain, u))]);

    const contacts: Record<string, { name: string; company: string }> = {};
    for (const entries of books) {
      for (const entry of entries ?? []) {
        const name = `${entry.first_name ?? ""} ${entry.last_name ?? ""}`.replace(/s+/g, " ").trim();
        if (!name) continue;
        for (const field of ["cell_phone", "work_phone", "home_phone"]) {
          // Last ten digits, so "805-816-8896" and "18058168896" are one
          // number rather than two.
          const digits = (entry[field] ?? "").replace(/D/g, "").slice(-10);
          if (digits.length === 10 && !contacts[digits]) {
            contacts[digits] = { name, company: (entry.company ?? "").trim() };
          }
        }
      }
    }
    // Then whatever connected systems know (HubSpot, a sheet, a webhook).
    // The phone system's own book wins where both name a number: it is the
    // one Teams shows too.
    for (const [digits, who] of Object.entries(await external)) {
      if (!contacts[digits]) contacts[digits] = { name: who.name, company: who.company };
    }

    // Which of our numbers can send, and from which extension. Derived
    // from the mailbox rather than hardcoded, so a number added or taken
    // away in RingLogix is reflected here without a code change.
    const senders: Array<{ number: string; user: string }> = [];
    for (const c of conversations) {
      if (!c.ourNumber || !c.user) continue;
      if (senders.some((x) => x.number === c.ourNumber)) continue;
      senders.push({ number: c.ourNumber, user: c.user });
    }

    return NextResponse.json({
      domain,
      via,
      senders,
      conversations,
      names: namesByExtension(subscribers ?? []),
      contacts,
      unread: conversations.filter((c) => c.unread).length,
    });
  } catch (err) {
    return ringlogixFailure(err);
  }
}
