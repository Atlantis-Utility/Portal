"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `fn` every `ms` while the tab is being looked at, and the moment it
 * is looked at again - for data that lives somewhere Supabase realtime
 * can't reach (RingLogix, Microsoft, server-only tables).
 *
 * Always calls the latest `fn`, so callers can pass an inline function
 * without restarting the timer on every render.
 */
export function usePolling(fn: () => void, ms: number, enabled = true) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}
