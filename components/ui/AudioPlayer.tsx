"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Play, Pause, Download, RefreshCw } from "lucide-react";

/**
 * A compact audio player in the app's own style, for voicemail and call
 * recordings: play/pause, a scrub bar, the time, a speed toggle and
 * download. Loads nothing until played (recordings stream through our
 * server). `seek(seconds)` lets a transcript jump the recording.
 */

export interface AudioPlayerHandle {
  seek: (seconds: number) => void;
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const SPEEDS = [1, 1.5, 2];

const AudioPlayer = forwardRef<AudioPlayerHandle, {
  src: string;
  /** Known length, shown before the file has loaded. */
  durationHint?: number;
  download?: boolean;
  autoPlay?: boolean;
  compact?: boolean;
}>(function AudioPlayer({ src, durationHint = 0, download = true, autoPlay = false, compact = false }, ref) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationHint);
  const [speed, setSpeed] = useState(1);

  useImperativeHandle(ref, () => ({
    seek: (s: number) => {
      const a = audio.current;
      if (!a) return;
      a.currentTime = s;
      void a.play().catch(() => {});
    },
  }));

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const on = (type: string, fn: () => void) => { a.addEventListener(type, fn); return () => a.removeEventListener(type, fn); };
    const offs = [
      on("play", () => setPlaying(true)),
      on("pause", () => setPlaying(false)),
      on("ended", () => setPlaying(false)),
      on("waiting", () => setLoading(true)),
      on("playing", () => setLoading(false)),
      on("canplay", () => setLoading(false)),
      on("timeupdate", () => setTime(a.currentTime)),
      on("loadedmetadata", () => { if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration); }),
    ];
    if (autoPlay) void a.play().catch(() => {});
    return () => offs.forEach((off) => off());
  }, [autoPlay]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) { setLoading(a.readyState < 3); void a.play().catch(() => setLoading(false)); } else a.pause();
  };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className={`flex items-center gap-3 rounded-xl border border-line bg-surface ${compact ? "px-2 py-1.5" : "px-2.5 py-2"} w-full`}>
      <audio ref={audio} src={src} preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className={`${compact ? "w-8 h-8" : "w-9 h-9"} rounded-full bg-fg text-surface flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity`}
      >
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 translate-x-px" fill="currentColor" />}
      </button>
      <span className="text-[11px] tabular-nums text-fg-muted w-9 text-right shrink-0">{fmt(time)}</span>
      <div className="relative flex-1 h-5 flex items-center group">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-surface-3 overflow-hidden">
          <div className="h-full bg-fg rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTime(v);
            if (audio.current) audio.current.currentTime = v;
          }}
          aria-label="Seek"
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          disabled={!duration}
        />
      </div>
      <span className="text-[11px] tabular-nums text-fg-subtle w-9 shrink-0">{fmt(duration)}</span>
      <button
        type="button"
        onClick={cycleSpeed}
        className="text-[11px] font-semibold tabular-nums text-fg-muted hover:text-fg rounded-md px-1.5 py-0.5 hover:bg-surface-3 shrink-0"
        aria-label="Playback speed"
        title="Playback speed"
      >
        {speed}×
      </button>
      {download && (
        <a href={src} download className="w-8 h-8 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-3 hover:text-fg shrink-0" aria-label="Download" title="Download">
          <Download className="w-4 h-4" />
        </a>
      )}
    </div>
  );
});

export default AudioPlayer;
