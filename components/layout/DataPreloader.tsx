"use client";

import { useEffect } from "react";

// The ERP warmed localStorage here with UniFi sites and tickets, neither
// of which came across. What is left is the Outlook hand-off after sign-in.
export default function DataPreloader() {
  // Silently connect Outlook Calendar right after a Microsoft OAuth login
  // completes. That flow exchanges its code server-side (app/auth/callback),
  // so the client never sees a "SIGNED_IN" event — auth-context.tsx's handler
  // only catches client-driven sign-ins (e.g. email/password). The callback
  // route flags its redirect with ?post_login=1 so we can detect it here.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("post_login") !== "1") return;

      url.searchParams.delete("post_login");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);

      if (!document.cookie.includes("outlook_connected=1")) {
        setTimeout(() => { window.location.href = "/api/outlook-calendar/connect"; }, 600);
      }
    } catch {}
  }, []);

  return null;
}
