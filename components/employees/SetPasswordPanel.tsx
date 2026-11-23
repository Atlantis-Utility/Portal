"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, RefreshCw, Wand2 } from "lucide-react";
import { passwordProblem, PASSWORD_HINT } from "@/components/auth/ChangePasswordForm";

/** Twelve characters people can read aloud: no 0/O, 1/l/I. */
export function generatePassword(): string {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits + "!@#$%";
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(letters), pick(digits), pick("!@#$%"), ...Array.from({ length: 8 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Sends a password to app/api/auth/admin-password. */
export async function setPasswordFor(email: string, password: string, temporary: boolean) {
  const res = await fetch("/api/auth/admin-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, temporary }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; created?: boolean };
  if (!res.ok) throw new Error(data.error ?? "Couldn't set the password.");
  return data;
}

/**
 * The password fields an administrator fills in. Controlled, so the add
 * drawer can send it after saving the user and the edit drawer right away.
 */
export function PasswordFields({
  password, onPassword, temporary, onTemporary,
}: {
  password: string;
  onPassword: (v: string) => void;
  temporary: boolean;
  onTemporary: (v: boolean) => void;
}) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const problem = password ? passwordProblem(password) : null;
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            placeholder={PASSWORD_HINT}
            className="w-full text-sm border border-[#eaeaea] rounded-lg pl-3 pr-16 py-2 outline-none focus:border-[#0070f3] transition-colors bg-white font-mono"
          />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex">
            <button type="button" onClick={() => setShow((s) => !s)} data-tip={show ? "Hide" : "Show"} className="p-1 text-[#999] hover:text-[#0a0a0a]">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              type="button"
              disabled={!password}
              onClick={async () => {
                await navigator.clipboard.writeText(password).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              data-tip={copied ? "Copied" : "Copy"}
              className="p-1 text-[#999] hover:text-[#0a0a0a] disabled:opacity-30"
            >
              <Copy className="w-4 h-4" />
            </button>
          </span>
        </div>
        <button
          type="button"
          onClick={() => { onPassword(generatePassword()); setShow(true); }}
          className="shrink-0 flex items-center gap-1.5 border border-[#eaeaea] bg-white text-[13px] font-medium text-[#0a0a0a] px-3 py-2 rounded-lg hover:bg-[#fafafa] transition-colors"
        >
          <Wand2 className="w-3.5 h-3.5" /> Generate
        </button>
      </div>
      {problem && <p className="text-[11px] text-[#f31260]">{problem}</p>}
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={temporary} onChange={(e) => onTemporary(e.target.checked)} />
        <span className="text-xs text-[#666]">
          Make them choose their own password when they first sign in
          <span className="block text-[11px] text-[#999]">Recommended, so only they know it.</span>
        </span>
      </label>
    </div>
  );
}

/** Edit drawer: set or replace someone's password now. */
export default function SetPasswordPanel({ email, onDone }: { email: string; onDone: (message: string, ok: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [temporary, setTemporary] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2.5">
      <PasswordFields password={password} onPassword={setPassword} temporary={temporary} onTemporary={setTemporary} />
      <button
        type="button"
        disabled={busy || !email || Boolean(passwordProblem(password))}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await setPasswordFor(email, password, temporary);
            onDone(
              `${r.created ? "Login created" : "Password set"} for ${email}. Give them the password yourself${temporary ? "; they'll choose a new one at first sign-in" : ""}.`,
              true,
            );
            setPassword("");
          } catch (e) {
            onDone(e instanceof Error ? e.message : "Couldn't set the password.", false);
          } finally {
            setBusy(false);
          }
        }}
        className="flex items-center gap-1.5 bg-[#0a0a0a] text-white text-[13px] font-medium px-3.5 py-1.5 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-40"
      >
        {busy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Set password
      </button>
    </div>
  );
}
