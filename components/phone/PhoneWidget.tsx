"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone, Grid3x3, Delete, X, RefreshCw, PhoneIncoming, PhoneOutgoing,
  PhoneMissed, Search, Users, Clock, Voicemail as VoicemailIcon, ChevronDown, ArrowRightLeft, Sparkles, Info, SquareParking,
} from "lucide-react";
import { usePolling } from "@/lib/use-polling";
import CallDetailPanel from "@/components/calls/CallDetailPanel";
import { usePhoneState, type CallInfo } from "./PhoneProvider";
import CallScreen from "./CallScreen";
import { colourFor, initialsFor } from "@/components/messages/Avatar";
import { formatPhone } from "@/lib/utils";
import { whoHas, type DirectoryEntry, type Recents } from "@/lib/phone/types";
import type { CallRecord, Voicemail } from "@/lib/inbox";

/**
 * The portal phone, laid out like the phone app on a mobile: Recents,
 * Contacts, Keypad and Voicemail along the bottom, and the call screen
 * taking over while a call is on.
 */

type Tab = "recents" | "contacts" | "keypad" | "voicemail";

const KEYS: Array<[string, string]> = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

const SEEN_KEY = "phone-recents-seen";
const shown = (number: string) => (number.length >= 10 ? formatPhone(number) || number : number);

function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function length(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return m ? `${m}m ${sec % 60}s` : `${sec}s`;
}

