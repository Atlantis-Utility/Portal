"use client";

import { useCallback, useEffect, useState } from "react";
import { saveContact } from "@/lib/contact-save";
import { usePolling } from "@/lib/use-polling";
import { useConfirm } from "@/lib/confirm";
import Overlay from "@/components/ui/Overlay";
import Header from "@/components/layout/Header";
import StatCard from "@/components/ui/StatCard";
import CallLink from "@/components/phone/CallLink";
import ContactDrawer from "@/components/contacts/ContactDrawer";
import { colourFor, initialsFor } from "@/components/messages/Avatar";
import ExportMenu from "@/components/ui/ExportMenu";
import { BookUser, Mail, Smartphone, Phone, RefreshCw, AlertCircle, Plus, X, Trash2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

import { formatPhone } from "@/lib/utils";
interface Contact {
  domain: string;
  user: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  company?: string;
  work_phone?: string;
  cell_phone?: string;
  home_phone?: string;
  email?: string;
  tags?: string;
  contact_id?: string;
  ts?: string;
}

type ViewState = "idle" | "loading" | "unconfigured" | "error" | "ok";

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  company: "",
  work_phone: "",
  cell_phone: "",
  email: "",
};

/**
 * A contact that's plainly a test: "test" in the name, or only fictional
 * numbers (555-01xx and 555-1212, the ones reserved for films and examples).
 */
