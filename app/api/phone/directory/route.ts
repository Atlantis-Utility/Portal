import { NextResponse } from "next/server";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { readAllBooks } from "@/lib/contact-books";
import { getSubscribers, ourDomain } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";
import type { DirectoryEntry } from "@/lib/phone/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who you can call from the portal phone: every RingLogix contact (all the
 * books, as on the Contacts page) and every colleague by extension.
 */

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function GET() {
  try {
    await requireEmployee();
    const domain = ourDomain();
    const [books, subscribers] = await Promise.all([
      readAllBooks(domain),
      getSubscribers(domain) as Promise<Array<{ user?: string; first_name?: string; last_name?: string }>>,
    ]);

    const out: DirectoryEntry[] = [];
    const seen = new Set<string>();
    for (const c of books) {
      const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.replace(/\s+/g, " ").trim() || c.company || "";
      const numbers = ([
        ["Mobile", c.cell_phone], ["Work", c.work_phone], ["Home", c.home_phone],
      ] as const)
        .map(([label, n]) => ({ label, number: digits(n) }))
        .filter((n) => n.number.length >= 3);
      if (!name || numbers.length === 0) continue;
      // The same person saved in two books is one entry here.
      const key = `${name.toLowerCase()}|${numbers.map((n) => n.number).sort().join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `c:${c.user}:${c.contact_id ?? key}`, name, detail: c.company || "", kind: "contact", numbers });
    }
    for (const s of subscribers ?? []) {
      const ext = String(s.user ?? "");
      const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.replace(/\s+/g, " ").trim();
      if (!ext || ext === "api" || !name) continue;
      out.push({ id: `x:${ext}`, name, detail: `Extension ${ext}`, kind: "colleague", numbers: [{ label: "Extension", number: ext }] });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ entries: out }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}
