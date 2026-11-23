"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandMark from "@/components/ui/BrandMark";
import { Mail } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * Two buttons, one for each place our people have an account.
 *
 * Microsoft is unchanged and comes first: it's how everyone on the tenant
 * everyone else, the people with no Microsoft account at all.
 *
 * Neither is a sign-up. Both check the address against the employee list
 * before any session exists, so having an account somewhere else is not a
 * way in here.
 *
 * There is also an email and password path (an invite sets the password,
 * see app/api/auth/password-link), kept behind NEXT_PUBLIC_PASSWORD_LOGIN
 * password is one more thing to leak for nobody's benefit.
 */

// What a failed callback can send back, in words rather than codes.
const CALLBACK_ERRORS: Record<string, string> = {
  not_an_employee: "That account isn't on the user list. Ask an administrator to add you first.",
};

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, loginWithMicrosoft, authUser, loading, authError } = useAuth();

  const callbackError = params.get("error");

  const [error, setError] = useState("");
  const [msBusy, setMsBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  /**
   * The password form is out of the way until it's needed. Microsoft and
   * offers a password box to people who never use one is a page inviting
   * them to try. It opens on request, and by itself when a sign-in attempt
   * came back without a session, which is the moment the other two have
   * demonstrably failed for whoever is standing there.
   */
  const [showPassword, setShowPassword] = useState(Boolean(callbackError));

  useEffect(() => {
    if (!loading && authUser) router.replace("/");
  }, [authUser, loading, router]);

  async function handleMicrosoft() {
    setError("");
    setMsBusy(true);
    try {
      await loginWithMicrosoft();
    } catch (err: unknown) {
      console.error("[ms-login] signInWithPopup failed:", err);
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("popup-closed-by-user") && !msg.includes("cancelled-popup-request")) {
        setError("Microsoft sign-in failed. Please try again.");
      }
    } finally {
      setMsBusy(false);
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        /Email not confirmed/i.test(msg)
          ? "That account hasn't been set up yet. Use the link in your invite email."
          : /Invalid login/i.test(msg)
            ? "That email and password don't match."
            : msg || "Couldn't sign you in. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    let noEmail = false;
    try {
      const res = await fetch("/api/auth/password-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), kind: "reset" }),
      });
      // The one answer that isn't the same for everyone: this deployment
      // can't send email at all, which says nothing about the address.
      noEmail = res.status === 503;
    } catch {
      // Ignored on purpose: the answer is the same either way, so a failure
      // here can't be used to work out who has an account.
    } finally {
      setBusy(false);
      if (noEmail) setError("Password reset emails aren't switched on yet. Ask an administrator to set a new password for you.");
      else setSent(true);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-5 h-5 border-2 border-[#0a0a0a] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const message =
    error ||
    authError ||
    (callbackError ? (CALLBACK_ERRORS[callbackError] ?? "That sign-in didn't complete. Try again.") : "");

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      {/* The wide-screen panel carries the brand; on a phone it's here. */}
      <div className="flex lg:hidden items-center gap-2.5 justify-center mb-8">
        <BrandMark size={32} />
        <span className="text-[17px] font-semibold text-fg tracking-tight">Atlantis Portal</span>
      </div>
      <div className="hidden lg:block mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Welcome back</h1>
        <p className="text-sm text-fg-muted mt-1">Sign in to your Atlantis Portal.</p>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.12)]">
        {forgot ? (
          sent ? (
            <>
              <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">Check your email</h1>
              <p className="text-sm text-[#666]">
                If <span className="font-medium text-[#0a0a0a]">{email.trim()}</span> has an account, a link to set a
                new password is on its way. It works once and expires in an hour.
              </p>
              <button
                type="button"
                onClick={() => {
                  setForgot(false);
                  setSent(false);
                }}
                className="mt-6 w-full border border-[#eaeaea] bg-white text-sm font-medium text-[#0a0a0a] px-4 py-2.5 rounded-lg hover:bg-[#fafafa] transition-colors"
              >
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">Forgot your password?</h1>
                <p className="text-sm text-[#666]">We&apos;ll email you a link to set a new one.</p>
              </div>
              <form onSubmit={handleForgot} className="space-y-3">
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full text-sm border border-[#eaeaea] rounded-lg px-3 py-2.5 outline-none focus:border-[#0070f3] transition-colors"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full bg-[#0a0a0a] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send the link"}
                </button>
                <button
                  type="button"
                  onClick={() => setForgot(false)}
                  className="w-full text-[13px] text-[#666] py-1.5 rounded-lg hover:bg-[#fafafa] transition-colors"
                >
                  Back to sign in
                </button>
              </form>
            </>
          )
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">Sign in</h1>
              <p className="text-sm text-[#666]">Microsoft for Atlantis accounts, email and password for everyone else.</p>
            </div>

            <div className="space-y-3">
              {/* Microsoft */}
              <button
                type="button"
                onClick={handleMicrosoft}
                disabled={msBusy}
                className="w-full flex items-center gap-3 border border-[#eaeaea] bg-white text-sm font-medium text-[#0a0a0a] px-4 py-2.5 rounded-lg hover:bg-[#fafafa] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {msBusy ? (
                  <span className="w-4.5 h-4.5 border-2 border-[#ccc] border-t-[#0a0a0a] rounded-full animate-spin shrink-0" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0">
                    <rect x="1" y="1" width="7.5" height="7.5" fill="#F25022" />
                    <rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00" />
                    <rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF" />
                    <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900" />
                  </svg>
                )}
                <span className="flex-1 text-left">{msBusy ? "Signing in…" : "Continue with Microsoft"}</span>
              </button>


            </div>

            {/* For everyone without an Atlantis Microsoft account: an
                administrator sets them up with a password. */}
            {!showPassword && (
              <button
                type="button"
                onClick={() => setShowPassword(true)}
                className="mt-3 w-full flex items-center gap-3 border border-[#eaeaea] bg-white text-sm font-medium text-[#0a0a0a] px-4 py-2.5 rounded-lg hover:bg-[#fafafa] transition-colors"
              >
                <Mail className="w-4.5 h-4.5 text-[#666] shrink-0" />
                <span className="flex-1 text-left">Continue with email and password</span>
              </button>
            )}

            {showPassword && (
              <>
                <div className="flex items-center gap-3 my-5">
                  <span className="h-px flex-1 bg-[#eaeaea]" />
                  <span className="text-[11px] text-[#999]">or</span>
                  <span className="h-px flex-1 bg-[#eaeaea]" />
                </div>

                <form onSubmit={handlePassword} className="space-y-3">
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full text-sm border border-[#eaeaea] rounded-lg px-3 py-2.5 outline-none focus:border-[#0070f3] transition-colors"
                  />
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="w-full text-sm border border-[#eaeaea] rounded-lg px-3 py-2.5 outline-none focus:border-[#0070f3] transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full bg-[#0a0a0a] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
                  >
                    {busy ? "Signing in…" : "Sign in"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForgot(true);
                      setError("");
                    }}
                    className="w-full text-[12px] text-[#666] py-1 rounded-lg hover:bg-[#fafafa] transition-colors"
                  >
                    Forgot your password?
                  </button>
                </form>
              </>
            )}
          </>
        )}

        {message && (
          <p className="mt-4 text-xs text-[#f31260] bg-[#fff0f3] border border-[#fecdd3] rounded-lg px-3 py-2">
            {message}
          </p>
        )}
      </div>

      <p className="text-center text-xs text-[#999] mt-5">Atlantis Utility &copy; {new Date().getFullYear()}</p>
    </div>
  );
}
