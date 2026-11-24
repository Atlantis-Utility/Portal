"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UA } from "jssip/lib/UA";
import type { RTCSession } from "jssip/lib/RTCSession";
import { dialable, loadJsSIP } from "@/lib/phone/sip-client";
import { whoHas, type DirectoryEntry, type Recents } from "@/lib/phone/types";
import { formatPhone } from "@/lib/utils";
import type { ParkSpot } from "@/lib/phone";

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

export interface PhoneApi {
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
  /** A second call, while the first waits on hold (consult / add call). */
  second: CallInfo | null;
  /** Both calls joined, this browser mixing the audio. */
  conference: boolean;
  /** "Transferring…", "Transfer failed", and the like. */
  notice: string;
  /** Hands the call to someone else and drops out (blind transfer). */
  transfer: (number: string) => void;
  /** Puts the call on hold and rings someone else (warm transfer / add call). */
  consult: (number: string, name?: string) => void;
  /** Connects the held caller to the second call and drops out. */
  completeTransfer: () => void;
  /** Joins the held caller and the second call into one conversation. */
  merge: () => void;
  /** Ends the second call (or removes them from a conference). */
  endSecond: () => void;
  /** Ends the first call only; the second carries on as the main call. */
  endMain: () => void;
  /** Park spots and who is in them; null until first asked for. */
  parks: ParkSpot[] | null;
  loadParks: () => void;
  /** Parks the call on a spot (a transfer to it); anyone can pick it up by dialing it. */
  park: (spot: string) => void;
  /** Contacts and colleagues to call; null until first asked for. */
  directory: DirectoryEntry[] | null;
  loadDirectory: (refresh?: boolean) => void;
  /** Your extension's calls and voicemail; null until first asked for. */
  recents: Recents | null;
  loadRecents: () => void;
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

type Line = "main" | "second";

export function PhoneProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [status, setStatus] = useState<PhoneStatus>("off");
  const [extension, setExtension] = useState("");
  const [error, setError] = useState("");
  const [call, setCall] = useState<CallInfo | null>(null);
  const [second, setSecond] = useState<CallInfo | null>(null);
  const [conference, setConference] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null);
  const directoryRef = useRef<Promise<DirectoryEntry[]> | null>(null);
  const [recents, setRecents] = useState<Recents | null>(null);
  const [parks, setParks] = useState<ParkSpot[] | null>(null);
  const recentsBusy = useRef(false);
  const recentsWanted = useRef(false);

  const loadRecents = useCallback(() => {
    recentsWanted.current = true;
    if (recentsBusy.current) return;
    recentsBusy.current = true;
    fetch("/api/phone/recents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Recents | null) => { if (b) setRecents({ ...b, loadedAt: Date.now() }); })
      .catch(() => { /* keeps what it had */ })
      .finally(() => { recentsBusy.current = false; });
  }, []);

  const loadParks = useCallback(() => {
    fetch("/api/phone/parks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { spots?: ParkSpot[] } | null) => { if (b?.spots) setParks(b.spots); })
      .catch(() => { /* keeps what it had */ });
  }, []);

  /** Fetched once, when first needed: it reads every contact book. */
  const loadDirectory = useCallback((refresh = false): Promise<DirectoryEntry[]> => {
    if (directoryRef.current && !refresh) return directoryRef.current;
    directoryRef.current = fetch("/api/phone/directory", { cache: refresh ? "no-store" : "default" })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((b: { entries?: DirectoryEntry[] }) => {
        const list = b.entries ?? [];
        setDirectory(list);
        return list;
      })
      .catch(() => {
        directoryRef.current = null;
        return [];
      });
    return directoryRef.current;
  }, []);

  const uaRef = useRef<UA | null>(null);
  // Up to two calls: the main one, and a second while the main one waits on
  // hold (asking someone before transferring, or adding them to the call).
  const sessions = useRef<Record<Line, RTCSession | null>>({ main: null, second: null });
  // What each line shows, kept in a ref too so an event can read the other
  // line's current state (e.g. promoting the second call when the first ends).
  const infos = useRef<Record<Line, CallInfo | null>>({ main: null, second: null });
  const audios = useRef(new Map<RTCSession, HTMLAudioElement>());
  const transferred = useRef(new WeakSet<RTCSession>());
  // What the ended call says: "Transferred", or "Parked on 711".
  const referLabels = useRef(new WeakMap<RTCSession, string>());
  const conf = useRef<{ mics: MediaStreamTrack[]; restore: () => void } | null>(null);
  const domainRef = useRef("");
  const tonesRef = useRef<ReturnType<typeof makeTones> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tones = () => (tonesRef.current ??= makeTones());

  const update = useCallback((line: Line, next: CallInfo | null | ((c: CallInfo | null) => CallInfo | null)) => {
    const value = typeof next === "function" ? next(infos.current[line]) : next;
    infos.current[line] = value;
    (line === "main" ? setCall : setSecond)(value);
  }, []);
  const lineOf = (session: RTCSession): Line | null =>
    sessions.current.main === session ? "main" : sessions.current.second === session ? "second" : null;
  const patch = useCallback((session: RTCSession, p: Partial<CallInfo>) => {
    const line = sessions.current.main === session ? "main" : sessions.current.second === session ? "second" : null;
    if (line) update(line, (c) => (c ? { ...c, ...p } : c));
  }, [update]);

  const say = useCallback((text: string, clearAfter = 4000) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (clearAfter) noticeTimer.current = setTimeout(() => setNotice(""), clearAfter);
  }, []);

  /** Plays a call's far end on its own element, whenever the audio arrives. */
  const attachAudio = useCallback((session: RTCSession, pc: RTCPeerConnection) => {
    let el = audios.current.get(session);
    if (!el) {
      el = new Audio();
      el.autoplay = true;
      audios.current.set(session, el);
    }
    const play = (stream: MediaStream) => {
      el!.srcObject = stream;
      void el!.play().catch(() => { /* blocked until the next click; rare once someone has clicked Call/Answer */ });
    };
    pc.addEventListener("track", (e) => play(e.streams[0] ?? new MediaStream([e.track])));
    // Already-present tracks (an answer can beat the listener).
    const existing = pc.getReceivers().map((r) => r.track).filter(Boolean);
    if (existing.length) play(new MediaStream(existing));
  }, []);

  /** Back to two separate calls: each sends its own microphone again. */
  const endConference = useCallback(() => {
    if (!conf.current) return;
    try { conf.current.restore(); } catch { /* the call that needed it is gone */ }
    conf.current = null;
    setConference(false);
  }, []);

  /** Wires up a call's events, incoming or outgoing, on either line. */
  const track = useCallback((session: RTCSession) => {
    // Don't wait for every ICE candidate: on some networks the last one
    // takes many seconds to give up. One public address is enough.
    session.on("icecandidate", (e: { candidate: RTCIceCandidate; ready: () => void }) => {
      if (e.candidate.type === "srflx" || e.candidate.type === "relay") e.ready();
    });
    session.on("progress", (e: { originator: string; response?: { status_code?: number; body?: string } }) => {
      if (session.direction !== "outgoing") return;
      patch(session, { state: "early" });
      // 180 with no audio of its own: ring locally. 183 brings the
      // network's own ringback (or a recording), so stay quiet.
      if (!e.response?.body) tones().ringback();
      else tones().stop();
    });
    session.on("accepted", () => {
      tones().stop();
      patch(session, { state: "active", startedAt: Date.now() });
    });
    session.on("hold", () => patch(session, { held: true }));
    session.on("unhold", () => patch(session, { held: false }));
    session.on("muted", () => patch(session, { muted: true }));
    session.on("unmuted", () => patch(session, { muted: false }));
    const finish = (e: { cause?: string; originator?: string }) => {
      tones().stop();
      const line = lineOf(session);
      const el = audios.current.get(session);
      if (el) el.srcObject = null;
      audios.current.delete(session);
      endConference();
      const reason = transferred.current.has(session) ? referLabels.current.get(session) ?? "Transferred"
        : e.cause === "Terminated" || e.cause === "Bye" ? "Call ended"
        : e.cause === "Canceled" && session.direction === "incoming" ? "Missed call"
        : END_REASONS[e.cause ?? ""] ?? (e.cause ? String(e.cause) : "Call ended");

      if (line === "second") {
        sessions.current.second = null;
        update("second", null);
        // Back to whoever was waiting.
        const main = sessions.current.main;
        if (main && main.isOnHold().local && !transferred.current.has(main)) main.unhold();
        if (!transferred.current.has(session)) say(`${reason}${infos.current.main ? `. Back to ${infos.current.main.name || infos.current.main.number}` : ""}`);
      } else if (line === "main") {
        const next = sessions.current.second;
        if (next && !transferred.current.has(next)) {
          // The first caller left while someone else was on the line: carry
          // on with them.
          sessions.current.main = next;
          sessions.current.second = null;
          update("main", infos.current.second);
          update("second", null);
          if (next.isOnHold().local) next.unhold();
          say(`${infos.current.main?.name || "The other caller"} is still with you`);
        } else {
          sessions.current.main = null;
          update("main", (c) => (c ? { ...c, state: "ended", endedReason: reason } : c));
          if (clearTimer.current) clearTimeout(clearTimer.current);
          clearTimer.current = setTimeout(() => update("main", (c) => (c?.state === "ended" ? null : c)), 2500);
        }
      }
      // The call record reaches RingLogix's history a few seconds after.
      if (recentsWanted.current) setTimeout(loadRecents, 5000);
    };
    session.on("ended", finish);
    session.on("failed", finish);
  }, [patch, update, say, endConference, loadRecents]);

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

        let first = true;
        ua.on("registered", () => {
          setStatus("ready");
          setError("");
          // Once, for the missed-call badge on the corner button.
          if (first) { first = false; loadRecents(); }
        });
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
          // Busy while on a call: the caller still rings the extension's
          // other phones.
          if (sessions.current.main || sessions.current.second) {
            session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
            return;
          }
          const number = session.remote_identity?.uri?.user ?? e.request.from?.uri?.user ?? "";
          const name = session.remote_identity?.display_name ?? e.request.from?.display_name ?? "";
          sessions.current.main = session;
          track(session);
          session.on("peerconnection", (p: { peerconnection: RTCPeerConnection }) => attachAudio(session, p.peerconnection));
          update("main", { direction: "in", number, name: name && name !== number ? name : "", state: "ringing", startedAt: null, muted: false, held: false, endedReason: "" });
          setOpen(true);
          tones().ring();
          // A saved contact's name, when the caller ID didn't carry one.
          void loadDirectory().then((list) => {
            const who = whoHas(list, number);
            if (who) update("main", (c) => (c && c.number === number && !c.name ? { ...c, name: who.name } : c));
          });
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
    const live = sessions.current;
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", leave);
      tonesRef.current?.stop();
      for (const s of [live.second, live.main]) { try { s?.terminate(); } catch { /* already over */ } }
      leave();
      uaRef.current = null;
    };
  }, [enabled, attempt, track, attachAudio, loadDirectory, loadRecents, update]);

  // No phone yet (no extension when the page loaded, or it couldn't
  // connect): look again when the person comes back to the tab, so an
  // extension set in the meantime - or a blip - doesn't leave the phone
  // hidden until a reload.
  useEffect(() => {
    if (!enabled || (status !== "off" && status !== "error")) return;
    const recheck = () => { if (document.visibilityState === "visible") setAttempt((a) => a + 1); };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [enabled, status]);

  // Leaving the page mid-call drops it; ask first.
  useEffect(() => {
    if ((!call || call.state === "ended") && !second) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [call, second]);

  /** Places a call on a line. */
  const place = useCallback((line: Line, raw: string, name: string) => {
    const ua = uaRef.current;
    const number = dialable(raw);
    if (!ua || !number || sessions.current[line]) return false;
    const known = name || (directory ? whoHas(directory, number)?.name ?? "" : "");
    update(line, { direction: "out", number, name: known, state: "dialing", startedAt: null, muted: false, held: false, endedReason: "" });
    try {
      const session = ua.call(`sip:${number}@${domainRef.current}`, {
        mediaConstraints: { audio: true, video: false },
        pcConfig: { iceServers: ICE_SERVERS },
        rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      });
      sessions.current[line] = session;
      track(session);
      attachAudio(session, session.connection as unknown as RTCPeerConnection);
      return true;
    } catch (err) {
      update(line, (c) => (c ? { ...c, state: "ended", endedReason: err instanceof Error ? err.message : "Call failed" } : c));
      if (line === "second") setTimeout(() => update("second", null), 2500);
      return false;
    }
  }, [directory, track, attachAudio, update]);

  const dial = useCallback((raw: string, name = "") => {
    setOpen(true);
    if (status !== "ready" || sessions.current.main) return;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    // Asked here, on a click, where browsers allow it: it's what lets an
    // incoming call announce itself while the portal is in another tab.
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    place("main", raw, name);
  }, [status, place]);

  /**
   * A REFER, and the hang-up that follows it. RingLogix reports the
   * transfer's progress with NOTIFYs; once the far side has it (or after a
   * few seconds of silence, which some carriers leave us in) we drop out.
   */
  const refer = useCallback((from: RTCSession, target: string, opts: { replaces?: RTCSession; alsoEnd?: RTCSession; label?: string } = {}) => {
    say(opts.label ? "Parking…" : "Transferring…", 0);
    referLabels.current.set(from, opts.label ?? "Transferred");
    let done = false;
    const drop = () => {
      if (done) return;
      done = true;
      transferred.current.add(from);
      if (opts.alsoEnd) transferred.current.add(opts.alsoEnd);
      say(opts.label ?? "Transferred");
      for (const s of [opts.alsoEnd, from]) { try { s?.terminate(); } catch { /* already gone */ } }
    };
    const fail = (why: string) => {
      if (done) return;
      done = true;
      say(why);
      // Nothing happened: the caller is still on hold with us.
      if (!opts.replaces && from.isOnHold().local) from.unhold();
    };
    try {
      from.refer(target, {
        ...(opts.replaces ? { replaces: opts.replaces } : {}),
        eventHandlers: {
          requestSucceeded: () => {
            // Accepted (202): RingLogix starts hanging our legs up straight
            // away, often before its NOTIFY - mark them now, or the first
            // leg's BYE reads as "the caller left" and the second call is
            // promoted in its place (seen in the live test, 2026-11-24).
            transferred.current.add(from);
            if (opts.alsoEnd) transferred.current.add(opts.alsoEnd);
            setTimeout(drop, 6000);
          },
          requestFailed: (e: { cause?: string; response?: { status_code?: number; getHeader?: (name: string) => string | undefined } }) => {
            // RingLogix says why in a Warning header, e.g. 399 "Failed to
            // find Target Session." (seen transferring a call to the auto
            // attendant, 2026-11-24).
            const why = /"([^"]+)"/.exec(e.response?.getHeader?.("Warning") ?? "")?.[1]?.replace(/\.$/, "");
            console.warn("[phone] REFER refused", e.response?.status_code, why ?? e.cause);
            fail(
              /target session/i.test(why ?? "")
                // No caller on the far side to move: a call with the auto
                // attendant or another system service.
                ? `This call can't be ${opts.label ? "parked" : "transferred"}: it isn't with a person`
                : `Couldn't ${opts.label ? "park" : "transfer"}: ${why ?? `RingLogix answered ${e.response?.status_code ?? e.cause ?? "nothing"}`}`,
            );
          },
          accepted: drop,
          failed: () => fail("The transfer didn't go through"),
        },
      } as never);
    } catch {
      fail("Couldn't transfer the call");
    }
  }, [say]);

  /** Joins both calls: each side hears this browser's microphone and the other side. */
  const merge = useCallback(async () => {
    const a = sessions.current.main;
    const b = sessions.current.second;
    if (!a || !b || conf.current) return;
    if (a.isOnHold().local) {
      a.unhold();
      // The re-INVITE that takes it off hold has to land before the mix.
      await new Promise((r) => setTimeout(r, 700));
    }
    const pcA = a.connection as unknown as RTCPeerConnection;
    const pcB = b.connection as unknown as RTCPeerConnection;
    const sender = (pc: RTCPeerConnection) => pc.getSenders().find((s) => s.track?.kind === "audio");
    const remote = (pc: RTCPeerConnection) => pc.getReceivers().map((r) => r.track).find((t) => t?.kind === "audio");
    const sA = sender(pcA), sB = sender(pcB);
    const micA = sA?.track, micB = sB?.track;
    const remA = remote(pcA), remB = remote(pcB);
    if (!sA || !sB || !micA || !micB || !remA || !remB) { say("Couldn't join the calls"); return; }
    const ctx = new AudioContext();
    const mix = (mic: MediaStreamTrack, other: MediaStreamTrack) => {
      const out = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream([mic])).connect(out);
      ctx.createMediaStreamSource(new MediaStream([other])).connect(out);
      return out.stream.getAudioTracks()[0];
    };
    await sA.replaceTrack(mix(micA, remB));
    await sB.replaceTrack(mix(micB, remA));
    conf.current = {
      mics: [micA, micB],
      restore: () => {
        void sA.replaceTrack(micA).catch(() => {});
        void sB.replaceTrack(micB).catch(() => {});
        void ctx.close();
      },
    };
    setConference(true);
    say("Calls merged");
  }, [say]);

  const api = useMemo<PhoneApi>(() => ({
    // Derived rather than reset in an effect: signed out means off.
    status: enabled ? status : "off",
    extension, error, call, open, setOpen, dial, second, conference, notice,
    answer: () => {
      const s = sessions.current.main;
      if (!s || s.direction !== "incoming") return;
      tones().stop();
      s.answer({ mediaConstraints: { audio: true, video: false }, pcConfig: { iceServers: ICE_SERVERS } });
    },
    decline: () => {
      tones().stop();
      try { sessions.current.main?.terminate({ status_code: 486, reason_phrase: "Busy Here" }); } catch { /* gone */ }
    },
    hangup: () => {
      tones().stop();
      // Everyone: the main call, and the second one if there is one.
      const { main, second: other } = sessions.current;
      if (other) transferred.current.delete(other);
      for (const s of [other, main]) { try { s?.terminate(); } catch { /* gone */ } }
    },
    endSecond: () => {
      try { sessions.current.second?.terminate(); } catch { /* gone */ }
    },
    endMain: () => {
      try { sessions.current.main?.terminate(); } catch { /* gone */ }
    },
    toggleMute: () => {
      if (conf.current) {
        // In a conference the senders carry the mix; muting means silencing
        // the microphone that feeds it.
        const muted = conf.current.mics[0]?.enabled === false;
        for (const m of conf.current.mics) m.enabled = muted;
        update("main", (c) => (c ? { ...c, muted: !muted } : c));
        update("second", (c) => (c ? { ...c, muted: !muted } : c));
        return;
      }
      const s = sessions.current.second ?? sessions.current.main;
      if (!s) return;
      if (s.isMuted().audio) s.unmute({ audio: true }); else s.mute({ audio: true });
    },
    toggleHold: () => {
      const s = sessions.current.main;
      if (!s || sessions.current.second) return;
      if (s.isOnHold().local) s.unhold(); else s.hold();
    },
    sendTone: (tone: string) => {
      const s = conf.current ? sessions.current.main : sessions.current.second ?? sessions.current.main;
      try { s?.sendDTMF(tone, { transportType: "RFC2833" } as never); } catch { /* not in a call */ }
    },
    transfer: (raw: string) => {
      const s = sessions.current.main;
      const number = dialable(raw);
      if (!s || !number) return;
      refer(s, `sip:${number}@${domainRef.current}`);
    },
    consult: (raw: string, name = "") => {
      const s = sessions.current.main;
      if (!s || sessions.current.second) return;
      if (!s.isOnHold().local) s.hold();
      place("second", raw, name);
    },
    completeTransfer: () => {
      const { main, second: other } = sessions.current;
      if (!main || !other) return;
      endConference();
      refer(main, other.remote_identity.uri.toString(), { replaces: other, alsoEnd: other });
    },
    merge: () => { void merge(); },
    parks,
    loadParks,
    park: (spot: string) => {
      const s = sessions.current.main;
      if (!s || sessions.current.second) return;
      // A park is a transfer to the spot: RingLogix's Directed-Parktrieve
      // rule holds the caller there until someone dials it.
      refer(s, `sip:${spot}@${domainRef.current}`, { label: `Parked on ${spot}` });
      setTimeout(loadParks, 2500);
    },
    retry: () => { setError(""); setAttempt((a) => a + 1); },
    directory,
    loadDirectory: (refresh?: boolean) => { void loadDirectory(refresh); },
    recents,
    loadRecents,
  }), [enabled, status, extension, error, call, second, conference, notice, open, dial, directory, loadDirectory, recents, loadRecents, place, refer, merge, endConference, update, parks, loadParks]);

  return (
    <PhoneContext.Provider value={api}>
      {children}
    </PhoneContext.Provider>
  );
}
