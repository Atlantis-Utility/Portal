"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Phone, MessageSquare, Mail, Pencil, Trash2, Building2, StickyNote, Check, RefreshCw } from "lucide-react";
import Drawer from "@/components/ui/Drawer";
import CallLink from "@/components/phone/CallLink";
import { colourFor, initialsFor } from "@/components/messages/Avatar";
import { formatPhone } from "@/lib/utils";
import { useToast } from "@/lib/toast";

/**
 * One contact: everything RingLogix keeps on them, with Call and Text on
 * each number, an Edit mode (name, company, numbers, email - saved to
 * RingLogix by the contact's id), and notes, which RingLogix has no field
 * for and the portal keeps (contact_notes).
 */

export interface ContactRow {
  contact_id?: string;
  user?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  email?: string;
  cell_phone?: string;
  work_phone?: string;
  home_phone?: string;
}

const FIELDS = [
  ["first_name", "First name"], ["last_name", "Last name"], ["company", "Company"], ["email", "Email"],
  ["cell_phone", "Mobile"], ["work_phone", "Work phone"], ["home_phone", "Home phone"],
] as const;
type FieldKey = (typeof FIELDS)[number][0];

const input = "w-full text-sm bg-surface border border-line rounded-lg px-3 h-9 text-fg placeholder:text-fg-subtle outline-none focus:border-fg transition-colors";

