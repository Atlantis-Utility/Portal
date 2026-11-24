/**
 * JsSIP, loaded on demand and taught to accept RingLogix's domain.
 *
 * The domain here is a bare number ("277215"), so every SIP address looks
 * like sip:102pt@277215. JsSIP's grammar insists a host name starts with a
 * letter: it refuses such an address in the config, and worse, silently
 * drops every reply whose To/From carries one - RingLogix answered the
 * first REGISTER with 407 and JsSIP threw the answer away (seen
 * 2026-11-24). So a failed parse is retried with each numeric host swapped
 * for a placeholder name, and the real number is put back into the parsed
 * result. Nothing changes on the wire.
 */

type JsSIPModule = typeof import("jssip");

let loading: Promise<JsSIPModule> | null = null;

export function loadJsSIP(): Promise<JsSIPModule> {
  loading ??= import("jssip").then((m) => {
    const JsSIP = ((m as unknown as { default?: JsSIPModule }).default ?? m) as JsSIPModule;
    acceptNumericDomains(JsSIP);
    JsSIP.debug.disable();
    return JsSIP;
  });
  return loading;
}

const PLACEHOLDER = /^x(\d+)\.invalid$/;

function acceptNumericDomains(JsSIP: JsSIPModule) {
  const grammar = JsSIP.Grammar as unknown as { parse: (input: string, rule: string) => unknown; __numeric?: boolean };
  if (grammar.__numeric) return;
  const original = grammar.parse;
  // A host right after "@" or "sip:", made only of digits.
  const numericHost = () => /(@|sips?:)(\d+)(?=[;>\s?":]|$)/gi;

  const restore = (value: unknown, seen: Set<object>) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const v = record[key];
      if (typeof v === "string") {
        const m = PLACEHOLDER.exec(v);
        if (m) record[key] = m[1];
      } else {
        restore(v, seen);
      }
    }
  };

  grammar.parse = function (input: string, rule: string) {
    const first = original.call(this, input, rule);
    if (first !== -1 || typeof input !== "string" || !numericHost().test(input)) return first;
    const second = original.call(this, input.replace(numericHost(), (_m, p: string, d: string) => `${p}x${d}.invalid`), rule);
    if (second !== -1) restore(second, new Set());
    return second;
  };
  grammar.__numeric = true;
}

/** What to dial: digits (and * #) only, a US number without its leading 1. */
export function dialable(raw: string): string {
  const kept = raw.replace(/[^\d*#+]/g, "").replace(/^\+/, "");
  return /^1\d{10}$/.test(kept) ? kept.slice(1) : kept;
}
