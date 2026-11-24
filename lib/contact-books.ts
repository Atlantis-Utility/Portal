import "server-only";
import { getContacts, getSubscribers, RingLogixError } from "@/lib/ringlogix";

/**
 * One book, retried when RingLogix says to slow down. A book that comes
 * back 429 used to be read as empty, so contacts went missing from the
 * phone and the Contacts page whenever something else was reading too.
 */
async function readBook(domain: string, user: string): Promise<Array<Record<string, string>>> {
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = ((await getContacts(domain, user)) ?? []) as Array<Record<string, string>>;
      return rows.map((r) => ({ ...r, user: r.user || user }));
    } catch (err) {
      if (err instanceof RingLogixError && err.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return [];
    }
  }
}

/**
 * Every RingLogix contact book at once: the shared one ("*") and each
 * extension's. A contact saved from a conversation lands in that
 * conversation's extension, so reading only one book misses people.
 *
 * A shared contact also shows up in every extension's read (with
 * "shared": true); it's kept once, filed under the shared book ("*").
 */
export async function readAllBooks(domain: string): Promise<Array<Record<string, string>>> {
  const subscribers = (await getSubscribers(domain).catch(() => [])) as Array<{ user?: string }>;
  const users = ["*", ...new Set(subscribers.map((s) => (s.user ?? "").trim()).filter(Boolean))];
  const books: Array<Array<Record<string, string>>> = [];
  // Three at a time, as everywhere else that walks the extensions: more
  // and RingLogix answers 429.
  for (let i = 0; i < users.length; i += 3) {
    books.push(...(await Promise.all(users.slice(i, i + 3).map((u) => readBook(domain, u)))));
  }
  const seen = new Set<string>();
  return books
    .flat()
    // A shared contact comes back in every extension's read too (54 copies
    // of one "TesT NUMBER"): keep it once, as the shared book's.
    .map((c) => (String(c.shared) === "true" ? { ...c, user: "*" } : c))
    .filter((c) => {
      const key = `${c.user}|${c.contact_id ?? `${c.first_name}|${c.last_name}|${c.cell_phone}`}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
