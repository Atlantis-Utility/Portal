"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export const PASSWORD_HINT = "At least 8 characters, with a number or symbol.";

/** Mirrors lib/passwords.ts passwordProblem, so most mistakes never leave the page. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 72) return "Keep it under 72 characters.";
  if (!/[a-z]/i.test(password) || !/[^a-z]/i.test(password)) return "Mix letters with at least one number or symbol.";
  return null;
}

const input =
  "w-full text-sm border border-[#eaeaea] rounded-lg px-3 py-2.5 outline-none focus:border-[#0070f3] transition-colors bg-white";

/**
 * Sets the signed-in person's own password through app/api/auth/my-password,
 * which also lifts a temporary password's hold. The session is refreshed
 * afterwards so the cleared flag reaches the browser too.
 */
export default function ChangePasswordForm({
  askCurrent = false,
  submitLabel = "Save password",
  onDone,
}: {
  /** Changing an existing password: ask for the current one first. */
  askCurrent?: boolean;
  submitLabel?: string;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (askCurrent && !current) return setError("Enter your current password.");
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("Those two don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/my-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, current: askCurrent ? current : undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save it. Try again.");
      await supabase.auth.refreshSession().catch(() => {});
      setCurrent(""); setPassword(""); setConfirm("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const type = show ? "text" : "password";
  return (
    <form onSubmit={save} className="space-y-3">
      {askCurrent && (
        <div className="space-y-1.5">
          <label htmlFor="pw-current" className="text-[11px] font-medium text-[#666]">Current password</label>
          <input id="pw-current" type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="pw-new" className="text-[11px] font-medium text-[#666]">New password</label>
        <div className="relative">
          <input
            id="pw-new"
            type={type}
            autoComplete="new-password"
            autoFocus={!askCurrent}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={PASSWORD_HINT}
            className={`${input} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            data-tip={show ? "Hide" : "Show"}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#999] hover:text-[#0a0a0a]"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="pw-confirm" className="text-[11px] font-medium text-[#666]">Type it again</label>
        <input id="pw-confirm" type={type} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
      </div>
      {error && <p className="text-xs text-[#f31260] bg-[#fff0f3] border border-[#fecdd3] rounded-lg px-3 py-2">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-[#0a0a0a] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
      >
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
