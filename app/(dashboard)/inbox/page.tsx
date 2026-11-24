"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Voicemail as VoicemailIcon, PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, MessageSquare,
  RefreshCw, AlertCircle, Search, ChevronDown, ArrowUpRight,
} from "lucide-react";
import Header from "@/components/layout/Header";
import CallLink from "@/components/phone/CallLink";
import Select from "@/components/ui/Select";
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

  return (
    <div>
      <Header
        title="Inbox"
        subtitle="Voicemail, calls and texts across every extension, newest first."
        actions={
          <button
            onClick={() => load()}
            disabled={refreshing}
            className="flex items-center gap-2 border border-[#eaeaea] bg-white text-sm font-medium text-[#0a0a0a] px-3.5 py-1.5 rounded-lg hover:bg-[#fafafa] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />

      <div className="bg-white border border-[#eaeaea] rounded-xl">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#eaeaea]">
          <div className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 max-w-full">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setKind(t.id)}
                className={`shrink-0 flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  kind === t.id ? "bg-[#0a0a0a] text-white" : "text-[#666] hover:bg-[#f5f5f5] hover:text-[#0a0a0a]"
                }`}
              >
                {t.label}
                {t.count !== undefined && state === "ok" && (
                  <span className={`text-[11px] tabular-nums ${kind === t.id ? "text-white/70" : "text-[#999]"}`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
            <Select
              value={ext}
              onChange={setExt}
              className="w-44 shrink-0"
              options={[{ value: "", label: "All extensions" }, ...extensions.map((e) => ({ value: e, label: extName(e) }))]}
            />
            <div className="relative flex-1 sm:w-60">
              <Search className="w-3.5 h-3.5 text-[#999] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, number or words"
                className="w-full text-sm border border-[#eaeaea] rounded-lg pl-8 pr-3 py-1.5 outline-none focus:border-[#0a0a0a] transition-colors"
              />
            </div>
          </div>
        </div>

        {data && data.unavailable.length > 0 && (
          <div className="px-4 py-2 text-xs text-[#666] bg-[#fafafa] border-b border-[#eaeaea] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-[#f5a524]" />
            Couldn&apos;t load {data.unavailable.join(" or ")} just now; showing the rest.
          </div>
        )}

        {state === "loading" && (
          <div className="p-12 text-center">
            <RefreshCw className="w-6 h-6 animate-spin text-[#999] mx-auto mb-3" />
            <p className="text-sm text-[#666]">Reading every extension&apos;s voicemail and calls…</p>
            <p className="text-xs text-[#999] mt-1">The first load takes a few seconds.</p>
          </div>
        )}

        {state === "error" && (
          <div className="p-12 text-center">
            <AlertCircle className="w-6 h-6 text-[#f31260] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#0a0a0a] mb-1">Couldn&apos;t load the inbox</p>
            <p className="text-xs text-[#999] mb-4">{error}</p>
            <button onClick={() => load()} className="text-xs text-[#0070f3] hover:underline">Retry</button>
          </div>
        )}

        {state === "ok" && shown.length === 0 && (
          <div className="p-12 text-center">
            <VoicemailIcon className="w-6 h-6 text-[#999] mx-auto mb-3" />
            <p className="text-sm text-[#999]">Nothing here{query || ext || kind !== "all" ? " for that filter" : ""}.</p>
          </div>
        )}

        {state === "ok" && groups.map((g) => (
          <div key={g.day}>
            <p className="px-4 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#999]">{g.day}</p>
            <ul className="divide-y divide-[#f4f4f4]">
              {g.rows.map((i) => (
                <Row
                  key={i.key}
                  item={i}
                  open={open === i.key}
                  onToggle={() => setOpen((o) => (o === i.key ? null : i.key))}
                  person={person}
                  extName={extName}
                  threadFor={threadFor}
                />
              ))}
            </ul>
          </div>
        ))}
        {state === "ok" && shown.length > 0 && (
          <p className="px-4 py-3 text-[11px] text-[#bbb] border-t border-[#f4f4f4]">
            Calls cover the last 7 days. Voicemail is every extension&apos;s current box.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  item, open, onToggle, person, extName, threadFor,
}: {
  item: Item;
  open: boolean;
  onToggle: () => void;
  person: (digits: string) => string;
  extName: (ext: string) => string;
  threadFor: Map<string, string>;
}) {
  const base = "flex items-start gap-3 px-4 py-3";
  const iconBox = "mt-0.5 w-8 h-8 shrink-0 rounded-full flex items-center justify-center";

  if (item.kind === "text") {
    const t = item.t;
    const who = t.name || (t.isGroup ? t.remoteNumbers.map(person).join(", ") : t.remoteExtension ? extName(t.remoteExtension) : person(t.remoteNumbers[0] ?? t.remote));
    return (
      <li>
        <Link href={`/messages?session=${encodeURIComponent(t.sessionId)}`} className={`${base} hover:bg-[#fafafa] transition-colors group`}>
          <span className={`${iconBox} bg-tint-blue text-ink-blue`}><MessageSquare className="w-4 h-4" /></span>
          <span className="min-w-0 flex-1">
            <span className={`flex items-center gap-1.5 text-sm truncate ${t.unread ? "font-semibold text-[#0a0a0a]" : "text-[#0a0a0a]"}`}>
              <span className="truncate">{who}</span>
              {t.unread && <span className="w-1.5 h-1.5 rounded-full bg-[#0070f3] shrink-0" />}
            </span>
            <span className="block text-[13px] text-[#666] truncate">{t.lastMessage || (t.hasMedia ? "Picture" : "")}</span>
            <span className="block text-[11px] text-[#999] mt-0.5">Text · {extName(t.user)}</span>
          </span>
          <span className="text-[11px] text-[#999] shrink-0 flex items-center gap-1">
            {clock(item.at)} <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
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
      : `${c.fromName || extName(c.fromExtension)} → ${extName(c.toExtension)}`;
    const detail =
      c.direction === "in"
        ? `${missed ? (c.voicemail ? "Missed, left voicemail" : "Missed") : "Incoming"}${c.toExtension ? ` · ${extName(c.toExtension)}` : ""}`
        : c.direction === "out"
          ? `Outgoing · ${c.fromName || extName(c.fromExtension)}`
          : "Internal";
    const number = c.direction === "in" ? c.fromNumber : c.direction === "out" ? c.toNumber : "";
    const thread = number ? threadFor.get(number.slice(-10)) : undefined;
    return (
      <li className={base}>
        <span className={`${iconBox} ${missed ? "bg-tint-rose text-ink-rose" : "bg-[#f5f5f5] text-[#666]"}`}><Icon className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm truncate ${missed ? "text-[#f31260] font-medium" : "text-[#0a0a0a]"}`}>{who}</span>
          <span className="block text-[11px] text-[#999] mt-0.5">
            {detail}
            {c.talkSec && c.answered ? ` · ${duration(c.talkSec)}` : ""}
            {number && c.direction !== "internal" && person(number) !== formatPhone(number) ? ` · ${formatPhone(number)}` : ""}
          </span>
        </span>
        <span className="text-[11px] text-[#999] shrink-0 flex flex-col items-end gap-1">
          {clock(item.at)}
          <span className="flex items-center gap-2">
            {number && c.direction !== "internal" && (
              <CallLink number={number} name={who} className="text-[#0070f3] hover:underline">Call</CallLink>
            )}
            {thread && <Link href={`/messages?session=${encodeURIComponent(thread)}`} className="text-[#0070f3] hover:underline">Text</Link>}
          </span>
        </span>
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
    <li>
      <button onClick={onToggle} className={`${base} w-full text-left hover:bg-[#fafafa] transition-colors`}>
        <span className={`${iconBox} bg-tint-violet text-ink-violet`}><VoicemailIcon className="w-4 h-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-[#0a0a0a] truncate">{who}</span>
          <span className={`block text-[13px] text-[#666] ${open ? "" : "truncate"}`}>
            {v.transcription || <span className="italic text-[#999]">No transcription</span>}
          </span>
          <span className="block text-[11px] text-[#999] mt-0.5">
            Voicemail · {extName(v.user)}{v.durationSec ? ` · ${duration(v.durationSec)}` : ""}
            {v.fromNumber && person(v.fromNumber) !== formatPhone(v.fromNumber) ? ` · ${formatPhone(v.fromNumber)}` : ""}
          </span>
        </span>
        <span className="text-[11px] text-[#999] shrink-0 flex items-center gap-1">
          {clock(item.at)} <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="pl-15 pr-4 pb-4 -mt-1 space-y-2">
          {/* Streams through our server: RingLogix's own link needs no login. */}
          <audio controls autoPlay preload="none" src={audio} className="w-full max-w-md h-9" />
          <div className="flex items-center gap-3 text-xs">
            <a href={audio} download className="text-[#0070f3] hover:underline">Download</a>
            {v.fromNumber && !v.fromExtension && (
              <CallLink number={v.fromNumber} name={who} className="text-[#0070f3] hover:underline">Call back</CallLink>
            )}
            {thread && <Link href={`/messages?session=${encodeURIComponent(thread)}`} className="text-[#0070f3] hover:underline">Text them</Link>}
          </div>
        </div>
      )}
    </li>
  );
}
