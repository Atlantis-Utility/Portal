"use client";

import { useEffect, useState } from "react";
import {
  Plug, RefreshCw, CheckCircle2, AlertCircle, Clock, Play, Pause, Trash2, Pencil, X, Copy,
  ChevronDown, ChevronRight, Send, Link2, KeyRound,
} from "lucide-react";
import Header from "@/components/layout/Header";
import Overlay from "@/components/ui/Overlay";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import {
  OUTGOING_EVENTS, PROVIDERS, providerById,
  type IntegrationEvent, type IntegrationView, type Provider, type ProviderCategory,
} from "@/lib/integrations/catalog";
import { showTime } from "@/lib/workflows/schedule";

const CATEGORIES: ProviderCategory[] = ["CRM", "Spreadsheets", "Webhooks & automation", "Scheduling", "Billing"];

/**
 * Integrations: other systems connected to this one.
 *
 * Connect with a key or a link, test it, sync it, and see what it did.
 * Credentials go to the server and are never shown again; this page only
 * learns whether one is saved.
 */
export default function IntegrationsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<IntegrationView[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<{ provider: Provider; existing: IntegrationView | null } | null>(null);
  const [hookUrl, setHookUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/integrations");
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? "Couldn't load integrations");
        setList(data.integrations ?? []);
        setError("");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't load integrations");
      }
    })();
    return () => { alive = false; };
  }, [version]);

  const reload = () => setVersion((v) => v + 1);

  async function act(item: IntegrationView, what: string) {
    if (what === "delete") {
      const ok = await confirm({
        title: `Remove ${item.name}?`,
        description: "It's disconnected, its saved credential is deleted, and the contacts it brought in are removed from this app. Nothing is changed in the other system.",
        confirmLabel: "Remove",
      });
      if (!ok) return;
    }
    if (what === "new_hook_url") {
      const ok = await confirm({
        title: "Make a new URL?",
        description: "The current URL stops working straight away. Anything sending to it has to be given the new one.",
        confirmLabel: "Make new URL",
      });
      if (!ok) return;
    }
    setBusy(item.id);
    try {
      const res = await fetch(`/api/integrations/${item.id}`, what === "delete"
        ? { method: "DELETE" }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ do: what }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work");
      if (what === "new_hook_url") setHookUrl(data.hookUrl);
      else if ("ok" in data && "message" in data) (data.ok ? toast.success : toast.error)(data.message);
      else toast.success(what === "delete" ? "Removed." : what === "enable" ? "Switched on." : "Switched off.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Header
        title="Integrations"
        subtitle="Connect CRMs, spreadsheets and automation tools, and keep their contacts in step with this app"
      />

      {error && (
        <div className="bg-white border border-[#eaeaea] rounded-xl p-8 text-center mb-6">
          <AlertCircle className="w-6 h-6 text-[#f31260] mx-auto mb-3" />
          <p className="text-sm text-[#0a0a0a] mb-1">Couldn&apos;t load integrations</p>
          <p className="text-xs text-[#999]">{error}</p>
        </div>
      )}

      {/* ── Connected ── */}
      <section className="mb-8">
        <h2 className="text-[11px] font-semibold text-[#999] uppercase tracking-widest mb-3">Connected</h2>
        {list === null && !error ? (
          <div className="bg-white border border-[#eaeaea] rounded-xl p-8 text-center">
            <RefreshCw className="w-5 h-5 animate-spin text-[#999] mx-auto" />
          </div>
        ) : list && list.length === 0 ? (
          <div className="bg-white border border-[#eaeaea] rounded-xl p-8 text-center">
            <Plug className="w-6 h-6 text-[#bbb] mx-auto mb-2" />
            <p className="text-sm text-[#666]">Nothing connected yet. Pick something below.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(list ?? []).map((item) => (
              <Connected
                key={item.id}
                item={item}
                busy={busy === item.id}
                onAct={(what) => act(item, what)}
                onEdit={() => {
                  const p = providerById(item.provider);
                  if (p) setEditing({ provider: p, existing: item });
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Catalog ── */}
      {CATEGORIES.map((cat) => {
        const providers = PROVIDERS.filter((p) => p.category === cat);
        if (!providers.length) return null;
        return (
          <section key={cat} className="mb-7">
            <h2 className="text-[11px] font-semibold text-[#999] uppercase tracking-widest mb-3">{cat}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {providers.map((p) => (
                <div key={p.id} className="bg-white border border-[#eaeaea] rounded-xl p-4 flex flex-col">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-[#0a0a0a]">{p.label}</p>
                    {!p.available && (
                      <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-[#f5f5f5] text-[#666]">Coming</span>
                    )}
                  </div>
                  <p className="text-xs text-[#666] leading-relaxed flex-1">{p.blurb}</p>
                  {p.available && (
                    <button
                      onClick={() => setEditing({ provider: p, existing: null })}
                      className="mt-3 self-start flex items-center gap-1.5 bg-[#0070f3] text-white text-xs font-medium rounded-lg px-3 h-8 hover:bg-[#0060df] transition-colors"
                    >
                      <Link2 className="w-3.5 h-3.5" /> Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {editing && (
        <ConnectForm
          provider={editing.provider}
          existing={editing.existing}
          onClose={() => setEditing(null)}
          onSaved={(url) => {
            setEditing(null);
            if (url) setHookUrl(url);
            reload();
          }}
        />
      )}

      {hookUrl && <HookUrl url={hookUrl} onClose={() => setHookUrl(null)} />}
    </div>
  );
}

// ── One connected integration ────────────────────────────────────────────

function Connected({
  item, busy, onAct, onEdit,
}: {
  item: IntegrationView;
  busy: boolean;
  onAct: (what: string) => void;
  onEdit: () => void;
}) {
  const provider = providerById(item.provider);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<IntegrationEvent[] | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        const res = await fetch(`/api/integrations/${item.id}`);
        const data = await res.json();
        setEvents(res.ok ? data.events ?? [] : []);
      } catch {
        setEvents([]);
      }
    }
  }

  const status = !item.enabled
    ? { icon: Pause, text: "Switched off", cls: "text-[#666]" }
    : item.lastStatus === "error"
      ? { icon: AlertCircle, text: "Last sync failed", cls: "text-[#b91c1c]" }
      : item.lastStatus === "ok"
        ? { icon: CheckCircle2, text: "Working", cls: "text-[#15803d]" }
        : { icon: Clock, text: provider?.syncs ? "Not synced yet" : "Ready", cls: "text-[#666]" };
  const btn = "flex items-center gap-1.5 text-xs font-medium text-[#444] border border-[#eaeaea] bg-white rounded-lg px-2.5 h-8 hover:bg-[#fafafa] transition-colors disabled:opacity-40";
  const minutes = Number(item.config.syncMinutes ?? 0);

  return (
    <div className="bg-white border border-[#eaeaea] rounded-xl p-4">
      <div className="flex flex-wrap items-start gap-3">
        <button onClick={toggle} className="mt-0.5 text-[#999] hover:text-[#0a0a0a]" data-tip="Activity">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#0a0a0a]">{item.name}</p>
            <span className="text-[10px] text-[#999]">{provider?.label}</span>
          </div>
          <p className={`text-xs mt-0.5 flex items-center gap-1 ${status.cls}`}>
            <status.icon className="w-3.5 h-3.5" /> {status.text}
            {item.lastStatus === "error" && item.lastError ? <span className="text-[#999]"> · {item.lastError}</span> : null}
          </p>
          <p className="text-[11px] text-[#999] mt-0.5">
            {provider?.syncs || item.provider === "webhook_in" ? `${item.contactCount} contact${item.contactCount === 1 ? "" : "s"}` : ""}
            {provider?.syncs ? ` · ${minutes > 0 ? `syncs every ${minutes} min` : "syncs by hand only"}` : ""}
            {item.lastSyncAt ? ` · last ${showTime(item.lastSyncAt)}` : ""}
            {item.provider === "webhook_out" ? `→ ${String(item.config.url ?? "")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => onAct("test")} disabled={busy} className={btn}><CheckCircle2 className="w-3.5 h-3.5" /> Test</button>
          {provider?.syncs && (
            <button onClick={() => onAct("sync")} disabled={busy || !item.enabled} className={btn}>
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Sync now
            </button>
          )}
          {item.provider === "webhook_out" && (
            <button onClick={() => onAct("send_test")} disabled={busy || !item.enabled} className={btn}><Send className="w-3.5 h-3.5" /> Send test event</button>
          )}
          {item.provider === "webhook_in" && (
            <button onClick={() => onAct("new_hook_url")} disabled={busy} className={btn}><KeyRound className="w-3.5 h-3.5" /> New URL</button>
          )}
          {provider && provider.fields.length > 0 && (
            <button onClick={onEdit} disabled={busy} className={btn}><Pencil className="w-3.5 h-3.5" /> Edit</button>
          )}
          <button onClick={() => onAct(item.enabled ? "disable" : "enable")} disabled={busy} className={btn}>
            {item.enabled ? <><Pause className="w-3.5 h-3.5" /> Switch off</> : <><Play className="w-3.5 h-3.5" /> Switch on</>}
          </button>
          <button onClick={() => onAct("delete")} disabled={busy} className={btn} data-tip="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {open && (
        <div className="ml-7 mt-3 border-t border-[#eaeaea] pt-3">
          {events === null ? (
            <RefreshCw className="w-4 h-4 animate-spin text-[#999]" />
          ) : events.length === 0 ? (
            <p className="text-[11px] text-[#999]">No activity yet.</p>
          ) : (
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="text-[11px]">
                  <span className={e.ok ? "text-[#15803d]" : "text-[#b91c1c]"}>{e.ok ? "✓" : "✕"}</span>
                  <span className="text-[#999]"> {showTime(e.at)} · {e.kind.replace("_", " ")} · </span>
                  <span className="text-[#444]">{e.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Connect / edit form ──────────────────────────────────────────────────

function ConnectForm({
  provider, existing, onClose, onSaved,
}: {
  provider: Provider;
  existing: IntegrationView | null;
  onClose: () => void;
  onSaved: (hookUrl: string | null) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? provider.label);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of provider.fields) {
      v[f.key] = f.secret ? "" : String(existing?.config[f.key] ?? (f.key === "syncMinutes" ? "60" : ""));
    }
    return v;
  });
  const [events, setEvents] = useState<string[]>(
    () => (existing?.config.events as string[] | undefined) ?? OUTGOING_EVENTS.map((e) => e.key),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(existing ? `/api/integrations/${existing.id}` : "/api/integrations", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(existing ? { do: "update" } : { provider: provider.id }),
          name,
          values: { ...values, ...(provider.id === "webhook_out" ? { events } : {}) },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that");
      toast.success(existing ? "Saved." : `${provider.label} connected.`);
      onSaved(data.hookUrl ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full text-sm bg-[#fafafa] border border-[#eaeaea] rounded-lg px-3 py-2 outline-none focus:border-[#0070f3] focus:bg-white transition-colors";

  return (
    <Overlay onDismiss={onClose} dismissable={!saving} className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3 md:p-6">
      <div className="bg-white border border-[#eaeaea] rounded-2xl shadow-xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[#eaeaea] shrink-0">
          <p className="text-sm font-semibold text-[#0a0a0a]">{existing ? `Edit ${existing.name}` : `Connect ${provider.label}`}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666] hover:bg-[#fafafa]"><X className="w-4 h-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {provider.howTo && (
            <ol className="text-xs text-[#444] bg-[#eff6ff] rounded-lg px-4 py-3 space-y-1 list-decimal list-inside">
              {provider.howTo.map((s) => <li key={s}>{s}</li>)}
            </ol>
          )}
          {provider.id === "webhook_in" && (
            <p className="text-xs text-[#444] bg-[#eff6ff] rounded-lg px-4 py-3">
              You&apos;ll get a private URL once this is saved. Anything that POSTs contacts to it as JSON (one, a list,
              or {"{ \"contacts\": [...] }"}) has them added here. Fields named like name, phone, email and company are
              recognised automatically.
            </p>
          )}

          <div>
            <label className="block text-[11px] font-medium text-[#666] mb-1.5">Name</label>
            <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>

          {provider.fields.map((f) => (
            <div key={f.key}>
              <label className="block text-[11px] font-medium text-[#666] mb-1.5">
                {f.label}
                {f.optional && <span className="text-[#bbb] font-normal"> optional</span>}
                {f.secret && existing?.hasSecret && <span className="text-[#15803d] font-normal"> · saved; leave blank to keep</span>}
              </label>
              {f.multiline ? (
                <textarea
                  className={`${field} font-mono text-xs resize-none`}
                  rows={5}
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  className={field}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
              {f.help && <p className="text-[10px] text-[#999] mt-1">{f.help}</p>}
            </div>
          ))}

          {provider.id === "webhook_out" && (
            <div>
              <label className="block text-[11px] font-medium text-[#666] mb-1.5">Send these events</label>
              <div className="space-y-1.5">
                {OUTGOING_EVENTS.map((e) => (
                  <label key={e.key} className="flex items-center gap-2 text-xs text-[#0a0a0a] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={events.includes(e.key)}
                      onChange={(ev) => setEvents((list) => ev.target.checked ? [...list, e.key] : list.filter((x) => x !== e.key))}
                    />
                    {e.label} <span className="text-[10px] text-[#bbb] font-mono">{e.key}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-[#999]">
            Credentials are encrypted on the server and never shown again. This app only reads from {provider.label}; it doesn&apos;t change anything there.
          </p>
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-[#eaeaea] shrink-0">
          <button onClick={onClose} className="text-sm font-medium text-[#666] px-4 h-9 rounded-lg hover:bg-[#fafafa]">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 bg-[#0070f3] text-white text-sm font-medium px-4 h-9 rounded-lg hover:bg-[#0060df] disabled:opacity-40"
          >
            {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
            {existing ? "Save" : "Connect"}
          </button>
        </footer>
      </div>
    </Overlay>
  );
}

// ── The incoming webhook's URL, shown once ───────────────────────────────

function HookUrl({ url, onClose }: { url: string; onClose: () => void }) {
  const toast = useToast();
  const example = `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Jane Example","phone":"555-555-0100","email":"jane@example.com"}'`;
  return (
    <Overlay onDismiss={onClose} className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3 md:p-6">
      <div className="bg-white border border-[#eaeaea] rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#0a0a0a]">Your webhook URL</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666] hover:bg-[#fafafa]"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-[#b91c1c] bg-[#fef2f2] rounded-lg px-3 py-2">
          Copy it now. It&apos;s only shown this once; if it&apos;s lost, make a new one. Anyone with it can add contacts, so keep it private.
        </p>
        <div className="flex gap-2">
          <input readOnly value={url} className="flex-1 text-xs font-mono bg-[#fafafa] border border-[#eaeaea] rounded-lg px-3 py-2" onFocus={(e) => e.target.select()} />
          <button
            onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Copied."))}
            className="flex items-center gap-1.5 bg-[#0070f3] text-white text-xs font-medium rounded-lg px-3 hover:bg-[#0060df]"
          >
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
        </div>
        <div>
          <p className="text-[11px] font-medium text-[#666] mb-1.5">Try it</p>
          <pre className="text-[10px] font-mono bg-[#fafafa] border border-[#eaeaea] rounded-lg p-3 overflow-x-auto whitespace-pre">{example}</pre>
        </div>
      </div>
    </Overlay>
  );
}
