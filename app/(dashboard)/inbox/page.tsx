"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Voicemail as VoicemailIcon, PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, MessageSquare,
  RefreshCw, AlertCircle, Search, ChevronDown, ArrowUpRight, Download, Inbox, Sparkles,
} from "lucide-react";
import Header from "@/components/layout/Header";
import CallLink from "@/components/phone/CallLink";
import CallDetailPanel from "@/components/calls/CallDetailPanel";
import Select from "@/components/ui/Select";
import { colourFor, initialsFor } from "@/components/messages/Avatar";
import { usePolling } from "@/lib/use-polling";
import { formatPhone } from "@/lib/utils";
import type { SmsConversation } from "@/lib/ringlogix-messages";
import type { CallRecord, Voicemail } from "@/lib/inbox";

type Contacts = Record<string, { name: string; company: string }>;

interface Data {
  voicemails: Voicemail[];
  calls: CallRecord[];
  conversations: SmsConversation[];
  names: Record<string, string>;
  contacts: Contacts;
  unavailable: string[];
}

type Kind = "all" | "vmail" | "calls" | "missed" | "texts";

/** One row, whatever it came from. */
type Item =
  | { kind: "vmail"; key: string; at: number; ext: string; v: Voicemail }
  | { kind: "call"; key: string; at: number; ext: string; c: CallRecord }
  | { kind: "text"; key: string; at: number; ext: string; t: SmsConversation };

const CACHE = "sc:uc-inbox-v1";

function readCache(): Data | null {
  try {
    const raw = sessionStorage.getItem(CACHE);
    const data = raw ? (JSON.parse(raw) as Data) : null;
    return data && Array.isArray(data.voicemails) ? data : null;
  } catch {
    return null;
  }
}

