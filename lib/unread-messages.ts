"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The unread-texts count behind the badge on Messages in the sidebar.
 *
 * One small store for the whole app: the shell polls the light
 * /api/ringlogix/messages/unread route, and the Messages page publishes
 * its own count whenever it loads, so reading a conversation clears the
 * badge straight away rather than at the next poll.
 */
let count = 0;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setUnreadMessages(n: number) {
  const next = Math.max(0, Math.floor(n || 0));
  if (next === count) return;
  count = next;
  for (const fn of listeners) fn();
}

export function useUnreadMessages(): number {
  return useSyncExternalStore(subscribe, () => count, () => 0);
}

const POLL_MS = 30_000;

/**
 * Keeps the count fresh: on mount, every half minute while the tab is
 * being looked at, and the moment it's looked at again.
 */
export function useUnreadPoller(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/ringlogix/messages/unread", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { unread?: number };
        if (alive) setUnreadMessages(data.unread ?? 0);
      } catch {
        // A missed poll just means the badge waits for the next one.
      }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled]);
}
