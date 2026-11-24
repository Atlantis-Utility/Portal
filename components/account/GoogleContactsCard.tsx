"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, RefreshCw } from "lucide-react";
import Select from "@/components/ui/Select";
import { usePolling } from "@/lib/use-polling";
import { useToast } from "@/lib/toast";

/**
 * "Google contacts" on the Account page: connect your Google account and
 * whatever you save there turns up in your extension's RingLogix contact
 * book a few minutes later. See lib/google-contacts.ts.
 */

interface ExtensionOption { user: string; name: string; email: string; takenBy: string | null }
interface SyncStatus {
  googleEmail: string;
  extension: string;
  enabled: boolean;
  removing: boolean;
  lastSyncAt: string | null;
  lastStatus: "never" | "ok" | "error";
  lastError: string;
  counts: { pending: number; synced: number; clash: number; skipped: number; error: number };
  problems: Array<{ name: string; state: "clash" | "error"; note: string }>;
}
interface Answer {
  configured?: boolean;
  status?: SyncStatus | null;
  extensions?: ExtensionOption[];
  suggested?: string;
  error?: string;
}

// What the connect round trip can come back with (?google=…).
const RETURNS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google is connected. Your contacts are being copied now." },
  cancelled: { ok: false, text: "Google sign-in was cancelled." },
  expired: { ok: false, text: "That sign-in took too long or was opened twice. Try again." },
  bad_extension: { ok: false, text: "That extension isn't on the phone system." },
  extension_taken: { ok: false, text: "Someone else's Google contacts already sync into that extension." },
  no_contacts_permission: { ok: false, text: "Google didn't allow reading your contacts. Try again and leave the contacts box ticked." },
  not_configured: { ok: false, text: "Google sync isn't switched on for this site yet." },
  error: { ok: false, text: "Couldn't connect Google. Try again." },
};

