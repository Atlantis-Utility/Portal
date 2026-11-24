"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UA } from "jssip/lib/UA";
import type { RTCSession } from "jssip/lib/RTCSession";
import { dialable, loadJsSIP } from "@/lib/phone/sip-client";
import { formatPhone } from "@/lib/utils";

/**
 * The portal phone: this browser as a SIP device on the person's own
 * extension (its "<ext>pt" device, see lib/phone.ts), over RingLogix's
 * WebRTC entry point.
 *
 * Mounted once in the dashboard shell, so it stays registered, and a call
 * keeps going, while the person moves between pages. Every tab that's open
 * registers and rings; answering in one stops the others, as with any two
 * devices on an extension.
 */

export type PhoneStatus = "off" | "connecting" | "ready" | "error";

export interface CallInfo {
  direction: "in" | "out";
  /** Digits as dialled, or the caller's number. */
  number: string;
  name: string;
  state: "ringing" | "dialing" | "early" | "active" | "ended";
  startedAt: number | null;
  muted: boolean;
  held: boolean;
  endedReason: string;
}

interface PhoneLogin {
  extension: string | null;
  device?: string;
  domain?: string;
  password?: string;
  servers?: string[];
  displayName?: string;
  setup?: string;
  error?: string;
}

interface PhoneApi {
  status: PhoneStatus;
  extension: string;
  error: string;
  call: CallInfo | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Rings a number from this browser. Opens the phone. */
  dial: (number: string, name?: string) => void;
  answer: () => void;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  sendTone: (tone: string) => void;
  retry: () => void;
}

const PhoneContext = createContext<PhoneApi | null>(null);

/** The phone, or null where there is none (no extension, signed out). */
export function usePhone(): PhoneApi | null {
  const api = useContext(PhoneContext);
  return api && api.status !== "off" ? api : null;
}

/** Everything, "off" included: for the phone's own UI. */
export function usePhoneState(): PhoneApi | null {
  return useContext(PhoneContext);
}

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// Why a call ended, in words. JsSIP's causes are its own constants.
const END_REASONS: Record<string, string> = {
  Busy: "Busy",
  Rejected: "Declined",
  Canceled: "Cancelled",
  "No Answer": "No answer",
  Unavailable: "Unavailable",
  "Not Found": "Number not found",
  "Address Incomplete": "Incomplete number",
  "User Denied Media Access": "Microphone blocked",
  "Connection Error": "Connection lost",
  "Request Timeout": "No answer",
  "SIP Failure Code": "Call failed",
  "Bad Media Description": "Call failed",
  "Missing SDP": "Call failed",
};

/** Tones made in the browser: a ring for incoming, ringback for outgoing. */
function makeTones() {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nodes: OscillatorNode[] = [];

  const burst = (freqs: number[], seconds: number, volume: number) => {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + seconds);
      nodes.push(osc);
    }
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } }
    nodes = [];
  };
  return {
    ring() {
      stop();
      const play = () => { burst([440, 480], 0.4, 0.12); setTimeout(() => burst([440, 480], 0.4, 0.12), 600); };
      play();
      timer = setInterval(play, 3000);
    },
    ringback() {
      stop();
      // The North American ringback: two seconds on, four off.
      const play = () => burst([440, 480], 2, 0.05);
      play();
      timer = setInterval(play, 6000);
    },
    stop,
  };
}

