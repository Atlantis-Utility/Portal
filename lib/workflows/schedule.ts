import type { ScheduleTrigger } from "./types";

/**
 * When a schedule fires, worked out in Pacific time.
 *
 * "Every weekday at 9am" means 9am on the wall in Ventura County, through
 * both daylight-saving changes. Adding 24 hours to a UTC timestamp would
 * drift to 8am or 10am twice a year, so every rule here is computed on the
 * Pacific calendar and converted back to an instant at the end.
 */
export const TIME_ZONE = "America/Los_Angeles";

interface Wall {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
}

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** The Pacific wall clock at an instant. */
export function wallAt(ms: number): Wall {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour) % 24,
    mm: Number(parts.minute),
  };
}

/** Pacific's offset from UTC at an instant, in ms (negative: behind UTC). */
function offsetAt(ms: number): number {
  const w = wallAt(ms);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  return asUtc - (ms - (ms % 60_000));
}

/**
 * The instant a Pacific wall time names.
 *
 * In the spring-forward gap (2:30am that doesn't exist) this lands an hour
 * later, and in the fall-back hour it takes the first of the two - either
 * way a text goes out once, close to when it was asked for.
 */
export function instantOf(w: Wall): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  let t = guess - offsetAt(guess);
  // Once more, in case the first guess was on the far side of a change.
  t = guess - offsetAt(t);
  return t;
}

/** YYYY-MM-DD for a Pacific calendar day. */
function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Day of the week for a calendar date, 0 = Sunday. */
function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The first time this schedule fires strictly after `afterMs`, or null when
 * it never will again (a one-off already past, or a repeat past its end).
 *
 * A run never comes before the schedule's own start: "every Monday from the
 * 1st" doesn't fire on the Monday before.
 */
export function nextRun(trigger: ScheduleTrigger, afterMs: number): number | null {
  const anchorMs = Date.parse(trigger.at);
  if (Number.isNaN(anchorMs)) return null;
  const a = wallAt(anchorMs);
  const floor = Math.max(afterMs, anchorMs - 1);

  if (trigger.repeat === "none") return anchorMs > afterMs ? anchorMs : null;

  const past = (y: number, m: number, d: number) =>
    Boolean(trigger.until) && dayKey(y, m, d) > (trigger.until as string);

  if (trigger.repeat === "monthly") {
    const start = wallAt(floor);
    for (let i = 0; i < 36; i++) {
      const y = start.y + Math.floor((start.m - 1 + i) / 12);
      const m = ((start.m - 1 + i) % 12) + 1;
      // The 31st in a 30-day month is the 30th, not skipped.
      const d = Math.min(a.d, daysInMonth(y, m));
      if (past(y, m, d)) return null;
      const t = instantOf({ y, m, d, hh: a.hh, mm: a.mm });
      if (t > floor) return t;
    }
    return null;
  }

  // daily, weekdays, weekly: walk forward a day at a time.
  const start = wallAt(floor);
  const base = Date.UTC(start.y, start.m - 1, start.d);
  const anchorDow = weekday(a.y, a.m, a.d);
  for (let i = 0; i < 400; i++) {
    const day = new Date(base + i * 86_400_000);
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    if (past(y, m, d)) return null;
    const dow = weekday(y, m, d);
    if (trigger.repeat === "weekdays" && (dow === 0 || dow === 6)) continue;
    if (trigger.repeat === "weekly" && dow !== anchorDow) continue;
    const t = instantOf({ y, m, d, hh: a.hh, mm: a.mm });
    if (t > floor) return t;
  }
  return null;
}

/** The first run of a new or resumed schedule: now or later, never earlier. */
export function firstRun(trigger: ScheduleTrigger, nowMs: number): number | null {
  // A minute's grace, so "now" chosen in the form isn't already in the past
  // by the time it is saved.
  return nextRun(trigger, nowMs - 60_000);
}

/** The next few runs, for showing someone what they've set up. */
export function upcomingRuns(trigger: ScheduleTrigger, fromMs: number, count = 3): number[] {
  const out: number[] = [];
  let after = fromMs - 60_000;
  for (let i = 0; i < count; i++) {
    const t = nextRun(trigger, after);
    if (t === null) break;
    out.push(t);
    after = t;
  }
  return out;
}

const showFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Mon, Nov 24, 9:00 AM", always in Pacific time. */
export function showTime(ms: number | string | null | undefined): string {
  if (ms === null || ms === undefined || ms === "") return "—";
  const t = typeof ms === "string" ? Date.parse(ms) : ms;
  return Number.isNaN(t) ? "—" : showFormat.format(new Date(t));
}

/** The Pacific value for an <input type="datetime-local">. */
export function toLocalInput(ms: number): string {
  const w = wallAt(ms);
  return `${dayKey(w.y, w.m, w.d)}T${String(w.hh).padStart(2, "0")}:${String(w.mm).padStart(2, "0")}`;
}

/** Reads a datetime-local value as Pacific time, whatever the browser's zone. */
export function fromLocalInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return instantOf({ y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mm: +m[5] });
}