function writeCache(data: Data) {
  try {
    sessionStorage.setItem(CACHE, JSON.stringify(data));
  } catch {
    // Only costs the instant paint next time.
  }
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function dayLabel(ms: number, now: number) {
  const d = new Date(ms);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: diff < 7 ? "long" : undefined, month: "short", day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function duration(sec: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export default function InboxPage() {
  const [cached] = useState(readCache);
  const [data, setData] = useState<Data | null>(cached);
  const [state, setState] = useState<"loading" | "ok" | "error">(cached ? "ok" : "loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [kind, setKind] = useState<Kind>("all");
  const [ext, setExt] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // The day headings need "now"; it's taken when data arrives, not in render.
  const [now, setNow] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [inbox, messages] = await Promise.all([
        fetch("/api/inbox").then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })),
        fetch("/api/ringlogix/messages").then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })),
      ]);
      if (!inbox.ok && !messages.ok) throw new Error(inbox.body.message ?? inbox.body.error ?? "Couldn't load the inbox");
      const next: Data = {
        voicemails: inbox.ok ? inbox.body.voicemails ?? [] : [],
        calls: inbox.ok ? inbox.body.calls ?? [] : [],
        conversations: messages.ok ? messages.body.conversations ?? [] : [],
        names: messages.body.names ?? {},
        contacts: messages.body.contacts ?? {},
        unavailable: [
          ...(inbox.ok ? inbox.body.unavailable ?? [] : ["voicemail", "calls"]),
          ...(messages.ok ? [] : ["texts"]),
        ],
      };
      setData(next);
      setNow(Date.now());
      writeCache(next);
      setState("ok");
      setError("");
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : "Couldn't load the inbox");
        setState((s) => (s === "ok" ? s : "error"));
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Sets state only after the fetches answer; the rule can't see past the
  // useCallback to tell.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  usePolling(() => load(true), 45_000, state === "ok");

  const contacts = useMemo(() => data?.contacts ?? {}, [data]);
  const names = useMemo(() => data?.names ?? {}, [data]);
  const person = useCallback((digits: string) => {
    const d = (digits ?? "").replace(/\D/g, "").slice(-10);
    return (d && contacts[d]?.name) || formatPhone(digits) || digits || "Unknown";
  }, [contacts]);
  const extName = useCallback((e: string) => (e ? names[e] ? `${names[e]} (${e})` : `Extension ${e}` : ""), [names]);

  // The texts conversation with a number, for "Text them".
  const threadFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of data?.conversations ?? []) {
      if (t.isGroup) continue;
      const d = (t.remoteNumbers[0] ?? "").slice(-10);
      if (d && !map.has(d)) map.set(d, t.sessionId);
    }
    return map;
  }, [data]);

  const items = useMemo<Item[]>(() => {
    if (!data) return [];
    const out: Item[] = [
      ...data.voicemails.map((v) => ({ kind: "vmail" as const, key: `v:${v.user}:${v.id}`, at: v.at, ext: v.user, v })),
      ...data.calls.map((c) => ({ kind: "call" as const, key: `c:${c.id}`, at: c.at, ext: c.direction === "out" ? c.fromExtension : c.toExtension, c })),
      ...data.conversations.map((t) => ({ kind: "text" as const, key: `t:${t.sessionId}`, at: t.lastAt, ext: t.user, t })),
    ];
    return out.sort((a, b) => b.at - a.at);
  }, [data]);

  const counts = useMemo(() => ({
    vmail: items.filter((i) => i.kind === "vmail").length,
    calls: items.filter((i) => i.kind === "call").length,
    missed: items.filter((i) => i.kind === "call" && i.c.direction === "in" && !i.c.answered).length,
    texts: items.filter((i) => i.kind === "text").length,
    unread: items.filter((i) => i.kind === "text" && i.t.unread).length,
  }), [items]);

  const extensions = useMemo(() => {
    const set = new Set(items.map((i) => i.ext).filter((e) => e && /^\d{1,4}$/.test(e)));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return items.filter((i) => {
      if (kind === "vmail" && i.kind !== "vmail") return false;
      if (kind === "calls" && i.kind !== "call") return false;
      if (kind === "missed" && !(i.kind === "call" && i.c.direction === "in" && !i.c.answered)) return false;
      if (kind === "texts" && i.kind !== "text") return false;
      if (ext && i.ext !== ext) return false;
      if (!q) return true;
      const hay =
        i.kind === "vmail" ? [i.v.fromName, person(i.v.fromNumber), i.v.fromNumber, i.v.fromExtension, i.v.transcription]
        : i.kind === "call" ? [i.c.fromName, person(i.c.fromNumber), i.c.fromNumber, i.c.toNumber, person(i.c.toNumber)]
        : [i.t.name, i.t.lastMessage, ...i.t.remoteNumbers, ...i.t.remoteNumbers.map(person)];
      return hay.some((h) => (h ?? "").toLowerCase().includes(q) || (qDigits.length >= 3 && (h ?? "").replace(/\D/g, "").includes(qDigits)));
    });
  }, [items, kind, ext, query, person]);

  // Grouped under day headings.
  const groups = useMemo(() => {
    const out: Array<{ day: string; rows: Item[] }> = [];
    for (const i of shown) {
      const day = dayLabel(i.at, now || i.at);
      const last = out[out.length - 1];
      if (last?.day === day) last.rows.push(i);
      else out.push({ day, rows: [i] });
    }
    return out;
  }, [shown, now]);

  const tabs: Array<{ id: Kind; label: string; count?: number }> = [
    { id: "all", label: "All" },
    { id: "vmail", label: "Voicemail", count: counts.vmail },
    { id: "calls", label: "Calls", count: counts.calls },
    { id: "missed", label: "Missed", count: counts.missed },
    { id: "texts", label: "Texts", count: counts.texts },
  ];

  const stats: Array<{ id: Kind; label: string; value: number; hint: string; Icon: typeof Phone; tone: string }> = [
    { id: "missed", label: "Missed calls", value: counts.missed, hint: "Last 7 days", Icon: PhoneMissed, tone: "bg-tint-rose text-ink-rose" },
    { id: "vmail", label: "Voicemails", value: counts.vmail, hint: "In every mailbox", Icon: VoicemailIcon, tone: "bg-tint-violet text-ink-violet" },
    { id: "texts", label: "Unread texts", value: counts.unread, hint: `${counts.texts} conversations`, Icon: MessageSquare, tone: "bg-tint-blue text-ink-blue" },
    { id: "calls", label: "Calls", value: counts.calls, hint: "Last 7 days", Icon: Phone, tone: "bg-tint-green text-ink-green" },
  ];
  const filtered = Boolean(query || ext || kind !== "all");

  return (
    <div className="max-w-6xl">
      <Header
        title="Inbox"
        subtitle="Voicemail, calls and texts from every extension in one place."
        actions={
          <div className="flex items-center gap-3">
            {now > 0 && <span className="hidden sm:inline text-xs text-fg-subtle">Updated {clock(now)}</span>}
            <button
              onClick={() => load()}
              disabled={refreshing}
              className="flex items-center gap-2 border border-line bg-surface text-sm font-medium text-fg px-3.5 py-2 rounded-lg hover:bg-surface-3 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        }
      />

      {/* At a glance; each card is also a shortcut to its filter. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {stats.map((st) => (
          <button
            key={st.id}
            onClick={() => setKind(kind === st.id ? "all" : st.id)}
            className={`text-left bg-surface border rounded-xl p-4 transition-all hover:shadow-sm ${
              kind === st.id ? "border-fg ring-1 ring-fg" : "border-line hover:border-line-strong"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-medium text-fg-muted">{st.label}</span>
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${st.tone}`}><st.Icon className="w-4 h-4" /></span>
            </div>
            <p className="text-2xl font-semibold text-fg tabular-nums leading-none">
              {state === "ok" ? st.value : <span className="inline-block w-8 h-6 rounded bg-surface-3 animate-pulse align-middle" />}
            </p>
            <p className="text-[11px] text-fg-subtle mt-1.5">{st.hint}</p>
          </button>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
          <div className="flex items-center p-0.5 rounded-lg bg-surface-3 overflow-x-auto max-w-full">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setKind(t.id)}
                className={`shrink-0 flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-md transition-colors ${
                  kind === t.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
                }`}
              >
                {t.label}
                {t.count !== undefined && state === "ok" && (
                  <span className={`text-[10.5px] tabular-nums px-1.5 rounded-full ${
                    t.id === "missed" && t.count ? "bg-tint-rose text-ink-rose" : kind === t.id ? "bg-surface-3 text-fg-muted" : "text-fg-subtle"
                  }`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
            <Select
              value={ext}
              onChange={setExt}
              className="w-48 shrink-0"
              options={[{ value: "", label: "All extensions" }, ...extensions.map((e) => ({ value: e, label: extName(e) }))]}
            />
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, number or words"
                className="w-full text-sm bg-surface border border-line rounded-lg pl-8.5 pr-3 py-2 text-fg placeholder:text-fg-subtle outline-none focus:border-fg transition-colors"
              />
            </div>
          </div>
        </div>

        {data && data.unavailable.length > 0 && (
          <div className="px-4 py-2 text-xs text-ink-amber bg-tint-amber border-b border-line flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" />
            Couldn&apos;t load {data.unavailable.join(" or ")} just now; showing the rest.
          </div>
        )}

        {state === "loading" && (
          <ul className="divide-y divide-line">
            {Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3.5 px-5 py-3.5">
                <span className="w-10 h-10 rounded-full bg-surface-3 animate-pulse shrink-0" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-40 rounded bg-surface-3 animate-pulse" />
                  <span className="block h-2.5 w-64 max-w-full rounded bg-surface-3 animate-pulse" />
                </span>
                <span className="h-2.5 w-12 rounded bg-surface-3 animate-pulse" />
              </li>
            ))}
            <li className="px-5 py-3 text-xs text-fg-subtle text-center">Reading every extension&apos;s voicemail and calls. The first load takes a few seconds.</li>
          </ul>
        )}

        {state === "error" && (
          <div className="py-16 px-6 text-center">
            <span className="w-12 h-12 rounded-full bg-tint-rose text-ink-rose flex items-center justify-center mx-auto mb-3"><AlertCircle className="w-5 h-5" /></span>
            <p className="text-sm font-semibold text-fg mb-1">Couldn&apos;t load the inbox</p>
            <p className="text-xs text-fg-subtle mb-4">{error}</p>
            <button onClick={() => load()} className="text-xs font-medium border border-line rounded-lg px-3 py-1.5 text-fg hover:bg-surface-3">Try again</button>
          </div>
        )}

        {state === "ok" && shown.length === 0 && (
          <div className="py-16 px-6 text-center">
            <span className="w-12 h-12 rounded-full bg-surface-3 text-fg-subtle flex items-center justify-center mx-auto mb-3"><Inbox className="w-5 h-5" /></span>
            <p className="text-sm font-semibold text-fg mb-1">{filtered ? "Nothing matches" : "All caught up"}</p>
            <p className="text-xs text-fg-subtle">{filtered ? "Try a different filter or search." : "New voicemail, calls and texts will show up here."}</p>
          </div>
        )}

        {state === "ok" && groups.map((g) => (
          <section key={g.day}>
            <h3 className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle bg-surface-3 border-b border-line">
              {g.day} <span className="font-normal normal-case tracking-normal">· {g.rows.length}</span>
            </h3>
            <ul className="divide-y divide-line">
              {g.rows.map((i) => (
                <Row
                  key={i.key}
                  item={i}
                  open={open === i.key}
                  onToggle={() => setOpen((o) => (o === i.key ? null : i.key))}
                  person={person}
                  extName={extName}
                  names={names}
                  threadFor={threadFor}
                />
              ))}
            </ul>
          </section>
        ))}
        {state === "ok" && shown.length > 0 && (
          <p className="px-5 py-3 text-[11px] text-fg-subtle border-t border-line">
            Showing {shown.length} item{shown.length === 1 ? "" : "s"}. Calls cover the last 7 days; voicemail is each extension&apos;s current mailbox.
          </p>
        )}
      </div>
    </div>
  );
}

/** A person's circle, with what kind of item it is badged in the corner. */
function Badged({ name, Icon, tone }: { name: string; Icon: typeof Phone; tone: string }) {
  return (
    <span className="relative shrink-0">
      <span className={`w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold ${colourFor(name)}`}>{initialsFor(name)}</span>
      <span className={`absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 rounded-full ring-2 ring-surface flex items-center justify-center ${tone}`}>
        <Icon className="w-2.5 h-2.5" />
      </span>
    </span>
  );
}

const actionBtn = "w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors";
const rowBase = "group flex items-center gap-3 px-5 py-3";

/*
 * The right-hand side of every row is the same four fixed columns - the
 * extension, the actions, the time, the expand arrow - so they line up down
 * the list whatever a row has in them. (Sized to their content, the tags
 * wandered left and right with each row's buttons.)
 */

/** "Ext 100 · Balijinder Singh": the number first, so the column scans. */
function ExtTag({ ext, names }: { ext: string; names: Record<string, string> }) {
  return (
    <span className="hidden lg:flex w-48 shrink-0">
      {ext && (
        <span className="inline-flex items-center gap-1 max-w-full text-[11px] px-2 py-0.5 rounded-md bg-surface-3 text-fg-muted" title={names[ext] ? `${names[ext]}, extension ${ext}` : `Extension ${ext}`}>
          <span className="font-semibold tabular-nums text-fg shrink-0">{ext}</span>
          {names[ext] && <span className="truncate">· {names[ext]}</span>}
        </span>
      )}
    </span>
  );
}

function Actions({ children }: { children?: React.ReactNode }) {
  return <span className="w-[4.25rem] shrink-0 flex items-center justify-end gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity">{children}</span>;
}

const Time = ({ at }: { at: number }) => <span className="w-16 shrink-0 text-right text-xs text-fg-subtle tabular-nums">{clock(at)}</span>;
const Trail = ({ children }: { children?: React.ReactNode }) => <span className="w-5 shrink-0 flex justify-center">{children}</span>;

function Row({
  item, open, onToggle, person, extName, names, threadFor,
}: {
  item: Item;
  open: boolean;
  onToggle: () => void;
  person: (digits: string) => string;
  extName: (ext: string) => string;
  names: Record<string, string>;
  threadFor: Map<string, string>;
}) {
  if (item.kind === "text") {
    const t = item.t;
    const who = t.name || (t.isGroup ? t.remoteNumbers.map(person).join(", ") : t.remoteExtension ? extName(t.remoteExtension) : person(t.remoteNumbers[0] ?? t.remote));
    return (
      <li>
        <Link href={`/messages?session=${encodeURIComponent(t.sessionId)}`} className={`${rowBase} hover:bg-surface-3 transition-colors`}>
          <Badged name={who} Icon={MessageSquare} tone="bg-tint-blue text-ink-blue" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={`text-sm truncate text-fg ${t.unread ? "font-semibold" : "font-medium"}`}>{who}</span>
              {t.unread && <span className="w-2 h-2 rounded-full bg-[#0070f3] shrink-0" aria-label="Unread" />}
            </span>
            <span className={`block text-[13px] truncate mt-0.5 ${t.unread ? "text-fg" : "text-fg-muted"}`}>{t.lastMessage || (t.hasMedia ? "Picture" : "")}</span>
          </span>
          <ExtTag ext={t.user} names={names} />
          <Actions />
          <Time at={item.at} />
          <Trail><ArrowUpRight className="w-4 h-4 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" /></Trail>
        </Link>
      </li>
    );
  }

  if (item.kind === "call") {
    const c = item.c;
    const missed = c.direction === "in" && !c.answered;
    const Icon = missed ? PhoneMissed : c.direction === "in" ? PhoneIncoming : c.direction === "out" ? PhoneOutgoing : Phone;
    const who =
      c.direction === "in" ? (person(c.fromNumber) !== formatPhone(c.fromNumber) ? person(c.fromNumber) : c.fromName || person(c.fromNumber))
      : c.direction === "out" ? person(c.toNumber)
      : [c.fromName || extName(c.fromExtension), extName(c.toExtension)].filter(Boolean).join(" → ") || "Internal call";
    const detail =
      c.direction === "in" ? (missed ? (c.voicemail ? "Missed call · left a voicemail" : "Missed call") : "Incoming call")
      : c.direction === "out" ? "Outgoing call"
      : "Internal call";
    // Whose extension it was: who rang out, or who it rang.
    const ourExt = c.direction === "out" ? c.fromExtension : c.direction === "in" ? c.toExtension : c.fromExtension;
    const number = c.direction === "in" ? c.fromNumber : c.direction === "out" ? c.toNumber : "";
    const thread = number ? threadFor.get(number.slice(-10)) : undefined;
    const showNumber = number && c.direction !== "internal" && person(number) !== formatPhone(number);
    // A call that connected has a recording (every call on the domain is
    // recorded) and usually a transcript: those open like a voicemail.
    const expandable = c.answered && c.talkSec > 0;
    return (
      <li className={open ? "bg-surface-3" : ""}>
        <div className={`${rowBase} hover:bg-surface-3 transition-colors`}>
          <button
            type="button"
            onClick={expandable ? onToggle : undefined}
            className={`flex items-center gap-3 min-w-0 flex-1 text-left ${expandable ? "cursor-pointer" : "cursor-default"}`}
          >
            <Badged
              name={who}
              Icon={Icon}
              tone={missed ? "bg-tint-rose text-ink-rose" : c.direction === "out" ? "bg-tint-green text-ink-green" : "bg-tint-slate text-ink-slate"}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`text-sm truncate font-medium ${missed ? "text-ink-rose" : "text-fg"}`}>{who}</span>
                {c.transcribed && expandable && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-tint-violet text-ink-violet shrink-0">
                    <Sparkles className="w-2.5 h-2.5" /> Transcript
                  </span>
                )}
              </span>
              <span className="block text-[13px] text-fg-muted truncate mt-0.5">
                {detail}
                {c.talkSec && c.answered ? ` · ${duration(c.talkSec)}` : ""}
                {showNumber ? ` · ${formatPhone(number)}` : ""}
              </span>
            </span>
          </button>
          <ExtTag ext={ourExt} names={names} />
          <Actions>
            {thread && (
              <Link href={`/messages?session=${encodeURIComponent(thread)}`} className={actionBtn} data-tip="Open texts"><MessageSquare className="w-4 h-4" /></Link>
            )}
            {number && c.direction !== "internal" && (
              <CallLink number={number} name={who} className={actionBtn} tip="Call back"><Phone className="w-4 h-4" /></CallLink>
            )}
          </Actions>
          <Time at={item.at} />
          <Trail>
            {expandable && (
              <button type="button" onClick={onToggle} aria-label={open ? "Hide call details" : "Show recording and transcript"}>
                <ChevronDown className={`w-4 h-4 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            )}
          </Trail>
        </div>
        {open && expandable && (
          <div className="pl-[4.5rem] pr-5 pb-4">
            <CallDetailPanel id={c.id} />
          </div>
        )}
      </li>
    );
  }

  const v = item.v;
  const who = v.fromExtension
    ? v.fromName || extName(v.fromExtension)
    : (person(v.fromNumber) !== formatPhone(v.fromNumber) ? person(v.fromNumber) : v.fromName || person(v.fromNumber));
  const thread = v.fromNumber ? threadFor.get(v.fromNumber.slice(-10)) : undefined;
  const audio = `/api/inbox/voicemail?${new URLSearchParams({ user: v.user, id: v.id })}`;
  return (
    <li className={open ? "bg-surface-3" : ""}>
      <button onClick={onToggle} className={`${rowBase} w-full text-left hover:bg-surface-3 transition-colors`}>
        <Badged name={who} Icon={VoicemailIcon} tone="bg-tint-violet text-ink-violet" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg truncate">{who}</span>
            {v.durationSec ? <span className="text-[11px] text-fg-subtle tabular-nums shrink-0">{duration(v.durationSec)}</span> : null}
          </span>
          <span className={`block text-[13px] text-fg-muted mt-0.5 ${open ? "" : "truncate"}`}>
            {v.transcription || <span className="italic text-fg-subtle">No transcription</span>}
          </span>
        </span>
        <ExtTag ext={v.user} names={names} />
        <Actions />
        <Time at={item.at} />
        <Trail><ChevronDown className={`w-4 h-4 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} /></Trail>
      </button>
      {open && (
        <div className="pl-[4.5rem] pr-5 pb-4 space-y-3">
          {/* Streams through our server: RingLogix's own link needs no login. */}
          <audio controls autoPlay preload="none" src={audio} className="w-full max-w-lg h-10" />
          <div className="flex flex-wrap items-center gap-2">
            {v.fromNumber && !v.fromExtension && (
              <CallLink number={v.fromNumber} name={who} className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 bg-fg text-surface hover:opacity-90">
                <Phone className="w-3.5 h-3.5" /> Call back
              </CallLink>
            )}
            {thread && (
              <Link href={`/messages?session=${encodeURIComponent(thread)}`} className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 border border-line bg-surface text-fg hover:bg-surface-3">
                <MessageSquare className="w-3.5 h-3.5" /> Text them
              </Link>
            )}
            <a href={audio} download className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 border border-line bg-surface text-fg hover:bg-surface-3">
              <Download className="w-3.5 h-3.5" /> Download
            </a>
            {v.fromNumber && <span className="text-xs text-fg-subtle tabular-nums ml-1">{formatPhone(v.fromNumber) || v.fromNumber}</span>}
          </div>
        </div>
      )}
    </li>
  );
}
