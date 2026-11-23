import { tenantDomain } from "@/lib/tenancy";
import { NextRequest, NextResponse } from "next/server";
import { getContacts, getSubscribers, createContact, deleteContact, isConfigured, invalidateRinglogixCache } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";

/**
 * These three had no guard on them at all: anybody who could reach the
 * app could read, create and delete entries in the company's contact
 * book without signing in. Every other RingLogix write checks first.
 */
function refuse(err: unknown) {
  if (err instanceof ApiAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return ringlogixFailure(err);
}

export async function GET(req: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const p = req.nextUrl.searchParams;
  // Ours unless told otherwise, as in the Messages route.
  const domain = await tenantDomain();
  const user   = p.get("user") ?? "";
  try {
    await requireEmployee();
    // No extension named: every book at once - the shared one and each
    // extension's - which is the set Messages uses to name numbers. A
    // contact saved from a conversation lands in that conversation's
    // extension, so a one-book view kept missing them.
    if (!user || user === "all") {
      const subscribers = (await getSubscribers(domain).catch(() => [])) as Array<{ user?: string }>;
      const users = ["*", ...new Set(subscribers.map((s) => (s.user ?? "").trim()).filter(Boolean))];
      const books: Array<Array<Record<string, string>>> = [];
      for (let i = 0; i < users.length; i += 6) {
        books.push(...(await Promise.all(
          users.slice(i, i + 6).map((u) =>
            (getContacts(domain, u) as Promise<Array<Record<string, string>>>)
              .then((rows) => (rows ?? []).map((r) => ({ ...r, user: r.user || u })))
              .catch(() => []),
          ),
        )));
      }
      const seen = new Set<string>();
      const all = books.flat().filter((c) => {
        const key = `${c.user}|${c.contact_id ?? `${c.first_name}|${c.last_name}|${c.cell_phone}`}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return NextResponse.json(all);
    }
    const data = await getContacts(domain, user, {
      first_name: p.get("first_name") ?? undefined,
      last_name:  p.get("last_name")  ?? undefined,
      limit:      p.get("limit")      ?? undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    return refuse(err);
  }
}

export async function POST(req: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  try {
    await requireEmployee();
    const body = await req.json();
    const domain = await tenantDomain();
    const user = String(body.user ?? "").trim();
    if (!user) return NextResponse.json({ error: "Which extension's contact book should it go in?" }, { status: 400 });

    // RingLogix matches contacts BY NAME on create: a second "John Smith"
    // in a book overwrites the first one's details rather than adding an
    // entry (verified 2026-11-23). So unless the caller has confirmed a
    // replace, a same-name contact already in that book stops the save and
    // is named, and the page asks. Read fresh: a cached book could miss one
    // saved a moment ago.
    if (body.replace !== true) {
      invalidateRinglogixCache("rl:contact:");
      const book = ((await getContacts(domain, user).catch(() => [])) ?? []) as Array<Record<string, unknown>>;
      const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
      const clash = book.find(
        (c) => norm(c.first_name) === norm(body.first_name) && norm(c.last_name) === norm(body.last_name),
      );
      if (clash) {
        return NextResponse.json(
          {
            error: "A contact with that name is already in this book.",
            existing: {
              name: `${String(clash.first_name ?? "")} ${String(clash.last_name ?? "")}`.trim(),
              book: clash.shared ? "the shared, company-wide book" : `extension ${user}'s book`,
              phone: String(clash.cell_phone || clash.work_phone || clash.home_phone || ""),
              company: String(clash.company ?? ""),
            },
          },
          { status: 409 },
        );
      }
    }

    const data = await createContact(domain, user, body.first_name, body.last_name, {
      company: body.company, work_phone: body.work_phone,
      cell_phone: body.cell_phone, home_phone: body.home_phone, email: body.email,
    });
    return NextResponse.json(data);
  } catch (err) {
    return refuse(err);
  }
}

export async function DELETE(req: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  try {
    await requireEmployee();
    const body = await req.json();
    const data = await deleteContact(await tenantDomain(), body.user, body.first_name, body.last_name, body.contact_id);
    return NextResponse.json(data);
  } catch (err) {
    return refuse(err);
  }
}
