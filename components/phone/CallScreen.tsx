"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, UserPlus, PhoneForwarded, ArrowLeft, Search, Merge, X, SquareParking, RefreshCw,
} from "lucide-react";
import type { CallInfo, PhoneApi } from "./PhoneProvider";
import { colourFor, initialsFor } from "@/components/messages/Avatar";
import { formatPhone } from "@/lib/utils";
import type { DirectoryEntry } from "@/lib/phone/types";

/**
 * The phone while a call is on: answering, the controls, and the second
 * line - asking someone before transferring (warm), sending the call on
 * without asking (blind), adding them to the call, and the conference.
 */

const shown = (number: string) => (number.length >= 10 ? formatPhone(number) || number : number);
const label = (c: CallInfo) => c.name || shown(c.number) || "Unknown caller";

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

function stateOf(c: CallInfo, clock: string): string {
  return c.state === "ended" ? c.endedReason
    : c.state === "ringing" ? "Incoming call"
    : c.state === "dialing" ? "Calling…"
    : c.state === "early" ? "Ringing…"
    : c.held ? `On hold · ${clock}` : clock || "0:00";
}

function Avatar({ name, size = "lg" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "w-20 h-20 text-2xl" : size === "md" ? "w-14 h-14 text-lg" : "w-9 h-9 text-xs";
  return <span className={`${cls} rounded-full flex items-center justify-center font-semibold shrink-0 ${colourFor(name)}`}>{initialsFor(name)}</span>;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const LETTERS: Record<string, string> = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ", 0: "+" };

function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-x-5 gap-y-2 px-4">
      {KEYS.map((k) => (
        <button key={k} type="button" onClick={() => onKey(k)} className="h-12 rounded-full bg-surface-3 hover:bg-line text-fg flex flex-col items-center justify-center active:scale-95">
          <span className="text-[22px] leading-none tabular-nums">{k}</span>
          <span className="text-[8.5px] font-semibold tracking-[0.18em] text-fg-subtle h-2.5 leading-none mt-1">{LETTERS[k] ?? ""}</span>
        </button>
      ))}
    </div>
  );
}

