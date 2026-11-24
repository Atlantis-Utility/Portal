"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/layout/Header";
import ExportMenu from "@/components/ui/ExportMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Overlay from "@/components/ui/Overlay";
import { useAuth } from "@/lib/auth-context";
import { useEmployees } from "@/lib/db/employees";
import { useNotes, addNote, updateNote, removeNote, type Note } from "@/lib/db/notes";
import { useCurrentEmployeeId } from "@/lib/hooks/use-current-employee-id";
import { useToast } from "@/lib/toast";
import { notifyAccessShared } from "@/lib/notify-access";
import { getAvatarColor, getInitials, getErrorMessage } from "@/lib/utils";
import {
  Plus, Search, Send, Trash2, Check, AlertCircle, X, Pin, PinOff, ListChecks, StickyNote as StickyNoteIcon, Palette,
} from "lucide-react";

/**
 * Notes as a notebook board.
 *
 * Quick capture at the top (type, Enter, it's on the board), notes as cards
 * on a masonry board with pinned ones first, a colour each, and checklists
 * that work right on the card: a line written "- [ ]" is a checkbox you can
 * tick without opening the note. A note opens in a focused editor that saves
 * as you type. Sharing with teammates (and the optional email) is as before.
 */

type ViewFilter = "mine" | "shared";
type SaveState = "idle" | "saving" | "saved";

/** Card colours: soft tints the dark theme also darkens. */
const NOTE_COLORS: Record<string, { card: string; dot: string; label: string }> = {
  default: { card: "bg-surface", dot: "bg-surface-3 border border-line-strong", label: "Plain" },
  amber: { card: "bg-tint-amber", dot: "bg-[#f5a524]", label: "Yellow" },
  green: { card: "bg-tint-green", dot: "bg-[#17c964]", label: "Green" },
  blue: { card: "bg-tint-blue", dot: "bg-[#0070f3]", label: "Blue" },
  violet: { card: "bg-tint-violet", dot: "bg-[#7c3aed]", label: "Purple" },
  pink: { card: "bg-tint-pink", dot: "bg-[#ec4899]", label: "Pink" },
  teal: { card: "bg-tint-teal", dot: "bg-[#14b8a6]", label: "Teal" },
};
const colorOf = (n: Note) => NOTE_COLORS[n.color ?? "default"] ?? NOTE_COLORS.default;

