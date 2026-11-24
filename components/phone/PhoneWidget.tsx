"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, Delete, X, RefreshCw, PhoneIncoming } from "lucide-react";
import { usePhoneState, type CallInfo } from "./PhoneProvider";
import { formatPhone } from "@/lib/utils";

/**
 * The phone in the corner: a button that opens a dialpad, an incoming
 * call that opens it by itself, and the controls during a call.
 */

const KEYS: Array<[string, string]> = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

const shown = (number: string) => (number.length >= 10 ? formatPhone(number) || number : number);

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

function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map(([k, letters]) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className="h-12 rounded-xl bg-surface-3 hover:bg-line text-fg flex flex-col items-center justify-center transition-colors active:scale-95"
        >
          <span className="text-lg font-medium leading-none">{k}</span>
          <span className="text-[9px] tracking-widest text-fg-subtle h-2.5 leading-none mt-0.5">{letters}</span>
        </button>
      ))}
    </div>
  );
}

function RoundButton({ onClick, label, active, children, disabled }: { onClick: () => void; label: string; active?: boolean; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-1 disabled:opacity-40">
      <span className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${active ? "bg-fg text-surface" : "bg-surface-3 text-fg hover:bg-line"}`}>
        {children}
      </span>
      <span className="text-[11px] text-fg-muted">{label}</span>
    </button>
  );
}

export default function PhoneWidget() {
  const phone = usePhoneState();
  const [number, setNumber] = useState("");
  const [keypad, setKeypad] = useState(false);
  const clock = useClock(phone?.call ?? null);
  if (!phone || phone.status === "off") return null;

  const { status, call, open, setOpen } = phone;
  const inCall = Boolean(call && call.state !== "ended");
  const ringing = call?.direction === "in" && call.state === "ringing";
  const dot = status === "ready" ? "bg-[#17c964]" : status === "error" ? "bg-[#f31260]" : "bg-[#f5a524]";

  const place = () => { if (number.trim()) phone.dial(number); };
  const stateText = !call ? ""
    : call.state === "ended" ? call.endedReason
    : call.state === "ringing" ? "Incoming call"
    : call.state === "dialing" ? "Calling…"
    : call.state === "early" ? "Ringing…"
    : call.held ? `On hold · ${clock}` : clock;

  return (
    <>
      {/* The corner button. Pulses while a call is ringing. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close phone" : "Open phone"}
        className={`fixed bottom-5 right-5 z-[250] w-13 h-13 rounded-full shadow-lg flex items-center justify-center transition-colors ${
          inCall ? "bg-[#17c964] text-white" : "bg-fg text-surface hover:opacity-90"
        } ${ringing ? "animate-pulse" : ""}`}
      >
        {ringing ? <PhoneIncoming className="w-5.5 h-5.5" /> : <Phone className="w-5 h-5" />}
        <span className={`absolute top-0.5 right-0.5 w-3 h-3 rounded-full border-2 border-surface ${dot}`} />
      </button>

      {open && (
        <div className="fixed z-[250] bottom-22 right-5 left-5 sm:left-auto sm:w-80 bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
              <span className="text-sm font-semibold text-fg">Phone</span>
              <span className="text-xs text-fg-subtle truncate">
                ext {phone.extension} · {status === "ready" ? "Ready" : status === "error" ? "Offline" : "Connecting…"}
              </span>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="p-1 rounded-md text-fg-subtle hover:bg-surface-3" aria-label="Close phone">
              <X className="w-4 h-4" />
            </button>
          </div>

          {status === "error" && !inCall && (
            <div className="mx-4 mt-3 text-xs bg-tint-rose text-ink-rose rounded-lg px-3 py-2 flex items-center justify-between gap-2">
              <span>{phone.error || "The phone is offline."}</span>
              <button type="button" onClick={phone.retry} className="shrink-0 flex items-center gap-1 font-medium">
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}

          {call ? (
            // ── A call: ringing, in progress, or just ended ──
            <div className="px-5 pt-6 pb-5">
              <div className="text-center mb-6">
                <p className="text-lg font-semibold text-fg truncate">{call.name || shown(call.number) || "Unknown"}</p>
                {call.name && <p className="text-sm text-fg-muted">{shown(call.number)}</p>}
                <p className={`text-xs mt-1.5 ${call.state === "ended" ? "text-ink-rose" : "text-fg-subtle"}`}>{stateText}</p>
              </div>

              {ringing ? (
                <div className="flex items-center justify-around">
                  <button type="button" onClick={phone.decline} className="flex flex-col items-center gap-1">
                    <span className="w-14 h-14 rounded-full bg-[#f31260] text-white flex items-center justify-center"><PhoneOff className="w-6 h-6" /></span>
                    <span className="text-[11px] text-fg-muted">Decline</span>
                  </button>
                  <button type="button" onClick={phone.answer} className="flex flex-col items-center gap-1">
                    <span className="w-14 h-14 rounded-full bg-[#17c964] text-white flex items-center justify-center animate-pulse"><Phone className="w-6 h-6" /></span>
                    <span className="text-[11px] text-fg-muted">Answer</span>
                  </button>
                </div>
              ) : call.state !== "ended" ? (
                <>
                  {keypad && call.state === "active" &&call.state === "active" ? (
                    <div className="mb-4">
                      <Keypad onKey={phone.sendTone} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-around mb-6">
                      <RoundButton onClick={phone.toggleMute} label={call.muted ? "Unmute" : "Mute"} active={call.muted}>
                        {call.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      </RoundButton>
                      <RoundButton onClick={() => setKeypad(true)} label="Keypad" disabled={call.state !== "active"}>
                        <Grid3x3 className="w-5 h-5" />
                      </RoundButton>
                      <RoundButton onClick={phone.toggleHold} label={call.held ? "Resume" : "Hold"} active={call.held} disabled={call.state !== "active"}>
                        {call.held ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                      </RoundButton>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-6">
                    {keypad && call.state === "active" &&(
                      <button type="button" onClick={() => setKeypad(false)} className="text-xs text-fg-muted w-14">Hide</button>
                    )}
                    <button type="button" onClick={phone.hangup} className="w-14 h-14 rounded-full bg-[#f31260] text-white flex items-center justify-center" aria-label="Hang up">
                      <PhoneOff className="w-6 h-6" />
                    </button>
                    {keypad && call.state === "active" &&<span className="w-14" />}
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            // ── The dialpad ──
            <div className="px-5 pt-4 pb-5">
              <div className="flex items-center gap-1 mb-4">
                <input
                  value={number}
                  onChange={(e) => setNumber(e.target.value.replace(/[^\d*#+()\-.\s]/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") place(); }}
                  placeholder="Number or extension"
                  inputMode="tel"
                  autoFocus
                  className="flex-1 min-w-0 bg-transparent text-xl text-center text-fg placeholder:text-fg-subtle placeholder:text-sm outline-none"
                />
                {number && (
                  <button type="button" onClick={() => setNumber((n) => n.slice(0, -1))} className="p-1.5 rounded-md text-fg-subtle hover:bg-surface-3" aria-label="Delete">
                    <Delete className="w-4.5 h-4.5" />
                  </button>
                )}
              </div>
              <Keypad onKey={(k) => setNumber((n) => n + k)} />
              <button
                type="button"
                onClick={place}
                disabled={!number.trim() || status !== "ready"}
                className="mt-4 w-full h-11 rounded-xl bg-[#17c964] text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <Phone className="w-4 h-4" /> Call
              </button>
              <p className="mt-2 text-[11px] text-center text-fg-subtle">Calls go out as extension {phone.extension}&apos;s caller ID.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