function Control({ onClick, label: text, active, children, disabled }: { onClick: () => void; label: string; active?: boolean; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-1.5 disabled:opacity-35 group">
      <span className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${active ? "bg-fg text-surface" : "bg-surface-3 text-fg group-hover:bg-line"}`}>{children}</span>
      <span className="text-[11px] font-medium text-fg-muted">{text}</span>
    </button>
  );
}

function RedButton({ onClick, label: text }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={text} className="w-16 h-16 rounded-full bg-[#f31260] hover:bg-[#d10f52] text-white flex items-center justify-center shadow-lg transition-colors">
      <PhoneOff className="w-7 h-7" />
    </button>
  );
}

/** Who to transfer to / add: search the directory or type a number. */
function Picker({ title, directory, onPick, onBack }: { title: string; directory: DirectoryEntry[] | null; onPick: (number: string, name: string) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const digits = q.replace(/\D/g, "");
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = directory ?? [];
    const hits = t
      ? list.filter((e) => e.name.toLowerCase().includes(t) || e.detail.toLowerCase().includes(t) || (digits.length >= 2 && e.numbers.some((n) => n.number.includes(digits))))
      // Colleagues first when nothing is typed: transfers mostly go inside.
      : [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "colleague" ? -1 : 1));
    return hits.slice(0, 40);
  }, [directory, q, digits]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <button type="button" onClick={onBack} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
      </div>
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && digits.length >= 3) onPick(digits, ""); }}
            placeholder="Name, extension or number"
            autoFocus
            className="w-full text-sm bg-surface-3 rounded-lg pl-8.5 pr-3 py-2 text-fg placeholder:text-fg-subtle outline-none focus:ring-2 focus:ring-line"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-2">
        {digits.length >= 3 && (
          <button type="button" onClick={() => onPick(digits, "")} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-3">
            <span className="w-9 h-9 rounded-full bg-tint-green text-ink-green flex items-center justify-center"><Phone className="w-4 h-4" /></span>
            <span className="text-sm text-fg">Use <span className="font-semibold tabular-nums">{shown(digits)}</span></span>
          </button>
        )}
        {matches.flatMap((e) => e.numbers.map((n) => (
          <button key={e.id + n.number} type="button" onClick={() => onPick(n.number, e.name)} className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-surface-3">
            <Avatar name={e.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg truncate">{e.name}</span>
              <span className="block text-[12px] text-fg-subtle truncate">{n.label} {shown(n.number)}</span>
            </span>
          </button>
        )))}
        {!directory && <p className="px-4 py-6 text-center text-xs text-fg-subtle">Loading contacts…</p>}
      </div>
    </div>
  );
}

export default function CallScreen({ phone }: { phone: PhoneApi }) {
  const { call, second, conference } = phone;
  const [mode, setMode] = useState<"controls" | "keypad" | "transfer" | "add" | "park">("controls");
  const [target, setTarget] = useState<{ number: string; name: string } | null>(null);
  const clock = useClock(call);
  const clock2 = useClock(second);
  if (!call) return null;

  const ringing = call.direction === "in" && call.state === "ringing";
  const live = call.state === "active";
  const secondLive = second?.state === "active";
  const notice = phone.notice ? (
    <p className="mx-4 mt-3 text-xs text-center rounded-lg px-3 py-1.5 bg-surface-3 text-fg-muted">{phone.notice}</p>
  ) : null;

  // ── Choosing a park spot ──
  if (mode === "park") {
    const spots = phone.parks;
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 pt-3 pb-1 flex items-center gap-2">
          <button type="button" onClick={() => setMode("controls")} className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
          <h2 className="text-[15px] font-semibold text-fg">Park {label(call)}</h2>
        </div>
        <p className="px-5 pb-3 text-[12px] text-fg-subtle">Anyone can pick the call up by dialing the spot from any phone. If nobody does, it rings you back.</p>
        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          {!spots ? (
            <p className="py-8 text-center text-xs text-fg-subtle flex items-center justify-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Checking the park spots…</p>
          ) : spots.length === 0 ? (
            <p className="py-8 text-center text-xs text-fg-subtle">No park spots are set up on the phone system.</p>
          ) : spots.map((sp) => (
            <button
              key={sp.spot}
              type="button"
              disabled={Boolean(sp.parked)}
              onClick={() => { phone.park(sp.spot); setMode("controls"); }}
              className="w-full flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left hover:border-line-strong disabled:opacity-60 disabled:hover:border-line"
            >
              <span className={`w-11 h-11 rounded-lg flex items-center justify-center text-sm font-semibold tabular-nums ${sp.parked ? "bg-tint-amber text-ink-amber" : "bg-tint-green text-ink-green"}`}>{sp.spot}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{sp.label}</span>
                <span className="block text-[12px] text-fg-subtle truncate">{sp.parked ? `In use${sp.parked.name || sp.parked.number ? ` · ${sp.parked.name || shown(sp.parked.number)}` : ""}` : "Free"}</span>
              </span>
              {!sp.parked && <span className="text-xs font-semibold text-[#0070f3]">Park here</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Choosing who to transfer to / add ──
  if (mode === "transfer" || mode === "add") {
    if (mode === "transfer" && target) {
      return (
        <div className="flex-1 flex flex-col px-6 pt-8 pb-8">
          <button type="button" onClick={() => setTarget(null)} className="self-start -ml-2 mb-4 w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3" aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
          <div className="flex flex-col items-center text-center">
            <Avatar name={target.name || target.number} size="md" />
            <p className="mt-3 text-base font-semibold text-fg">Transfer {label(call)} to {target.name || shown(target.number)}</p>
            {target.name && <p className="text-sm text-fg-muted tabular-nums">{shown(target.number)}</p>}
          </div>
          <div className="flex-1" />
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => { phone.consult(target.number, target.name); setTarget(null); setMode("controls"); }}
              className="w-full rounded-xl bg-fg text-surface py-3 text-sm font-semibold hover:opacity-90"
            >
              Talk to them first
            </button>
            <p className="text-[11px] text-center text-fg-subtle -mt-0.5 mb-2">{label(call)} waits on hold while you explain, then you complete the transfer.</p>
            <button
              type="button"
              onClick={() => { phone.transfer(target.number); setTarget(null); setMode("controls"); }}
              className="w-full rounded-xl border border-line bg-surface py-3 text-sm font-semibold text-fg hover:bg-surface-3"
            >
              Transfer now
            </button>
            <p className="text-[11px] text-center text-fg-subtle">The call goes straight to them and you drop off.</p>
          </div>
        </div>
      );
    }
    return (
      <Picker
        title={mode === "transfer" ? `Transfer ${label(call)}` : "Add a call"}
        directory={phone.directory}
        onBack={() => setMode("controls")}
        onPick={(number, name) => {
          if (mode === "add") { phone.consult(number, name); setMode("controls"); }
          else setTarget({ number, name });
        }}
      />
    );
  }

  // ── Conference ──
  if (conference && second) {
    return (
      <div className="flex-1 flex flex-col pb-8">
        {notice}
        <div className="px-6 pt-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-green">Conference</p>
          <p className="text-2xl font-semibold text-fg tabular-nums mt-1">{clock || "0:00"}</p>
        </div>
        <ul className="mt-5 mx-4 rounded-2xl border border-line divide-y divide-line">
          {[{ c: call, end: phone.endMain }, { c: second, end: phone.endSecond }].map(({ c, end }, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={c.name || c.number} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg truncate">{label(c)}</span>
                {c.name && <span className="block text-[12px] text-fg-subtle tabular-nums">{shown(c.number)}</span>}
              </span>
              <button type="button" onClick={end} className="w-8 h-8 rounded-full flex items-center justify-center text-fg-subtle hover:bg-tint-rose hover:text-ink-rose" aria-label={`Remove ${label(c)}`} title={`Remove ${label(c)}`}>
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex-1" />
        {mode === "keypad" ? (
          <div className="mb-5"><Keypad onKey={phone.sendTone} /></div>
        ) : (
          <div className="grid grid-cols-2 gap-3 px-16 mb-8">
            <Control onClick={phone.toggleMute} label={call.muted ? "Unmute" : "Mute"} active={call.muted}>
              {call.muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </Control>
            <Control onClick={() => setMode("keypad")} label="Keypad"><Grid3x3 className="w-6 h-6" /></Control>
          </div>
        )}
        <div className="grid grid-cols-3 items-center">
          <span className="flex justify-center">{mode === "keypad" && <button type="button" onClick={() => setMode("controls")} className="text-xs font-medium text-fg-muted hover:text-fg">Hide</button>}</span>
          <span className="flex justify-center"><RedButton onClick={phone.hangup} label="End the conference" /></span>
          <span />
        </div>
      </div>
    );
  }

  // ── Second call, the first on hold ──
  if (second) {
    return (
      <div className="flex-1 flex flex-col pb-8">
        {notice}
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl bg-tint-amber px-3 py-2">
          <Pause className="w-4 h-4 text-ink-amber shrink-0" />
          <span className="min-w-0 flex-1 text-[13px] text-ink-amber truncate"><span className="font-semibold">{label(call)}</span> on hold</span>
          <span className="text-[12px] text-ink-amber tabular-nums">{clock}</span>
        </div>
        <div className="flex flex-col items-center text-center px-6 pt-8">
          <Avatar name={second.name || second.number} size="lg" />
          <p className="mt-4 text-xl font-semibold text-fg truncate max-w-full">{label(second)}</p>
          {second.name && <p className="text-sm text-fg-muted tabular-nums mt-0.5">{shown(second.number)}</p>}
          <p className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            second.state === "ended" ? "bg-tint-rose text-ink-rose" : secondLive ? "bg-tint-green text-ink-green" : "bg-surface-3 text-fg-muted"
          }`}>
            <span className="tabular-nums">{stateOf(second, clock2)}</span>
          </p>
        </div>
        <div className="flex-1" />
        {mode === "keypad" ? (
          <div className="mb-5"><Keypad onKey={phone.sendTone} /></div>
        ) : (
          <div className="grid grid-cols-3 gap-3 px-6 mb-8">
            <Control onClick={phone.merge} label="Merge" disabled={!secondLive}><Merge className="w-6 h-6" /></Control>
            <Control onClick={phone.completeTransfer} label="Transfer" disabled={!secondLive}><PhoneForwarded className="w-6 h-6" /></Control>
            <Control onClick={phone.toggleMute} label={second.muted ? "Unmute" : "Mute"} active={second.muted}>
              {second.muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </Control>
          </div>
        )}
        <div className="grid grid-cols-3 items-center">
          <span className="flex justify-center">
            {mode === "keypad"
              ? <button type="button" onClick={() => setMode("controls")} className="text-xs font-medium text-fg-muted hover:text-fg">Hide</button>
              : <button type="button" onClick={() => setMode("keypad")} disabled={!secondLive} className="text-xs font-medium text-fg-muted hover:text-fg disabled:opacity-35">Keypad</button>}
          </span>
          <span className="flex justify-center"><RedButton onClick={phone.endSecond} label={`End call with ${label(second)}`} /></span>
          <span className="flex justify-center"><button type="button" onClick={phone.hangup} className="text-[11px] font-medium text-ink-rose hover:underline">End both</button></span>
        </div>
        <p className="mt-3 text-[11px] text-center text-fg-subtle">Ending this call takes you back to {label(call)}.</p>
      </div>
    );
  }

  // ── One call ──
  return (
    <div className="flex-1 flex flex-col pb-8">
      {notice}
      <div className="flex flex-col items-center text-center px-6 pt-10">
        <div className={`rounded-full p-1.5 ${ringing ? "ring-4 ring-[#17c964]/25 animate-pulse" : ""}`}>
          <Avatar name={call.name || call.number} />
        </div>
        <p className="mt-4 text-xl font-semibold text-fg truncate max-w-full">{label(call)}</p>
        {call.name && <p className="text-sm text-fg-muted tabular-nums mt-0.5">{shown(call.number)}</p>}
        <p className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
          call.state === "ended" ? "bg-tint-rose text-ink-rose"
            : live ? (call.held ? "bg-tint-amber text-ink-amber" : "bg-tint-green text-ink-green")
            : "bg-surface-3 text-fg-muted"
        }`}>
          {live && !call.held && <span className="w-1.5 h-1.5 rounded-full bg-[#17c964] animate-pulse" />}
          <span className="tabular-nums">{stateOf(call, clock)}</span>
        </p>
      </div>

      <div className="flex-1" />

      {ringing ? (
        <div className="flex items-center justify-center gap-16">
          <button type="button" onClick={phone.decline} className="flex flex-col items-center gap-2">
            <span className="w-16 h-16 rounded-full bg-[#f31260] hover:bg-[#d10f52] text-white flex items-center justify-center shadow-lg transition-colors"><PhoneOff className="w-7 h-7" /></span>
            <span className="text-xs font-medium text-fg-muted">Decline</span>
          </button>
          <button type="button" onClick={phone.answer} className="flex flex-col items-center gap-2">
            <span className="w-16 h-16 rounded-full bg-[#17c964] hover:bg-[#12a150] text-white flex items-center justify-center shadow-lg transition-colors"><Phone className="w-7 h-7" /></span>
            <span className="text-xs font-medium text-fg-muted">Answer</span>
          </button>
        </div>
      ) : call.state !== "ended" ? (
        <>
          {mode === "keypad" && live ? (
            <div className="mb-5"><Keypad onKey={phone.sendTone} /></div>
          ) : (
            <div className="grid grid-cols-3 gap-y-5 gap-x-3 px-6 mb-8">
              <Control onClick={phone.toggleMute} label={call.muted ? "Unmute" : "Mute"} active={call.muted}>
                {call.muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </Control>
              <Control onClick={() => setMode("keypad")} label="Keypad" disabled={!live}><Grid3x3 className="w-6 h-6" /></Control>
              <Control onClick={phone.toggleHold} label={call.held ? "Resume" : "Hold"} active={call.held} disabled={!live}>
                {call.held ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
              </Control>
              <Control onClick={() => { phone.loadDirectory(); setMode("add"); }} label="Add call" disabled={!live}><UserPlus className="w-6 h-6" /></Control>
              <Control onClick={() => { phone.loadDirectory(); setMode("transfer"); }} label="Transfer" disabled={!live}><PhoneForwarded className="w-6 h-6" /></Control>
              <Control onClick={() => { phone.loadParks(); setMode("park"); }} label="Park" disabled={!live}><SquareParking className="w-6 h-6" /></Control>
            </div>
          )}
          <div className="grid grid-cols-3 items-center">
            <span className="flex justify-center">{mode === "keypad" && live && <button type="button" onClick={() => setMode("controls")} className="text-xs font-medium text-fg-muted hover:text-fg">Hide</button>}</span>
            <span className="flex justify-center"><RedButton onClick={() => { setMode("controls"); phone.hangup(); }} label="Hang up" /></span>
            <span />
          </div>
        </>
      ) : null}
    </div>
  );
}
