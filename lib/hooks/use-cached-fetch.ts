"use client";

import { useState, useEffect, useCallback } from "react";

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

function writeSession<T>(key: string, value: T) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function useCachedFetch<T>(
  cacheKey: string,
  url: string,
  pollMs?: number,
): { data: T | null; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const [data, setData]       = useState<T | null>(() => readSession<T>(cacheKey));
  // With something cached already there is nothing to block the UI on.
  const [loading, setLoading] = useState(() => readSession(cacheKey) === null);
  const [error, setError]     = useState<string | null>(null);

  // A new url is a new fetch, so it belongs in the dependencies rather than
  // in a ref that is written during render.
  const fetchNow = useCallback(async () => {
    try {
      const res  = await fetch(url);
      const json = await res.json() as T;
      setData(json);
      setError(null);
      writeSession(cacheKey, json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [cacheKey, url]);

  useEffect(() => {
    // fetchNow sets state only after its fetch resolves; the rule can't see
    // past the useCallback to tell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNow();
    if (!pollMs) return;
    const iv = setInterval(fetchNow, pollMs);
    return () => clearInterval(iv);
  }, [fetchNow, pollMs]);

  return { data, loading, error, refresh: fetchNow };
}