function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" className="shrink-0" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const btn = "shrink-0 border border-[#eaeaea] bg-white text-[13px] font-medium text-[#0a0a0a] px-3 py-1.5 rounded-lg hover:bg-[#fafafa] transition-colors disabled:opacity-50";

export default function GoogleContactsCard() {
  const toast = useToast();
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "sync" | "ext" | "disconnect">("");
  const [ext, setExt] = useState("");
  const [changing, setChanging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  // The connect round trip lands back here with ?google=…; read once.
  const [returned] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("google") ?? "",
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/google-contacts", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Answer;
      if (!res.ok) throw new Error(body.error ?? "Couldn't load Google sync");
      setData(body);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load Google sync");
    }
  }, []);

  // Sets state only once the fetch answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!returned) return;
    // Out of the address bar, so a reload doesn't repeat the message.
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    window.history.replaceState(null, "", url.toString());
  }, [returned]);

  const status = data?.status ?? null;
  const working = Boolean(status && (status.removing || status.counts.pending > 0 || (status.lastStatus === "never" && status.enabled)));
  usePolling(load, 8_000, working);

  const options = (data?.extensions ?? [])
    .filter((o) => !o.takenBy)
    .map((o) => ({ value: o.user, label: o.name ? `${o.user} · ${o.name}` : o.user }));
  const chosen = ext || data?.suggested || "";

  async function call(method: "POST" | "PATCH" | "DELETE", which: typeof busy, opts?: { body?: unknown; query?: string }) {
    setBusy(which);
    try {
      const res = await fetch(`/api/google-contacts${opts?.query ?? ""}`, {
        method,
        headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.error ?? body.message ?? "That didn't work");
      return body;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
      return null;
    } finally {
      setBusy("");
      await load();
    }
  }

  const back = returned ? RETURNS[returned] : null;

  return (
    <div className="bg-white border border-[#eaeaea] rounded-xl p-6">
      <p className="text-[10px] font-semibold text-[#999] uppercase tracking-widest mb-2">Google contacts</p>

      {back && (
        <p className={`mb-3 text-xs rounded-lg px-3 py-2 ${back.ok ? "bg-tint-green text-ink-green" : "bg-tint-rose text-ink-rose"}`}>
          {back.text}
        </p>
      )}

      {error ? (
        <p className="text-sm text-[#666] flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-[#f31260] shrink-0" /> {error}
        </p>
      ) : !data ? (
        <p className="text-sm text-[#999]">Loading…</p>
      ) : !data.configured ? (
        <p className="text-sm text-[#666]">
          Syncing Google contacts isn&apos;t switched on for this site yet. An administrator needs to add the Google
          sign-in keys.
        </p>
      ) : !status ? (
        // ── Not connected ──
        <>
          <p className="text-sm text-[#666] mb-4">
            Sign in with Google and the contacts you save there appear in your extension&apos;s phone contact book,
            and stay up to date. Google is only read, never changed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <Select value={chosen} onChange={setExt} options={options} placeholder="Your extension" searchable />
            </div>
            <button
              type="button"
              disabled={!chosen}
              onClick={() => { window.location.href = `/api/google-contacts/connect?ext=${encodeURIComponent(chosen)}`; }}
              className={`${btn} flex items-center gap-2`}
            >
              <GoogleMark /> Connect Google
            </button>
          </div>
        </>
      ) : status.removing ? (
        <p className="text-sm text-[#666] flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#999]" />
          Removing the contacts Google sync added. This can take a few minutes.
        </p>
      ) : (
        // ── Connected ──
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-[#0a0a0a] flex items-center gap-2">
                <GoogleMark />
                <span className="truncate">{status.googleEmail || "Your Google account"}</span>
                <span className="text-[#999]">→</span>
                <span className="whitespace-nowrap">extension {status.extension}</span>
              </p>
              <p className="text-xs text-[#999] mt-1">
                {working ? "Copying your contacts…" : `Last checked ${ago(status.lastSyncAt)}`}
                {" · checks for changes every 5 minutes"}
              </p>
            </div>
            <button type="button" disabled={Boolean(busy) || !status.enabled} onClick={() => call("POST", "sync")} className={`${btn} flex items-center gap-1.5`}>
              <RefreshCw className={`w-3.5 h-3.5 ${busy === "sync" ? "animate-spin" : ""}`} /> Sync now
            </button>
          </div>

          {!status.enabled ? (
            <div className="mt-4 text-xs bg-tint-rose text-ink-rose rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <span>{status.lastError || "Sync is paused."}</span>
              <button
                type="button"
                onClick={() => { window.location.href = `/api/google-contacts/connect?ext=${encodeURIComponent(status.extension)}`; }}
                className="shrink-0 font-medium underline"
              >
                Connect again
              </button>
            </div>
          ) : status.lastStatus === "error" && status.lastError ? (
            <p className="mt-4 text-xs bg-tint-amber text-ink-amber rounded-lg px-3 py-2">Last sync: {status.lastError}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-tint-green text-ink-green">{status.counts.synced} in your contact book</span>
            {status.counts.pending > 0 && <span className="px-2 py-0.5 rounded-full bg-tint-blue text-ink-blue">{status.counts.pending} on the way</span>}
            {status.counts.clash + status.counts.error > 0 && (
              <button type="button" onClick={() => setShowProblems((v) => !v)} className="px-2 py-0.5 rounded-full bg-tint-amber text-ink-amber flex items-center gap-1">
                {status.counts.clash + status.counts.error} not added
                <ChevronDown className={`w-3 h-3 transition-transform ${showProblems ? "rotate-180" : ""}`} />
              </button>
            )}
            {status.counts.skipped > 0 && <span className="px-2 py-0.5 rounded-full bg-tint-slate text-ink-slate">{status.counts.skipped} without a phone number</span>}
          </div>

          {showProblems && status.problems.length > 0 && (
            <div className="mt-3 border border-[#eaeaea] rounded-lg divide-y divide-[#eaeaea] max-h-56 overflow-y-auto">
              <p className="px-3 py-2 text-[11px] text-[#666]">
                RingLogix keeps one contact per name, so these were left out rather than overwrite a contact that was
                already there. Rename one of them and it goes in on the next sync.
              </p>
              {status.problems.map((p, i) => (
                <div key={i} className="px-3 py-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="text-[#0a0a0a] truncate">{p.name || "(no name)"}</span>
                  <span className="text-[#999] text-right">{p.note}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-[#eaeaea] flex flex-wrap items-center gap-2">
            {changing ? (
              <>
                <div className="w-56">
                  <Select value={ext || status.extension} onChange={setExt} options={options} searchable />
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy) || !ext || ext === status.extension}
                  onClick={async () => {
                    if (await call("PATCH", "ext", { body: { extension: ext } })) {
                      toast.success(`Moving your Google contacts to extension ${ext}.`);
                      setChanging(false);
                    }
                  }}
                  className={btn}
                >
                  Move them
                </button>
                <button type="button" onClick={() => { setChanging(false); setExt(""); }} className="text-[13px] text-[#666] px-2">Cancel</button>
              </>
            ) : leaving ? (
              <>
                <span className="text-xs text-[#666] mr-1">Disconnect Google. The {status.counts.synced} contacts it added:</span>
                <button type="button" disabled={Boolean(busy)} onClick={async () => { if (await call("DELETE", "disconnect")) { setLeaving(false); toast.success("Google disconnected. Your contacts were kept."); } }} className={btn}>
                  Keep them
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={async () => { if (await call("DELETE", "disconnect", { query: "?remove=1" })) setLeaving(false); }} className={`${btn} text-[#f31260]`}>
                  Remove them
                </button>
                <button type="button" onClick={() => setLeaving(false)} className="text-[13px] text-[#666] px-2">Cancel</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setChanging(true); setExt(status.extension); }} className={btn}>Change extension</button>
                <button type="button" onClick={() => setLeaving(true)} className={btn}>Disconnect</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