export default function ContactDrawer({
  contact, onClose, onSaved, onDelete, canDelete,
}: {
  contact: ContactRow | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (c: ContactRow) => void;
  canDelete: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<FieldKey, string>>(() => blank(contact));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [notesMeta, setNotesMeta] = useState<{ by: string; at: string | null; setup?: string }>({ by: "", at: null });
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved">("idle");
  const loadedNotes = useRef("");

  const key = contact?.contact_id ? `${!contact.user || contact.user === "*" ? "*" : contact.user}:${contact.contact_id}` : "";

  // A different contact opened: reset, done during render against the last one shown.
  const [shown, setShown] = useState<string | null>(null);
  if ((contact?.contact_id ?? null) !== shown) {
    setShown(contact?.contact_id ?? null);
    setEditing(false);
    setError("");
    setForm(blank(contact));
    setNotes("");
    setNotesState("idle");
  }

  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`/api/contacts/notes?key=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((b) => {
        if (!live) return;
        loadedNotes.current = b.notes ?? "";
        setNotes(b.notes ?? "");
        setNotesMeta({ by: b.updatedBy ?? "", at: b.updatedAt ?? null, setup: b.setup });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [key]);

  // Notes save themselves a moment after you stop typing.
  useEffect(() => {
    if (!key || notes === loadedNotes.current) return;
    const t = setTimeout(async () => {
      setNotesState("saving");
      const res = await fetch("/api/contacts/notes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, notes }) });
      const b = await res.json().catch(() => ({}));
      if (res.ok) { loadedNotes.current = notes; setNotesState("saved"); setTimeout(() => setNotesState("idle"), 1500); }
      else { setNotesState("idle"); toast.error(b.error ?? "Couldn't save the notes"); }
    }, 900);
    return () => clearTimeout(t);
  }, [notes, key, toast]);

  if (!contact) return null;
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.company || "Unnamed";
  const book = !contact.user || contact.user === "*" ? "Shared contact book" : `Extension ${contact.user}'s book`;
  const phones = ([["Mobile", contact.cell_phone], ["Work", contact.work_phone], ["Home", contact.home_phone]] as Array<[string, string | undefined]>).filter(([, n]) => n);

  async function save() {
    if (!contact?.contact_id) return;
    if (!form.first_name.trim() && !form.last_name.trim() && !form.company.trim()) { setError("Give them a name or a company."); return; }
    setSaving(true);
    setError("");
    try {
      // Only what changed goes to RingLogix.
      const patch: Record<string, string> = {};
      for (const [k] of FIELDS) if ((form[k] ?? "") !== ((contact as Record<string, string | undefined>)[k] ?? "")) patch[k] = form[k];
      if (Object.keys(patch).length === 0) { setEditing(false); return; }
      if (patch.first_name === undefined && patch.last_name !== undefined) patch.first_name = form.first_name;
      if (patch.last_name === undefined && patch.first_name !== undefined) patch.last_name = form.last_name;
      const res = await fetch("/api/ringlogix/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: contact.user ?? "", contact_id: contact.contact_id, ...patch }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? b.message ?? "Couldn't save the contact");
      toast.success("Contact saved.");
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={editing ? "Edit contact" : name}
      subtitle={editing ? name : book}
      footer={editing ? (
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => { setEditing(false); setForm(blank(contact)); setError(""); }} className="text-sm font-medium text-fg-muted px-3 h-9 rounded-lg hover:bg-surface-3">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-fg text-surface text-sm font-medium px-4 h-9 rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving && <RefreshCw className="w-4 h-4 animate-spin" />} Save changes
          </button>
        </div>
      ) : undefined}
    >
      {editing ? (
        <div className="space-y-4">
          {error && <p className="text-xs rounded-lg px-3 py-2 bg-tint-rose text-ink-rose">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map(([k, label]) => (
              <label key={k} className={k === "company" || k === "email" ? "col-span-2" : ""}>
                <span className="block text-[12px] font-medium text-fg-muted mb-1.5">{label}</span>
                <input
                  className={input}
                  value={form[k]}
                  type={k === "email" ? "email" : k.endsWith("phone") ? "tel" : "text"}
                  inputMode={k.endsWith("phone") ? "tel" : undefined}
                  placeholder={k === "email" ? "name@company.com" : k.endsWith("phone") ? "(805) 555-0100" : ""}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-fg-subtle">Saved to the {book.toLowerCase()} in RingLogix, so desk phones and the mobile app see it too.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Who */}
          <div className="flex items-center gap-4">
            <span className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-semibold shrink-0 ${colourFor(name)}`}>{initialsFor(name)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-fg truncate">{name}</p>
              {contact.company && <p className="text-sm text-fg-muted flex items-center gap-1.5 truncate"><Building2 className="w-3.5 h-3.5 shrink-0" /> {contact.company}</p>}
            </div>
            <button onClick={() => setEditing(true)} className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium border border-line rounded-lg px-3 h-9 text-fg hover:bg-surface-3">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          </div>

          {/* Numbers */}
          <div className="rounded-xl border border-line divide-y divide-line">
            {phones.length === 0 && <p className="px-4 py-3 text-sm text-fg-subtle">No phone numbers. <button onClick={() => setEditing(true)} className="font-medium text-fg hover:underline">Add one</button></p>}
            {phones.map(([label, n]) => (
              <div key={label} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] text-fg-subtle">{label}</span>
                  <span className="block text-sm text-fg tabular-nums">{formatPhone(n) || n}</span>
                </span>
                <Link href={`/messages?to=${encodeURIComponent((n ?? "").replace(/\D/g, ""))}`} className="w-9 h-9 rounded-full bg-tint-blue text-ink-blue flex items-center justify-center hover:opacity-80" aria-label={`Text ${name}`} title="Text">
                  <MessageSquare className="w-4 h-4" />
                </Link>
                <CallLink number={n ?? ""} name={name} tip="Call" className="w-9 h-9 rounded-full bg-tint-green text-ink-green flex items-center justify-center hover:opacity-80">
                  <Phone className="w-4 h-4" />
                </CallLink>
              </div>
            ))}
          </div>

          {/* Email */}
          <div className="rounded-xl border border-line px-4 py-2.5 flex items-center gap-3">
            <Mail className="w-4 h-4 text-fg-subtle shrink-0" />
            {contact.email
              ? <a href={`mailto:${contact.email}`} className="text-sm text-fg hover:underline truncate">{contact.email}</a>
              : <button onClick={() => setEditing(true)} className="text-sm text-fg-subtle hover:text-fg">Add an email address</button>}
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5" /> Notes</p>
              <span className="text-[11px] text-fg-subtle">
                {notesState === "saving" ? "Saving…" : notesState === "saved" ? <span className="inline-flex items-center gap-1"><Check className="w-3 h-3 text-ink-green" /> Saved</span>
                  : notesMeta.by ? `Last edited by ${notesMeta.by}` : ""}
              </span>
            </div>
            {notesMeta.setup ? (
              <p className="text-xs rounded-lg px-3 py-2 bg-tint-amber text-ink-amber">{notesMeta.setup}</p>
            ) : (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                placeholder="Anything worth remembering: preferences, account details, what was agreed…"
                className="w-full text-sm bg-surface border border-line rounded-xl px-3 py-2.5 text-fg placeholder:text-fg-subtle outline-none focus:border-fg resize-y leading-relaxed"
              />
            )}
            <p className="text-[11px] text-fg-subtle mt-1">Everyone at Atlantis who can see this contact sees these notes. Saved as you type.</p>
          </div>

          {canDelete && (
            <button onClick={() => onDelete(contact)} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-rose hover:underline">
              <Trash2 className="w-3.5 h-3.5" /> Delete contact
            </button>
          )}
        </div>
      )}
    </Drawer>
  );
}

function blank(c: ContactRow | null): Record<FieldKey, string> {
  return {
    first_name: c?.first_name ?? "", last_name: c?.last_name ?? "", company: c?.company ?? "", email: c?.email ?? "",
    cell_phone: c?.cell_phone ?? "", work_phone: c?.work_phone ?? "", home_phone: c?.home_phone ?? "",
  };
}