function useClock(call: CallInfo | null): string {
  const [now, setNow] = useState(() => Date.now());
  const running = call?.state === "active" && call.startedAt !== null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!running || !call?.startedAt) return "";
  const s = Math.max(0, Math.floor((now - call.startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "w-20 h-20 text-2xl" : size === "md" ? "w-10 h-10 text-[13px]" : "w-8 h-8 text-[11px]";
  return (
    <span className={`${cls} rounded-full flex items-center justify-center font-semibold shrink-0 ${colourFor(name)}`}>
      {initialsFor(name)}
    </span>
  );
}

function Keypad({ onKey, compact }: { onKey: (k: string) => void; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-3 ${compact ? "gap-x-5 gap-y-2" : "gap-x-6 gap-y-3"} px-4`}>
      {KEYS.map(([k, letters]) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className={`${compact ? "h-12" : "h-14"} rounded-full bg-surface-3 hover:bg-line text-fg flex flex-col items-center justify-center transition-colors active:scale-95`}
        >
          <span className="text-[22px] font-normal leading-none tabular-nums">{k}</span>
          <span className="text-[8.5px] font-semibold tracking-[0.18em] text-fg-subtle h-2.5 leading-none mt-1">{letters}</span>
        </button>
      ))}
    </div>
  );
}

function Empty({ icon: Icon, title, text }: { icon: typeof Phone; title: string; text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8">
      <span className="w-12 h-12 rounded-full bg-surface-3 text-fg-subtle flex items-center justify-center mb-3"><Icon className="w-5 h-5" /></span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="text-xs text-fg-subtle mt-1">{text}</p>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <p className="h-full flex items-center justify-center gap-2 text-xs text-fg-subtle">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {label}
    </p>
  );
}

// ── Recents ─────────────────────────────────────────────────────────────

interface RecentRow {
  call: CallRecord;
  number: string;
  name: string;
  kind: "in" | "out" | "missed" | "internal";
}

function recentRows(recents: Recents, directory: DirectoryEntry[] | null): RecentRow[] {
  const me = recents.extension;
  return recents.calls.map((c) => {
    let number = "";
    let name = "";
    if (c.direction === "out") number = c.toNumber;
    else if (c.direction === "in") { number = c.fromNumber; name = c.fromName; }
    else if (c.fromExtension === me) number = c.toExtension;
    else { number = c.fromExtension; name = c.fromName; }
    const known = directory ? whoHas(directory, number)?.name : "";
    const toMe = c.toExtension === me && c.fromExtension !== me;
    const kind: RecentRow["kind"] =
      (c.direction === "in" || (c.direction === "internal" && toMe)) && !c.answered ? "missed"
      : c.direction === "out" || (c.direction === "internal" && !toMe) ? "out"
      : c.direction === "internal" ? "internal" : "in";
    return { call: c, number, name: known || (name && name !== number ? name : ""), kind };
  });
}

function RecentsTab({ recents, directory, onCall }: { recents: Recents | null; directory: DirectoryEntry[] | null; onCall: (n: string, name: string) => void }) {
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => (recents ? recentRows(recents, directory) : []), [recents, directory]);
  const list = filter === "missed" ? rows.filter((r) => r.kind === "missed") : rows;
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-fg">Recents</h2>
        <div className="grid grid-cols-2 p-0.5 rounded-lg bg-surface-3 text-[12px] font-medium">
          {(["all", "missed"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1 rounded-md capitalize ${filter === f ? "bg-surface text-fg shadow-sm" : "text-fg-muted"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!recents ? <Loading label="Loading your calls…" />
          : list.length === 0 ? (
            <Empty icon={filter === "missed" ? PhoneMissed : Clock} title={filter === "missed" ? "No missed calls" : "No calls yet"} text="Calls to and from your extension in the last 14 days show here." />
          ) : (
            <ul>
              {list.map((r) => {
                const Icon = r.kind === "missed" ? PhoneMissed : r.kind === "out" ? PhoneOutgoing : r.kind === "internal" ? ArrowRightLeft : PhoneIncoming;
                const label = r.name || shown(r.number) || "Unknown";
                const hasDetail = r.call.answered && r.call.talkSec > 0;
                const expanded = openId === r.call.id;
                return (
                  <li key={r.call.id} className={expanded ? "bg-surface-3" : ""}>
                    <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => r.number && onCall(r.number, r.name)}
                      disabled={!r.number}
                      className="group flex-1 min-w-0 flex items-center gap-3 pl-4 pr-2 py-2.5 text-left hover:bg-surface-3 transition-colors"
                    >
                      <Avatar name={label} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-medium truncate ${r.kind === "missed" ? "text-ink-rose" : "text-fg"}`}>{label}</span>
                        <span className="flex items-center gap-1 text-[12px] text-fg-subtle mt-0.5">
                          <Icon className={`w-3 h-3 shrink-0 ${r.kind === "missed" ? "text-ink-rose" : ""}`} />
                          <span className="truncate">
                            {r.kind === "missed" ? (r.call.voicemail ? "Missed · voicemail" : "Missed") : r.kind === "out" ? "Outgoing" : r.kind === "internal" ? "Internal" : "Incoming"}
                            {r.name && r.number ? ` · ${shown(r.number)}` : ""}
                            {r.call.answered && r.call.talkSec ? ` · ${length(r.call.talkSec)}` : ""}
                          </span>
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[11px] text-fg-subtle">{when(r.call.at)}</span>
                        <Phone className="w-3.5 h-3.5 text-ink-green opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </button>
                    {/* Recording, transcript and summary, as on the Inbox. */}
                    {hasDetail ? (
                      <button
                        type="button"
                        onClick={() => setOpenId(expanded ? null : r.call.id)}
                        aria-label={expanded ? "Hide call details" : "Recording and transcript"}
                        title="Recording and transcript"
                        className={`mr-2 w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${expanded ? "bg-fg text-surface" : "text-fg-subtle hover:bg-line hover:text-fg"}`}
                      >
                        {r.call.transcribed ? <Sparkles className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
                      </button>
                    ) : <span className="mr-2 w-7 shrink-0" />}
                    </div>
                    {expanded && (
                      <div className="px-4 pb-3">
                        <CallDetailPanel id={r.call.id} compact />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </div>
  );
}

// ── Contacts ────────────────────────────────────────────────────────────

function ContactsTab({ entries, onCall }: { entries: DirectoryEntry[] | null; onCall: (number: string, name: string) => void }) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const matches = useMemo(() => {
    const list = entries ?? [];
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    if (!q) return list;
    return list.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.detail.toLowerCase().includes(q) ||
      (qd.length >= 2 && e.numbers.some((n) => n.number.includes(qd))),
    );
  }, [entries, query]);
  const capped = matches.slice(0, 200);
  const sections = [
    { title: "Contacts", rows: capped.filter((e) => e.kind === "contact") },
    { title: "Colleagues & extensions", rows: capped.filter((e) => e.kind === "colleague") },
  ].filter((s) => s.rows.length);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-lg font-semibold text-fg mb-2">Contacts</h2>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full text-sm bg-surface-3 rounded-lg pl-8.5 pr-3 py-2 text-fg placeholder:text-fg-subtle outline-none focus:ring-2 focus:ring-line"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!entries ? <Loading label="Loading contacts…" />
          : sections.length === 0 ? <Empty icon={Users} title={query ? "No one matches" : "No contacts yet"} text={query ? "Try another name or number." : "Contacts saved in RingLogix show here."} />
          : (
            <ul className="pb-2">
              {sections.map((s) => (
                <li key={s.title}>
                  <p className="sticky top-0 z-[1] px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle bg-surface border-b border-line">
                    {s.title} <span className="font-normal normal-case tracking-normal">· {s.rows.length}</span>
                  </p>
                  <ul>
                    {s.rows.map((e) => {
                      const expanded = openId === e.id;
                      const single = e.numbers.length === 1;
                      return (
                        <li key={e.id} className={expanded ? "bg-surface-3" : ""}>
                          <button
                            type="button"
                            onClick={() => (single ? onCall(e.numbers[0].number, e.name) : setOpenId(expanded ? null : e.id))}
                            className="group w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-3 transition-colors"
                          >
                            <Avatar name={e.name} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-fg truncate">{e.name}</span>
                              <span className="block text-[12px] text-fg-subtle truncate mt-0.5">
                                {e.kind === "colleague" ? e.detail : <>{e.detail ? `${e.detail} · ` : ""}{single ? `${e.numbers[0].label} ${shown(e.numbers[0].number)}` : `${e.numbers.length} numbers`}</>}
                              </span>
                            </span>
                            {single
                              ? <Phone className="w-4 h-4 text-ink-green opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                              : <ChevronDown className={`w-4 h-4 text-fg-subtle shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />}
                          </button>
                          {expanded && (
                            <div className="pl-[4.25rem] pr-4 pb-2.5 space-y-1">
                              {e.numbers.map((n) => (
                                <button
                                  key={n.label + n.number}
                                  type="button"
                                  onClick={() => onCall(n.number, e.name)}
                                  className="w-full flex items-center justify-between rounded-lg bg-surface border border-line px-3 py-1.5 text-left hover:border-line-strong"
                                >
                                  <span>
                                    <span className="block text-[11px] text-fg-subtle">{n.label}</span>
                                    <span className="block text-sm text-fg tabular-nums">{shown(n.number)}</span>
                                  </span>
                                  <span className="w-7 h-7 rounded-full bg-[#17c964] text-white flex items-center justify-center"><Phone className="w-3.5 h-3.5" /></span>
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

// ── Voicemail ───────────────────────────────────────────────────────────

function VoicemailTab({ recents, directory, onCall }: { recents: Recents | null; directory: DirectoryEntry[] | null; onCall: (n: string, name: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const nameOf = (v: Voicemail) => {
    const number = v.fromNumber || v.fromExtension;
    return (directory ? whoHas(directory, number)?.name : "") || v.fromName || shown(number) || "Unknown caller";
  };
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-lg font-semibold text-fg">Voicemail</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!recents ? <Loading label="Loading voicemail…" />
          : recents.voicemails.length === 0 ? <Empty icon={VoicemailIcon} title="No voicemail" text="Messages left for your extension show here." />
          : (
            <ul>
              {recents.voicemails.map((v) => {
                const name = nameOf(v);
                const number = v.fromNumber || v.fromExtension;
                const expanded = openId === v.id;
                const audio = `/api/inbox/voicemail?${new URLSearchParams({ user: v.user, id: v.id })}`;
                return (
                  <li key={v.id} className={expanded ? "bg-surface-3" : ""}>
                    <button type="button" onClick={() => setOpenId(expanded ? null : v.id)} className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-3 transition-colors">
                      <Avatar name={name} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-fg truncate">{name}</span>
                          <span className="text-[11px] text-fg-subtle shrink-0">{when(v.at)}</span>
                        </span>
                        <span className={`block text-[12px] text-fg-muted mt-0.5 ${expanded ? "" : "line-clamp-2"}`}>
                          {v.transcription || <span className="italic text-fg-subtle">No transcription</span>}
                        </span>
                        {v.durationSec ? <span className="block text-[11px] text-fg-subtle mt-0.5">{length(v.durationSec)}</span> : null}
                      </span>
                    </button>
                    {expanded && (
                      <div className="pl-[4.25rem] pr-4 pb-3 space-y-2">
                        <audio controls autoPlay preload="none" src={audio} className="w-full h-9" />
                        {number && (
                          <button type="button" onClick={() => onCall(number, name === shown(number) ? "" : name)} className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 bg-[#17c964] text-white hover:bg-[#12a150]">
                            <Phone className="w-3.5 h-3.5" /> Call back
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </div>
  );
}

// ── Keypad ──────────────────────────────────────────────────────────────

function guessContact(directory: DirectoryEntry[] | null, digits: string) {
  if (!directory || digits.length < 3) return null;
  for (const e of directory) {
    const n = e.numbers.find((x) => x.number.includes(digits) || (digits.length >= 10 && x.number.endsWith(digits.slice(-10))));
    if (n) return { e, n };
  }
  return null;
}

function KeypadTab({ ready, extension, directory, onCall }: { ready: boolean; extension: string; directory: DirectoryEntry[] | null; onCall: (n: string, name: string) => void }) {
  const [number, setNumber] = useState("");
  const digits = number.replace(/\D/g, "");
  // Who you're probably dialling, once a few digits are in.
  // (The React Compiler memoises this; a hand-written useMemo here trips it.)
  const match = guessContact(directory, digits);
  const place = () => { if (number.trim()) onCall(number, match && match.n.number === digits ? match.e.name : ""); };

  return (
    // min-h, not h: with the parked-calls strip above, the keypad scrolls
    // instead of growing up over the strip (it hid the Pick up button).
    <div className="min-h-full flex flex-col justify-end pb-4">
      <div className="px-5">
        <div className="flex items-center gap-1 h-12">
          <span className="w-9" />
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^\d*#+()\-.\s]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") place(); }}
            placeholder="Enter a number"
            inputMode="tel"
            autoFocus
            className="flex-1 min-w-0 bg-transparent text-[28px] font-normal tracking-wide text-center text-fg tabular-nums placeholder:text-fg-subtle placeholder:text-base placeholder:tracking-normal outline-none"
          />
          <span className="w-9 flex justify-center">
            {number && (
              <button type="button" onClick={() => setNumber((n) => n.slice(0, -1))} className="p-1.5 rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label="Delete">
                <Delete className="w-5 h-5" />
              </button>
            )}
          </span>
        </div>
        <div className="h-9 flex items-center justify-center mb-3">
          {match && (
            <button type="button" onClick={() => onCall(match.n.number, match.e.name)} className="inline-flex items-center gap-2 rounded-full bg-surface-3 hover:bg-line pl-1 pr-3 py-1 max-w-full">
              <Avatar name={match.e.name} size="sm" />
              <span className="text-[12px] text-fg truncate"><span className="font-medium">{match.e.name}</span> <span className="text-fg-subtle">· {match.n.label} {shown(match.n.number)}</span></span>
            </button>
          )}
        </div>
      </div>
      <Keypad onKey={(k) => setNumber((n) => n + k)} />
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={place}
          disabled={!number.trim() || !ready}
          className="w-16 h-16 rounded-full bg-[#17c964] hover:bg-[#12a150] text-white flex items-center justify-center shadow-lg transition-colors disabled:opacity-35 disabled:shadow-none"
          aria-label="Call"
        >
          <Phone className="w-7 h-7" />
        </button>
      </div>
      <p className="mt-3 text-[11px] text-center text-fg-subtle">Calls show extension {extension}&apos;s caller ID</p>
    </div>
  );
}

// ── The phone ───────────────────────────────────────────────────────────

export default function PhoneWidget() {
  const phone = usePhoneState();
  const [tab, setTab] = useState<Tab>("keypad");
  const [seen, setSeen] = useState(() => {
    try { return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0; } catch { return 0; }
  });
  const clock = useClock(phone?.call ?? null);
  // Who's parked, kept fresh while the phone is open and idle.
  usePolling(() => phone?.loadParks(), 10_000, Boolean(phone && phone.open && !phone.call && phone.status !== "off"));

  // Clicking anywhere outside the phone (or pressing Escape) closes it, like
  // any other popover. The corner button and the panel itself don't count;
  // a call carries on regardless, and the green button brings it back.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const isOpen = Boolean(phone?.open);
  const setOpenRef = useRef(phone?.setOpen);
  useEffect(() => { setOpenRef.current = phone?.setOpen; });
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpenRef.current?.(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenRef.current?.(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const recents = phone?.recents ?? null;
  const missedNew = useMemo(() => {
    if (!recents) return 0;
    return recentRows(recents, null).filter((r) => r.kind === "missed" && r.call.at > seen).length;
  }, [recents, seen]);

  if (!phone || phone.status === "off") return null;

  const { status, call, open, setOpen } = phone;
  const inCall = Boolean(call && call.state !== "ended");
  const ringing = call?.direction === "in" && call.state === "ringing";
  const live = call?.state === "active";
  const dot = status === "ready" ? "bg-[#17c964]" : status === "error" ? "bg-[#f31260]" : "bg-[#f5a524]";
  const statusLabel = status === "ready" ? "Ready" : status === "error" ? "Offline" : "Connecting…";

  const go = (t: Tab) => {
    setTab(t);
    if (t === "recents" || t === "voicemail") phone.loadRecents();
    if (t !== "voicemail") phone.loadDirectory();
    if (t === "recents" && recents?.calls.length) {
      // Seen up to the newest call shown, by its own time.
      const latest = recents.calls[0].at;
      setSeen(latest);
      try { localStorage.setItem(SEEN_KEY, String(latest)); } catch { /* badge only */ }
    }
  };
  const toggle = () => {
    if (!open) { phone.loadRecents(); phone.loadDirectory(); phone.loadParks(); }
    setOpen(!open);
  };
  const callFrom = (n: string, name: string) => phone.dial(n, name);

  const vmCount = recents?.voicemails.length ?? 0;

  const tabs: Array<{ id: Tab; label: string; Icon: typeof Phone; badge?: number }> = [
    { id: "recents", label: "Recents", Icon: Clock, badge: missedNew },
    { id: "contacts", label: "Contacts", Icon: Users },
    { id: "keypad", label: "Keypad", Icon: Grid3x3 },
    { id: "voicemail", label: "Voicemail", Icon: VoicemailIcon, badge: vmCount },
  ];

  return (
    <>
      {/* The corner button. Pulses while a call is ringing. */}
      <button
        type="button"
        ref={buttonRef}
        onClick={toggle}
        aria-label={open ? "Close phone" : "Open phone"}
        className={`fixed bottom-5 right-5 z-[250] h-13 rounded-full shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)] flex items-center justify-center gap-2 transition-all ${
          inCall ? "bg-[#17c964] text-white px-5" : "bg-fg text-surface w-13 hover:scale-105"
        } ${ringing ? "animate-pulse" : ""}`}
      >
        {ringing ? <PhoneIncoming className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
        {inCall && <span className="text-sm font-semibold tabular-nums">{live ? clock || "0:00" : ringing ? "Incoming" : "Calling"}</span>}
        {!inCall && (missedNew > 0
          ? <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#f31260] text-white text-[11px] font-semibold flex items-center justify-center border-2 border-surface">{missedNew}</span>
          : <span className={`absolute top-0.5 right-0.5 w-3 h-3 rounded-full border-2 border-surface ${dot}`} />)}
      </button>

      {open && (
        <div ref={panelRef} className="fixed z-[250] bottom-22 right-5 left-5 sm:left-auto sm:w-[23rem] h-[min(40rem,calc(100vh-7.5rem))] bg-surface border border-line rounded-3xl shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-line shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              <p className="text-[13px] font-semibold text-fg">Ext. {phone.extension}</p>
              <p className="text-[12px] text-fg-subtle">{statusLabel}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label="Close phone">
              <X className="w-4 h-4" />
            </button>
          </div>

          {status === "error" && !inCall && (
            <div className="mx-4 mt-3 text-xs bg-tint-rose text-ink-rose rounded-lg px-3 py-2 flex items-center justify-between gap-2 shrink-0">
              <span>{phone.error || "The phone is offline."}</span>
              <button type="button" onClick={phone.retry} className="shrink-0 flex items-center gap-1 font-semibold">
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}

          {call ? (
            <CallScreen phone={phone} />
          ) : (
            <>
              {/* Calls waiting in a park spot: one tap picks them up. */}
              {(phone.parks ?? []).some((p) => p.parked) && (
                <div className="shrink-0 mx-3 mt-3 rounded-xl bg-tint-amber px-3 py-2 space-y-1.5">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-amber flex items-center gap-1"><SquareParking className="w-3 h-3" /> Parked calls</p>
                  {(phone.parks ?? []).filter((p) => p.parked).map((p) => (
                    <div key={p.spot} className="flex items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums text-ink-amber w-8">{p.spot}</span>
                      <span className="min-w-0 flex-1 text-[13px] text-fg truncate">{p.parked?.name || (p.parked?.number ? shown(p.parked.number) : "Caller")}</span>
                      <button
                        type="button"
                        onClick={() => phone.dial(p.spot, p.parked?.name || (p.parked?.number ? shown(p.parked.number) : `Parked on ${p.spot}`))}
                        className="text-xs font-semibold rounded-lg px-2.5 py-1 bg-[#17c964] text-white hover:bg-[#12a150]"
                      >
                        Pick up
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className={`flex-1 min-h-0 ${tab === "keypad" ? "overflow-y-auto" : ""}`}>
                {tab === "recents" && <RecentsTab recents={recents} directory={phone.directory} onCall={callFrom} />}
                {tab === "contacts" && <ContactsTab entries={phone.directory} onCall={callFrom} />}
                {tab === "keypad" && <KeypadTab ready={status === "ready"} extension={phone.extension} directory={phone.directory} onCall={callFrom} />}
                {tab === "voicemail" && <VoicemailTab recents={recents} directory={phone.directory} onCall={callFrom} />}
              </div>
              {/* The tab bar, as on a phone. */}
              <nav className="shrink-0 grid grid-cols-4 border-t border-line bg-surface">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => go(t.id)}
                    className={`relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors ${tab === t.id ? "text-[#0070f3]" : "text-fg-subtle hover:text-fg"}`}
                  >
                    <t.Icon className="w-5 h-5" />
                    {t.label}
                    {t.badge ? (
                      <span className={`absolute top-1 left-1/2 ml-1.5 min-w-4 h-4 px-1 rounded-full text-[9.5px] font-semibold flex items-center justify-center ${
                        t.id === "recents" ? "bg-[#f31260] text-white" : "bg-surface-3 text-fg-muted"
                      }`}>{t.badge}</span>
                    ) : null}
                  </button>
                ))}
              </nav>
            </>
          )}
        </div>
      )}
    </>
  );
}