function newId() {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function ago(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const m = Math.round((now - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  if (m < 10080) return `${Math.round(m / 1440)}d ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

function Avatar({ name, ring = false }: { name: string; ring?: boolean }) {
  const c = getAvatarColor(name);
  return (
    <span data-tip={name} className={`w-6 h-6 rounded-full ${c.bg} ${c.text} flex items-center justify-center shrink-0 text-[9px] font-semibold ${ring ? "ring-2 ring-surface" : ""}`}>
      {getInitials(name)}
    </span>
  );
}

const CHECK = /^(\s*)[-*] \[( |x|X)\] ?(.*)$/;

/** The body, with "- [ ]" lines as real checkboxes. */
function NoteBody({ body, onToggle, clamp }: { body: string; onToggle?: (line: number) => void; clamp?: number }) {
  const lines = body.split("\n");
  const shown = clamp ? lines.slice(0, clamp) : lines;
  return (
    <div className="space-y-0.5">
      {shown.map((line, i) => {
        const m = CHECK.exec(line);
        if (m) {
          const done = m[2].toLowerCase() === "x";
          return (
            <label key={i} className={`flex items-start gap-2 text-[13px] leading-snug ${onToggle ? "cursor-pointer" : ""}`} onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={done}
                disabled={!onToggle}
                onChange={() => onToggle?.(i)}
                className="mt-0.5 w-3.5 h-3.5 rounded accent-[#0a0a0a] shrink-0"
              />
              <span className={done ? "line-through text-fg-subtle" : "text-fg"}>{m[3] || " "}</span>
            </label>
          );
        }
        return line.trim()
          ? <p key={i} className="text-[13px] leading-relaxed text-fg-muted whitespace-pre-wrap break-words">{line}</p>
          : <div key={i} className="h-2" />;
      })}
      {clamp && lines.length > clamp && <p className="text-[11px] text-fg-subtle pt-1">+{lines.length - clamp} more lines</p>}
    </div>
  );
}

function toggleLine(body: string, line: number): string {
  const lines = body.split("\n");
  const m = CHECK.exec(lines[line] ?? "");
  if (!m) return body;
  lines[line] = `${m[1]}- [${m[2].toLowerCase() === "x" ? " " : "x"}] ${m[3]}`;
  return lines.join("\n");
}

export default function NotesPage() {
  const { authUser } = useAuth();
  const employees = useEmployees();
  const notes = useNotes();
  const myId = useCurrentEmployeeId();
  const myName = authUser?.displayName || authUser?.email || "Me";
  const { success } = useToast();

  const [now] = useState(() => Date.now());
  const [notifyOnShare, setNotifyOnShare] = useState(true);
  const [filter, setFilter] = useState<ViewFilter>("mine");
  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  // ?note=<id> opens straight onto it (where the "shared with you" email points).
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("note"));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [shareOpen, setShareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Quick capture
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capTitle, setCapTitle] = useState("");
  const [capBody, setCapBody] = useState("");
  const [capColor, setCapColor] = useState("default");

  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const isMine = selected ? selected.authorId === myId : false;

  const myNotes = useMemo(() => notes.filter((n) => n.authorId === myId), [notes, myId]);
  const sharedWithMe = useMemo(() => notes.filter((n) => n.authorId !== myId && n.recipientIds.includes(myId)), [notes, myId]);
  const visible = useMemo(() => {
    const base = filter === "mine" ? myNotes : sharedWithMe;
    const q = search.trim().toLowerCase();
    const hits = q ? base.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) : base;
    return [...hits].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [filter, myNotes, sharedWithMe, search]);
  const pinned = visible.filter((n) => n.pinned);
  const others = visible.filter((n) => !n.pinned);

  const exportData = () => ({
    filename: "notes",
    title: "Notes",
    headers: ["Title", "Note", "Author", "Shared With", "Created", "Updated"],
    rows: visible.map((n) => [n.title, n.body, n.authorName, String(n.recipientIds.length), n.createdAt, n.updatedAt]),
  });

  // Refill the editor whenever a different note opens (done during render
  // against the one last shown, keyed on the note actually found so a
  // ?note=<id> opened before the list loads still fills in once it arrives).
  const shownId = selected?.id ?? null;
  const [editorFor, setEditorFor] = useState<string | null>(null);
  if (editorFor !== shownId) {
    setEditorFor(shownId);
    setDraftTitle(selected?.title ?? "");
    setDraftBody(selected?.body ?? "");
    setShareOpen(false);
    setPaletteOpen(false);
  }
  if (notes.length > 0 && selectedId && !selected) setSelectedId(null);

  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 1800);
    return () => clearTimeout(t);
  }, [saveState]);

  async function save(id: string, patch: Partial<Note>) {
    setSaveState("saving");
    try {
      await updateNote(id, { ...patch, updatedAt: new Date().toISOString() });
      setSaveState("saved");
    } catch (err) {
      setSaveState("idle");
      setError(getErrorMessage(err, "Failed to save note"));
    }
  }

  // Saves as you type: a pause of under a second writes the draft.
  const latest = useRef({ id: "", title: "", body: "", mine: false, origTitle: "", origBody: "" });
  useEffect(() => {
    latest.current = { id: selected?.id ?? "", title: draftTitle, body: draftBody, mine: isMine, origTitle: selected?.title ?? "", origBody: selected?.body ?? "" };
  });
  useEffect(() => {
    if (!selected || !isMine) return;
    if (draftTitle === selected.title && draftBody === selected.body) return;
    const t = setTimeout(() => { void save(selected.id, { title: draftTitle, body: draftBody }); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTitle, draftBody]);
  // And on the way out (closing the editor, leaving the page).
  useEffect(() => {
    return () => {
      const d = latest.current;
      if (d.id && d.mine && (d.title !== d.origTitle || d.body !== d.origBody)) {
        updateNote(d.id, { title: d.title, body: d.body, updatedAt: new Date().toISOString() }).catch(() => {});
      }
    };
  }, [selectedId]);

  const noAccount = () => {
    setError("Your account isn't linked to a user record, so notes can't be created. Ask an administrator to add you on the Users page.");
  };

  async function capture() {
    if (!myId) { noAccount(); return; }
    if (!capTitle.trim() && !capBody.trim()) { setCaptureOpen(false); return; }
    const at = new Date().toISOString();
    try {
      await addNote({ id: newId(), title: capTitle.trim(), body: capBody, authorId: myId, authorName: myName, recipientIds: [], createdAt: at, updatedAt: at, color: capColor === "default" ? undefined : capColor });
      setCapTitle(""); setCapBody(""); setCapColor("default"); setCaptureOpen(false); setFilter("mine");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create note"));
    }
  }

  async function createAndOpen() {
    if (!myId) { noAccount(); return; }
    const at = new Date().toISOString();
    const note: Note = { id: newId(), title: "", body: "", authorId: myId, authorName: myName, recipientIds: [], createdAt: at, updatedAt: at };
    try {
      await addNote(note);
      setFilter("mine");
      setSelectedId(note.id);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create note"));
    }
  }

  async function handleDelete() {
    if (!selected) return;
    setDeleting(true);
    try {
      await removeNote(selected.id);
      setSelectedId(null);
      setConfirmDelete(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to delete note"));
    } finally {
      setDeleting(false);
    }
  }

  async function toggleRecipient(employeeId: string) {
    if (!selected) return;
    const adding = !selected.recipientIds.includes(employeeId);
    const next = adding ? [...selected.recipientIds, employeeId] : selected.recipientIds.filter((id) => id !== employeeId);
    void save(selected.id, { recipientIds: next });
    // Only on the way in: being taken off a note isn't news to email anybody.
    if (adding && notifyOnShare) {
      const to = employees.find((e) => e.id === employeeId);
      const line = await notifyAccessShared({ toEmployeeId: employeeId, toName: to?.name, kind: "note", id: selected.id, name: selected.title || "a note" });
      if (line) success(line);
    }
  }

  const addChecklistItem = () => setDraftBody((b) => `${b}${b && !b.endsWith("\n") ? "\n" : ""}- [ ] `);
  const recipients = (n: Note) => employees.filter((e) => n.recipientIds.includes(e.id));
  const teammates = employees.filter((e) => e.id !== myId);

  function Card({ n }: { n: Note }) {
    const mine = n.authorId === myId;
    const shared = recipients(n);
    return (
      <article
        onClick={() => setSelectedId(n.id)}
        className={`group relative mb-4 break-inside-avoid rounded-2xl border border-line ${colorOf(n).card} p-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5`}
      >
        {mine && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void save(n.id, { pinned: !n.pinned }); }}
            className={`absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
              n.pinned ? "text-fg opacity-100" : "text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-surface-3"
            }`}
            aria-label={n.pinned ? "Unpin" : "Pin"}
            title={n.pinned ? "Unpin" : "Pin to the top"}
          >
            <Pin className="w-3.5 h-3.5" fill={n.pinned ? "currentColor" : "none"} />
          </button>
        )}
        {n.title && <h3 className="text-[15px] font-semibold text-fg pr-8 mb-1.5 break-words">{n.title}</h3>}
        {n.body ? (
          <NoteBody body={n.body} clamp={10} onToggle={mine ? (line) => void save(n.id, { body: toggleLine(n.body, line) }) : undefined} />
        ) : (
          !n.title && <p className="text-[13px] italic text-fg-subtle">Empty note</p>
        )}
        <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-line/60">
          <span className="text-[11px] text-fg-subtle">
            {mine ? ago(n.updatedAt, now) : `From ${n.authorName} · ${ago(n.updatedAt, now)}`}
          </span>
          {mine && shared.length > 0 && (
            <span className="flex items-center -space-x-1.5">
              {shared.slice(0, 3).map((e) => <Avatar key={e.id} name={e.name} ring />)}
              {shared.length > 3 && <span className="text-[10px] text-fg-subtle pl-2.5">+{shared.length - 3}</span>}
            </span>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="max-w-7xl">
      <Header
        title="Notes"
        subtitle="Jot things down, keep checklists, share with a teammate"
        actions={
          <>
            <ExportMenu data={exportData} disabled={visible.length === 0} />
            <button onClick={createAndOpen} className="flex items-center gap-2 bg-fg text-surface text-sm font-medium px-4 h-9 rounded-lg hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" /> New note
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-xl bg-tint-rose text-ink-rose">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <p className="text-[13px] flex-1">{error}</p>
          <button onClick={() => setError("")} className="hover:opacity-70 shrink-0" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ── Quick capture ── */}
      <div className={`max-w-2xl mx-auto mb-6 rounded-2xl border border-line ${NOTE_COLORS[capColor].card} shadow-sm transition-shadow ${captureOpen ? "shadow-md" : ""}`}>
        {captureOpen ? (
          <div className="p-4">
            <input
              autoFocus
              value={capTitle}
              onChange={(e) => setCapTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLTextAreaElement | null)?.focus(); }
                if (e.key === "Escape") void capture();
              }}
              placeholder="Title"
              className="w-full bg-transparent text-[15px] font-semibold text-fg placeholder:text-fg-subtle outline-none mb-2"
            />
            <textarea
              value={capBody}
              onChange={(e) => setCapBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void capture(); }
                if (e.key === "Escape") void capture();
              }}
              placeholder={"Take a note…  (start a line with - [ ] for a checklist)"}
              rows={3}
              className="w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none resize-none leading-relaxed"
            />
            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="flex items-center gap-1">
                {Object.entries(NOTE_COLORS).map(([key, c]) => (
                  <button key={key} type="button" onClick={() => setCapColor(key)} title={c.label} aria-label={c.label}
                    className={`w-5 h-5 rounded-full ${c.dot} ${capColor === key ? "ring-2 ring-offset-2 ring-fg ring-offset-surface" : ""}`} />
                ))}
                <button type="button" onClick={() => setCapBody((b) => `${b}${b && !b.endsWith("\n") ? "\n" : ""}- [ ] `)} className="ml-2 w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3" title="Add a checklist item" aria-label="Add a checklist item">
                  <ListChecks className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-[11px] text-fg-subtle">Ctrl+Enter to save</span>
                <button type="button" onClick={() => { setCapTitle(""); setCapBody(""); setCapColor("default"); setCaptureOpen(false); }} className="text-[13px] text-fg-muted px-2.5 h-8 rounded-lg hover:bg-surface-3">Cancel</button>
                <button type="button" onClick={() => void capture()} className="text-[13px] font-semibold px-3.5 h-8 rounded-lg bg-fg text-surface hover:opacity-90">Save</button>
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setCaptureOpen(true)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
            <StickyNoteIcon className="w-4 h-4 text-fg-subtle" />
            <span className="flex-1 text-sm text-fg-subtle">Take a note…</span>
            <ListChecks className="w-4 h-4 text-fg-subtle" />
          </button>
        )}
      </div>

      {/* ── Mine / shared, search ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center p-0.5 rounded-lg bg-surface-3">
          {([["mine", "My notes", myNotes.length], ["shared", "Shared with me", sharedWithMe.length]] as const).map(([key, label, n]) => (
            <button key={key} onClick={() => setFilter(key)} className={`flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-md transition-colors ${filter === key ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}>
              {label}<span className="text-[11px] tabular-nums text-fg-subtle">{n}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes" className="w-full text-sm bg-surface border border-line rounded-lg pl-8.5 pr-3 h-9 text-fg placeholder:text-fg-subtle outline-none focus:border-fg transition-colors" />
        </div>
      </div>

      {/* ── The board ── */}
      {visible.length === 0 ? (
        <div className="py-20 text-center">
          <span className="w-14 h-14 rounded-2xl bg-tint-pink text-ink-pink flex items-center justify-center mx-auto mb-4"><StickyNoteIcon className="w-6 h-6" /></span>
          <p className="text-sm font-semibold text-fg">{search ? "No notes match" : filter === "mine" ? "No notes yet" : "Nothing shared with you yet"}</p>
          <p className="text-xs text-fg-subtle mt-1">{search ? "Try another word." : filter === "mine" ? "Take a note above. Start a line with - [ ] for a checklist." : "Notes teammates share with you show up here."}</p>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-2.5 flex items-center gap-1.5"><Pin className="w-3 h-3" /> Pinned</p>
              <div className="columns-1 sm:columns-2 xl:columns-3 2xl:columns-4 gap-4 mb-4">
                {pinned.map((n) => <Card key={n.id} n={n} />)}
              </div>
              {others.length > 0 && <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-2.5">Others</p>}
            </>
          )}
          <div className="columns-1 sm:columns-2 xl:columns-3 2xl:columns-4 gap-4">
            {others.map((n) => <Card key={n.id} n={n} />)}
          </div>
        </>
      )}

      {/* ── The editor ── */}
      {selected && (
        <Overlay onDismiss={() => setSelectedId(null)} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-3 md:p-8">
          <div className={`w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-line shadow-2xl ${colorOf(selected).card} bg-surface`}>
            <div className={`flex items-center gap-2 px-5 h-14 border-b border-line shrink-0 rounded-t-2xl ${colorOf(selected).card}`}>
              <span className="text-xs text-fg-subtle min-w-0 truncate">
                {isMine ? `Edited ${ago(selected.updatedAt, now)}` : `From ${selected.authorName}`}
              </span>
              {isMine && saveState !== "idle" && (
                <span className="flex items-center gap-1 text-[11px] text-fg-subtle shrink-0">
                  {saveState === "saving" ? "Saving…" : <><Check className="w-3 h-3 text-ink-green" /> Saved</>}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1 shrink-0">
                {isMine && (
                  <>
                    <button type="button" onClick={() => void save(selected.id, { pinned: !selected.pinned })} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3 hover:text-fg" title={selected.pinned ? "Unpin" : "Pin"} aria-label={selected.pinned ? "Unpin" : "Pin"}>
                      {selected.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                    </button>
                    <div className="relative">
                      <button type="button" onClick={() => { setPaletteOpen((v) => !v); setShareOpen(false); }} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3 hover:text-fg" title="Colour" aria-label="Colour">
                        <Palette className="w-4 h-4" />
                      </button>
                      {paletteOpen && (
                        <div className="absolute right-0 top-full mt-2 z-20 flex gap-1.5 bg-surface border border-line rounded-xl shadow-lg p-2">
                          {Object.entries(NOTE_COLORS).map(([key, c]) => (
                            <button key={key} type="button" title={c.label} aria-label={c.label}
                              onClick={() => { void save(selected.id, { color: key === "default" ? undefined : key }); setPaletteOpen(false); }}
                              className={`w-6 h-6 rounded-full ${c.dot} ${(selected.color ?? "default") === key ? "ring-2 ring-offset-2 ring-fg ring-offset-surface" : ""}`} />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <button type="button" onClick={() => { setShareOpen((v) => !v); setPaletteOpen(false); }} className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] font-medium text-fg hover:bg-surface-3">
                        {recipients(selected).length > 0
                          ? <span className="flex -space-x-1.5 mr-0.5">{recipients(selected).slice(0, 3).map((e) => <Avatar key={e.id} name={e.name} ring />)}</span>
                          : <Send className="w-3.5 h-3.5" />}
                        Share
                      </button>
                      {shareOpen && (
                        <div className="absolute right-0 top-full mt-2 w-64 bg-surface border border-line rounded-xl shadow-lg z-20 p-1.5">
                          <p className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider px-2.5 py-2">Share with</p>
                          <div className="max-h-64 overflow-y-auto space-y-0.5">
                            {teammates.length === 0 ? (
                              <p className="text-xs text-fg-subtle px-2.5 py-3 text-center">No teammates yet</p>
                            ) : teammates.map((e) => (
                              <button key={e.id} type="button" onClick={() => void toggleRecipient(e.id)} className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-3 text-left">
                                <Avatar name={e.name} />
                                <span className="text-[13px] text-fg flex-1 truncate">{e.name}</span>
                                {selected.recipientIds.includes(e.id) && <Check className="w-3.5 h-3.5 text-ink-blue shrink-0" />}
                              </button>
                            ))}
                          </div>
                          {/* Off is a real choice: sharing with someone at the next desk doesn't need an email. */}
                          <label className="flex items-center gap-2 px-2.5 py-2 mt-1 border-t border-line cursor-pointer">
                            <input type="checkbox" checked={notifyOnShare} onChange={(e) => setNotifyOnShare(e.target.checked)} className="w-3.5 h-3.5 accent-[#0a0a0a]" />
                            <span className="text-[11px] text-fg-muted">Email them a link</span>
                          </label>
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => setConfirmDelete(true)} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-tint-rose hover:text-ink-rose" title="Delete" aria-label="Delete note">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button type="button" onClick={() => setSelectedId(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3 hover:text-fg" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
              {isMine ? (
                <>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full bg-transparent text-2xl font-semibold tracking-tight text-fg placeholder:text-fg-subtle outline-none mb-3"
                  />
                  <textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    placeholder={"Start writing…\n\n- [ ] A line like this becomes a checkbox on the card"}
                    className="w-full min-h-[40vh] bg-transparent text-[14px] text-fg placeholder:text-fg-subtle outline-none resize-none leading-[1.75] [field-sizing:content]"
                  />
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-semibold tracking-tight text-fg mb-3">{selected.title || "Untitled note"}</h2>
                  {selected.body ? <NoteBody body={selected.body} /> : <p className="text-sm text-fg-subtle italic">No content</p>}
                </>
              )}
            </div>
            {isMine && (
              <div className="flex items-center justify-between gap-2 px-5 py-2.5 border-t border-line shrink-0">
                <button type="button" onClick={addChecklistItem} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg rounded-lg px-2 py-1.5 hover:bg-surface-3">
                  <ListChecks className="w-4 h-4" /> Add checklist item
                </button>
                <span className="text-[11px] text-fg-subtle tabular-nums">
                  {draftBody.trim() ? draftBody.trim().split(/\s+/).length : 0} words · saves as you type
                </span>
              </div>
            )}
          </div>
        </Overlay>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        description={selected?.recipientIds.length ? "It will also disappear for everyone you shared it with. This can't be undone." : "This can't be undone."}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