function isTestEntry(c: { first_name?: string; last_name?: string; company?: string; cell_phone?: string; work_phone?: string; home_phone?: string }): boolean {
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""} ${c.company ?? ""}`;
  if (/\btest/i.test(name)) return true;
  const nums = [c.cell_phone, c.work_phone, c.home_phone].map((n) => (n ?? "").replace(/\D/g, "").slice(-10)).filter((n) => n.length === 10);
  return nums.length > 0 && nums.every((n) => /^\d{3}555(01\d\d|1212)$/.test(n));
}

export default function ContactsPage() {
  const [state, setState] = useState<ViewState>("loading");
  const confirm = useConfirm();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showTests, setShowTests] = useState(false);
  // The contact open in the side panel, by id, so it re-reads after a save.
  const [openId, setOpenId] = useState<string | null>(null);
  const isAdmin = Boolean(useAuth().authUser?.isAdmin);

  // The domain is always ours: the route fills it in, as Messages does.
  // The ERP picked from every reseller customer's domain, through a
  // /api/ringlogix/customers route that did not come across.
  const [user, setUser] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Which extension's book a new contact goes into, when none is filtered.
  const [saveTo, setSaveTo] = useState("");

  // "initial": the page opens already loading; "silent": a background
  // refresh that keeps the list if it fails; "manual": the Load button.
  const load = useCallback(async (mode: "initial" | "silent" | "manual" = "manual") => {
    const silent = mode === "silent";
    if (mode === "manual") setState("loading");
    try {
      // An empty extension means every book.
      const res = await fetch(`/api/ringlogix/contacts?user=${encodeURIComponent(user.trim() || "all")}`);
      if (res.status === 503) { setState("unconfigured"); return; }
      const data = await res.json();
      if (data?.error === "not_configured") { setState("unconfigured"); return; }
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      const arr: Contact[] = Array.isArray(data) ? data : (data?.data ?? []);
      setContacts(arr);
      setState("ok");
    } catch (e) {
      // A background refresh that fails keeps the list on screen.
      if (silent) return;
      setError(e instanceof Error ? e.message : "Failed to load");
      setState("error");
    }
  }, [user]);

  // Live while a book is showing: saved or deleted contacts (here, in
  // Messages, or in RingLogix itself) appear without pressing Load again.
  // Every book is ~55 PBX reads, so 30s rather than as often as Messages.
  usePolling(() => load("silent"), 30_000, state === "ok");
  // "initial" sets state only after the fetch answers; the rule can't see
  // past the useCallback to tell.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load("initial"); }, [load]);

  const deleteContact = async (c: Contact) => {
    const ok = await confirm({
      title: `Delete ${c.first_name} ${c.last_name}?`,
      description: "This removes the contact from RingLogix as well.",
    });
    if (!ok) return;
    try {
      const res = await fetch("/api/ringlogix/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: c.domain,
          user: c.user,
          first_name: c.first_name,
          last_name: c.last_name,
          contact_id: c.contact_id,
        }),
      });
      if (res.ok) setContacts((prev) => prev.filter((x) => x.contact_id !== c.contact_id));
    } catch {}
  };

  const addContact = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setSaveError("First and last name are required.");
      return;
    }
    const target = (user.trim() || saveTo.trim());
    if (!target) {
      setSaveError("Pick which extension's contact book it goes in.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const saved = await saveContact({ ...form, user: target }, confirm);
      if (!saved.ok) {
        if (saved.canceled) return;
        throw new Error(saved.error ?? "Failed to add contact");
      }
      setShowModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to add contact");
    } finally {
      setSaving(false);
    }
  };

  // Entries that are plainly tests ("TesT NUMBER", 555-1212) are hidden
  // unless asked for: the books are shared with the phones, so they aren't
  // deleted from here, just kept out of the way.
  const real = contacts.filter((c) => showTests || !isTestEntry(c));
  const hiddenTests = contacts.filter((c) => isTestEntry(c)).length;
  const withEmail = real.filter((c) => Boolean(c.email)).length;
  const withMobile = real.filter((c) => Boolean(c.cell_phone)).length;
  const withWork = real.filter((c) => Boolean(c.work_phone)).length;

  const exportData = () => ({
    filename: "contacts",
    title: "Contacts",
    headers: ["Name", "Company", "Customer Account", "Work Phone", "Cell Phone", "Home Phone", "Email", "Tags"],
    rows: filtered.map((c) => [
      [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(" "),
      c.company ?? "", c.domain ?? "", c.work_phone ?? "", c.cell_phone ?? "",
      c.home_phone ?? "", c.email ?? "", c.tags ?? "",
    ]),
  });

  const filtered = real.filter((c) => {
    const term = search.toLowerCase().trim();
    if (!term) return true;
    const digits = term.replace(/\D/g, "");
    return (
      c.first_name?.toLowerCase().includes(term) ||
      c.last_name?.toLowerCase().includes(term) ||
      c.email?.toLowerCase().includes(term) ||
      c.company?.toLowerCase().includes(term) ||
      (digits.length >= 3 && [c.cell_phone, c.work_phone, c.home_phone].some((n) => (n ?? "").replace(/\D/g, "").includes(digits)))
    );
  });

  return (
    <div>
      <Header
        title="Contacts"
        subtitle={state === "ok" ? `${real.length} contact${real.length !== 1 ? "s" : ""} across every contact book` : "Every RingLogix contact book in one place"}
        actions={
          <>
            <ExportMenu data={exportData} disabled={state !== "ok" || filtered.length === 0} />
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-[#0070f3] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#005fcc] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Contact
            </button>
          </>
        }
      />

      {/* Extension selector */}
      <div className="bg-white border border-[#eaeaea] rounded-xl p-4 mb-5 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">Extension</label>
          <input
            type="text"
            placeholder="All extensions"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors w-36"
          />
        </div>
        <button
          onClick={() => load()}
          disabled={state === "loading"}
          className="flex items-center gap-2 border border-[#eaeaea] bg-white text-sm font-medium text-[#0a0a0a] px-4 py-1.5 rounded-lg hover:bg-[#fafafa] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${state === "loading" ? "animate-spin" : ""}`} />
          Load
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Contacts" hint="Across every book" value={real.length} loading={state !== "ok"} icon={BookUser} tone="bg-tint-blue text-ink-blue" />
        <StatCard label="With email" hint="Address on file" value={withEmail} loading={state !== "ok"} icon={Mail} tone="bg-tint-green text-ink-green" />
        <StatCard label="With mobile" hint="Cell number on file" value={withMobile} loading={state !== "ok"} icon={Smartphone} tone="bg-tint-violet text-ink-violet" />
        <StatCard label="With work phone" hint="Work number on file" value={withWork} loading={state !== "ok"} icon={Phone} tone="bg-tint-amber text-ink-amber" />
      </div>

      {/* Table */}
      <div className="bg-white border border-[#eaeaea] rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-[#eaeaea]">
          <p className="text-sm font-semibold text-[#0a0a0a]">All Contacts</p>
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 w-full sm:w-64 outline-none focus:border-[#0070f3] transition-colors"
          />
        </div>

        {state === "idle" && (
          <div className="p-12 text-center">
            <BookUser className="w-6 h-6 text-[#999] mx-auto mb-3" />
            <p className="text-sm text-[#666]">Enter an extension, then click Load.</p>
          </div>
        )}

        {state === "loading" && (
          <div className="p-12 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-[#999] mx-auto mb-3" />
            <p className="text-sm text-[#666]">Loading contacts…</p>
          </div>
        )}

        {state === "unconfigured" && (
          <div className="p-12 text-center">
            <AlertCircle className="w-6 h-6 text-[#f5a524] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#0a0a0a] mb-1">API not configured</p>
            <p className="text-xs text-[#999]">Add your key to <code className="bg-[#f1f1f1] px-1 rounded">.env.local</code> as <code className="bg-[#f1f1f1] px-1 rounded">RINGLOGIX_API_ID & RINGLOGIX_API_SECRET</code>, then restart the server.</p>
          </div>
        )}

        {state === "error" && (
          <div className="p-12 text-center">
            <AlertCircle className="w-6 h-6 text-[#f31260] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#0a0a0a] mb-1">Failed to load</p>
            <p className="text-xs text-[#999] mb-4">{error}</p>
            <button onClick={() => load()} className="text-xs text-[#0070f3] hover:underline">Retry</button>
          </div>
        )}

        {state === "ok" && filtered.length === 0 && (
          <div className="p-12 text-center">
            <BookUser className="w-6 h-6 text-[#999] mx-auto mb-3" />
            <p className="text-sm text-[#999]">No contacts found{search ? " for that search" : ""}.</p>
          </div>
        )}

        {state === "ok" && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <div className="min-w-[44rem]">
              {/* One line per contact. */}
              <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_6.5rem] gap-4 px-5 py-2.5 border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                <span>Name</span><span>Company</span><span>Phone</span><span>Email</span><span />
              </div>
              <ul className="divide-y divide-line">
                {filtered.map((c, i) => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "Unnamed";
                  const phones = ([["Mobile", c.cell_phone], ["Work", c.work_phone], ["Home", c.home_phone]] as Array<[string, string | undefined]>).filter(([, n]) => n);
                  const [primaryLabel, primary] = phones[0] ?? ["", ""];
                  const book = !c.user || c.user === "*" ? "Shared" : `Ext ${c.user}`;
                  return (
                    <li key={(c.contact_id ?? "") + i} onClick={() => c.contact_id && setOpenId(c.contact_id)} className="cursor-pointer group grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.6fr)_6.5rem] gap-4 items-center px-5 py-2.5 hover:bg-surface-3 transition-colors">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${colourFor(name)}`}>{initialsFor(name)}</span>
                        <span className="text-sm font-medium text-fg truncate">{name}</span>
                        <span className="shrink-0 text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted">{book}</span>
                      </span>
                      <span className="text-sm text-fg-muted truncate">{c.company || "—"}</span>
                      <span className="flex items-center gap-1.5 min-w-0 text-sm" onClick={(e) => e.stopPropagation()}>
                        {primary ? (
                          <>
                            <span className="text-[10.5px] text-fg-subtle shrink-0">{primaryLabel}</span>
                            <CallLink number={primary} name={name} className="text-fg tabular-nums truncate hover:text-[#0070f3] hover:underline" >{formatPhone(primary) || primary}</CallLink>
                            {phones.length > 1 && (
                              <span className="shrink-0 text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted" title={phones.slice(1).map(([l, n]) => `${l}: ${formatPhone(n) || n}`).join(", ")}>
                                +{phones.length - 1}
                              </span>
                            )}
                          </>
                        ) : <span className="text-fg-subtle">{"—"}</span>}
                      </span>
                      <span className="text-sm text-fg-muted truncate">{c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="hover:text-fg hover:underline">{c.email}</a> : "—"}</span>
                      <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                        {primary && (
                          <Link
                            href={`/messages?to=${encodeURIComponent(primary.replace(/\D/g, ""))}`}
                            data-tip={`Text ${name}`}
                            aria-label={`Text ${name}`}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-subtle hover:bg-tint-blue hover:text-ink-blue transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </Link>
                        )}
                        {primary && (
                          <CallLink number={primary} name={name} tip={`Call ${name}`} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-subtle hover:bg-tint-green hover:text-ink-green transition-colors">
                            <Phone className="w-3.5 h-3.5" />
                          </CallLink>
                        )}
                        {/* Only administrators remove contacts: the books are shared with every phone. */}
                        {isAdmin && <button
                          onClick={() => deleteContact(c)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-[#f31260] hover:bg-[#fff0f3] transition-all"
                          data-tip="Delete contact"
                          aria-label={`Delete ${name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
        {state === "ok" && hiddenTests > 0 && (
          <div className="px-5 py-2.5 border-t border-line text-xs text-fg-subtle flex items-center justify-between">
            <span>{showTests ? `Showing ${hiddenTests} test entr${hiddenTests === 1 ? "y" : "ies"}.` : `${hiddenTests} test entr${hiddenTests === 1 ? "y is" : "ies are"} hidden.`}</span>
            <button onClick={() => setShowTests((v) => !v)} className="font-medium text-fg-muted hover:text-fg">{showTests ? "Hide them" : "Show them"}</button>
          </div>
        )}
      </div>

      <ContactDrawer
        contact={contacts.find((c) => c.contact_id && c.contact_id === openId) ?? null}
        onClose={() => setOpenId(null)}
        onSaved={() => load()}
        onDelete={async (c) => { await deleteContact(c as Contact); setOpenId(null); }}
        canDelete={isAdmin}
      />

      {/* Add Contact Modal */}
      {showModal && (
        <Overlay onDismiss={() => setShowModal(false)} className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#eaeaea] rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#eaeaea]">
              <p className="text-sm font-semibold text-[#0a0a0a]">Add Contact</p>
              <button onClick={() => { setShowModal(false); setSaveError(""); }} className="p-1 rounded-lg hover:bg-[#f5f5f5] transition-colors text-[#999]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {!user.trim() && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">Save to extension *</label>
                  <input
                    type="text"
                    placeholder="e.g. 100"
                    value={saveTo}
                    onChange={(e) => setSaveTo(e.target.value)}
                    className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors w-full"
                  />
                  <p className="text-[10px] text-[#999]">Whose contact book it goes in. Every extension&apos;s book shows here and names numbers in Messages.</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">First Name *</label>
                  <input type="text" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">Last Name *</label>
                  <input type="text" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">Company</label>
                <input type="text" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors w-full" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">Work Phone</label>
                <input type="text" value={form.work_phone} onChange={(e) => setForm((f) => ({ ...f, work_phone: e.target.value }))} className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors w-full" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">Cell Phone</label>
                <input type="text" value={form.cell_phone} onChange={(e) => setForm((f) => ({ ...f, cell_phone: e.target.value }))} className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors w-full" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="text-sm border border-[#eaeaea] rounded-lg px-3 py-1.5 outline-none focus:border-[#0070f3] transition-colors w-full" />
              </div>
              {saveError && <p className="text-xs text-[#f31260]">{saveError}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#eaeaea]">
              <button onClick={() => { setShowModal(false); setSaveError(""); }} className="text-sm border border-[#eaeaea] bg-white text-[#0a0a0a] font-medium px-4 py-1.5 rounded-lg hover:bg-[#fafafa] transition-colors">Cancel</button>
              <button onClick={addContact} disabled={saving} className="text-sm bg-[#0070f3] text-white font-medium px-4 py-1.5 rounded-lg hover:bg-[#005fcc] transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Add Contact
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
