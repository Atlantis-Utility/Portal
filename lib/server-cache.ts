/**
 * The in-memory cache in front of RingLogix.
 *
 * Two things beyond a plain TTL:
 *
 *  - One request per key at a time. Several pages, tabs and pollers asking
 *    for the same thing at once share a single RingLogix call instead of
 *    each making their own (and tripping its 429 limit).
 *
 *  - Stale-while-revalidate, when asked for (`staleMs`). Past its TTL an
 *    entry is still answered instantly, for up to `staleMs` longer, while a
 *    fresh copy is fetched in the background. Reading every extension's
 *    contact book or mailbox took 7-9 seconds whenever the cache had
 *    expired; with this only the very first read after a restart waits.
 *    Writes the app makes still clear their keys (invalidate), so an edit
 *    here shows at once; only changes made elsewhere (a desk phone) can be
 *    up to a refresh behind.
 */

const store = new Map<string, { v: unknown; exp: number; staleUntil: number }>();
const inflight = new Map<string, Promise<unknown>>();

function load<T>(key: string, ttlMs: number, staleMs: number, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((v) => {
      const now = Date.now();
      store.set(key, { v, exp: now + ttlMs, staleUntil: now + ttlMs + staleMs });
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>, staleMs = 0): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return Promise.resolve(hit.v as T);
  if (hit && hit.staleUntil > now) {
    // Answer now, refresh behind; a failed refresh keeps the old copy.
    load(key, ttlMs, staleMs, fn).catch(() => {});
    return Promise.resolve(hit.v as T);
  }
  return load(key, ttlMs, staleMs, fn);
}

export function invalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