export function PhoneProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [status, setStatus] = useState<PhoneStatus>("off");
  const [extension, setExtension] = useState("");
  const [error, setError] = useState("");
  const [call, setCall] = useState<CallInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const uaRef = useRef<UA | null>(null);
  const sessionRef = useRef<RTCSession | null>(null);
  const domainRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tonesRef = useRef<ReturnType<typeof makeTones> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tones = () => (tonesRef.current ??= makeTones());
  const patchCall = useCallback((patch: Partial<CallInfo>) => setCall((c) => (c ? { ...c, ...patch } : c)), []);

  /** Plays the far end's audio, whenever the connection brings it. */
  const attachAudio = useCallback((pc: RTCPeerConnection) => {
    const play = (stream: MediaStream) => {
      const el = audioRef.current;
      if (!el) return;
      el.srcObject = stream;
      void el.play().catch(() => { /* blocked until the next click; rare once someone has clicked Call/Answer */ });
    };
    pc.addEventListener("track", (e) => play(e.streams[0] ?? new MediaStream([e.track])));
    // Already-present tracks (an answer can beat the listener).
    const existing = pc.getReceivers().map((r) => r.track).filter(Boolean);
    if (existing.length) play(new MediaStream(existing));
  }, []);

  /** Wires up a call's events, incoming or outgoing alike. */
  const track = useCallback((session: RTCSession) => {
    sessionRef.current = session;
    // Don't wait for every ICE candidate: on some networks the last one
    // takes many seconds to give up. One public address is enough.
    session.on("icecandidate", (e: { candidate: RTCIceCandidate; ready: () => void }) => {
      if (e.candidate.type === "srflx" || e.candidate.type === "relay") e.ready();
    });
    session.on("progress", (e: { originator: string; response?: { status_code?: number; body?: string } }) => {
      if (session.direction !== "outgoing") return;
      patchCall({ state: "early" });
      // 180 with no audio of its own: ring locally. 183 brings the
      // network's own ringback (or a recording), so stay quiet.
      if (!e.response?.body) tones().ringback();
      else tones().stop();
    });
    session.on("accepted", () => {
      tones().stop();
      patchCall({ state: "active", startedAt: Date.now() });
    });
    session.on("hold", () => patchCall({ held: true }));
    session.on("unhold", () => patchCall({ held: false }));
    session.on("muted", () => patchCall({ muted: true }));
    session.on("unmuted", () => patchCall({ muted: false }));
    const finish = (e: { cause?: string; originator?: string }) => {
      tones().stop();
      if (sessionRef.current === session) sessionRef.current = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      const reason = e.cause === "Terminated" || e.cause === "Bye" ? "Call ended"
        : e.cause === "Canceled" && session.direction === "incoming" ? "Missed call"
        : END_REASONS[e.cause ?? ""] ?? (e.cause ? String(e.cause) : "Call ended");
      setCall((c) => (c ? { ...c, state: "ended", endedReason: reason } : c));
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setCall((c) => (c?.state === "ended" ? null : c)), 2500);
    };
    session.on("ended", finish);
    session.on("failed", finish);
  }, [patchCall]);

  // Signs this browser in to RingLogix (and out again on the way out).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let ua: UA | null = null;

    (async () => {
      try {
        const res = await fetch("/api/phone/login", { cache: "no-store" });
        const login = (await res.json().catch(() => ({}))) as PhoneLogin;
        if (cancelled) return;
        if (!res.ok) throw new Error(login.error ?? "Couldn't set up the phone");
        if (!login.extension || !login.password || !login.device || !login.domain) {
          setStatus("off");
          return;
        }
        setExtension(login.extension);
        setStatus("connecting");
        domainRef.current = login.domain;

        const JsSIP = await loadJsSIP();
        if (cancelled) return;
        const sockets = (login.servers ?? []).map((url, i) => ({
          socket: new JsSIP.WebSocketInterface(url),
          weight: (login.servers?.length ?? 1) - i,
        }));
        ua = new JsSIP.UA({
          sockets,
          uri: `sip:${login.device}@${login.domain}`,
          authorization_user: login.device,
          password: login.password,
          display_name: login.displayName || login.extension,
          register: true,
          register_expires: 120,
          session_timers: false,
          user_agent: "Atlantis Portal",
        });
        uaRef.current = ua;

        ua.on("registered", () => { setStatus("ready"); setError(""); });
        ua.on("unregistered", () => setStatus((s) => (s === "error" ? s : "connecting")));
        ua.on("disconnected", () => setStatus((s) => (s === "error" ? s : "connecting")));
        ua.on("registrationFailed", (e: { cause?: string; response?: { status_code?: number } }) => {
          setStatus("error");
          setError(
            e.response?.status_code === 403 || e.cause === "Authentication Error"
              ? "RingLogix refused the phone's login. Ask an administrator to check your extension."
              : "Couldn't connect to the phone system. Retrying…",
          );
        });
        ua.on("newRTCSession", (e: { session: RTCSession; originator: string; request: { from?: { display_name?: string; uri?: { user?: string } } } }) => {
          const session = e.session;
          if (e.originator !== "remote") return;
          // One call at a time: a second caller hears busy, and the call
          // still rings the extension's other phones.
          if (sessionRef.current) {
            session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
            return;
          }
          const number = session.remote_identity?.uri?.user ?? e.request.from?.uri?.user ?? "";
          const name = session.remote_identity?.display_name ?? e.request.from?.display_name ?? "";
          track(session);
          session.on("peerconnection", (p: { peerconnection: RTCPeerConnection }) => attachAudio(p.peerconnection));
          setCall({ direction: "in", number, name: name && name !== number ? name : "", state: "ringing", startedAt: null, muted: false, held: false, endedReason: "" });
          setOpen(true);
          tones().ring();
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            const note = new Notification("Incoming call", { body: name || formatPhone(number) || number, tag: "portal-call" });
            note.onclick = () => { window.focus(); note.close(); };
            session.on("ended", () => note.close());
            session.on("failed", () => note.close());
            session.on("accepted", () => note.close());
          }
        });
        ua.start();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Couldn't set up the phone");
      }
    })();

    const leave = () => { try { ua?.stop(); } catch { /* closing anyway */ } };
    window.addEventListener("pagehide", leave);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", leave);
      tonesRef.current?.stop();
      try { sessionRef.current?.terminate(); } catch { /* already over */ }
      leave();
      uaRef.current = null;
    };
  }, [enabled, attempt, track, attachAudio]);

  // Leaving the page mid-call drops it; ask first.
  useEffect(() => {
    if (!call || call.state === "ended") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [call]);

  const dial = useCallback((raw: string, name = "") => {
    setOpen(true);
    const ua = uaRef.current;
    const number = dialable(raw);
    if (!ua || !number || sessionRef.current) return;
    if (status !== "ready") return;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    // Asked here, on a click, where browsers allow it: it's what lets an
    // incoming call announce itself while the portal is in another tab.
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    setCall({ direction: "out", number, name, state: "dialing", startedAt: null, muted: false, held: false, endedReason: "" });
    try {
      const session = ua.call(`sip:${number}@${domainRef.current}`, {
        mediaConstraints: { audio: true, video: false },
        pcConfig: { iceServers: ICE_SERVERS },
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });
      track(session);
      attachAudio(session.connection as unknown as RTCPeerConnection);
    } catch (err) {
      setCall((c) => (c ? { ...c, state: "ended", endedReason: err instanceof Error ? err.message : "Call failed" } : c));
    }
  }, [status, track, attachAudio]);

  const api = useMemo<PhoneApi>(() => ({
    // Derived rather than reset in an effect: signed out means off.
    status: enabled ? status : "off",
    extension, error, call, open, setOpen, dial,
    answer: () => {
      const s = sessionRef.current;
      if (!s || s.direction !== "incoming") return;
      tones().stop();
      s.answer({ mediaConstraints: { audio: true, video: false }, pcConfig: { iceServers: ICE_SERVERS } });
    },
    decline: () => {
      tones().stop();
      try { sessionRef.current?.terminate({ status_code: 486, reason_phrase: "Busy Here" }); } catch { /* gone */ }
    },
    hangup: () => {
      tones().stop();
      try { sessionRef.current?.terminate(); } catch { /* gone */ }
    },
    toggleMute: () => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.isMuted().audio) s.unmute({ audio: true }); else s.mute({ audio: true });
    },
    toggleHold: () => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.isOnHold().local) s.unhold(); else s.hold();
    },
    sendTone: (tone: string) => {
      try { sessionRef.current?.sendDTMF(tone, { transportType: "RFC2833" } as never); } catch { /* not in a call */ }
    },
    retry: () => { setError(""); setAttempt((a) => a + 1); },
  }), [enabled, status, extension, error, call, open, dial]);

  return (
    <PhoneContext.Provider value={api}>
      {children}
      <audio ref={audioRef} autoPlay hidden />
    </PhoneContext.Provider>
  );
}
