"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import Select from "@/components/ui/Select";

/**
 * Admin only: which RingLogix extension this person calls as from the
 * portal phone. Saved on its own, the moment it's chosen, through the
 * admin-checked /api/phone/extension: it decides whose line their browser
 * becomes, so it isn't part of the profile anyone can edit.
 */

interface Choice { user: string; name: string; email: string; assignedTo: string | null }

export default function PhoneExtensionField({ email, onDone }: { email: string; onDone: (message: string, ok: boolean) => void }) {
  const [state, setState] = useState<{ extension: string; choices: Choice[]; suggested: string } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const key = email.trim().toLowerCase();

  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`/api/phone/extension?email=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(body.error ?? "Couldn't load extensions"); return; }
        setState({ extension: body.extension ?? "", choices: body.choices ?? [], suggested: body.suggested ?? "" });
        setError("");
      })
      .catch(() => { if (live) setError("Couldn't load extensions"); });
    return () => { live = false; };
  }, [key]);

  async function save(extension: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/phone/extension", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: key, extension: extension || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't save the extension");
      setState((s) => (s ? {
        ...s,
        extension,
        choices: s.choices.map((c) => ({
          ...c,
          assignedTo: c.user === extension ? key : c.assignedTo === key ? null : c.assignedTo,
        })),
      } : s));
      onDone(extension ? `Calls from the portal now go out as extension ${extension}.` : "Portal phone switched off for them.", true);
    } catch (e) {
      onDone(e instanceof Error ? e.message : "Couldn't save the extension", false);
    } finally {
      setSaving(false);
    }
  }

  const options = [
    { value: "", label: "No phone" },
    ...(state?.choices ?? [])
      .filter((c) => !c.assignedTo || c.assignedTo === key)
      .map((c) => ({ value: c.user, label: `${c.user}${c.name ? ` · ${c.name}` : ""}${c.user === state?.suggested ? " (matches their email)" : ""}` })),
  ];

  return (
    <div className="border-t border-[#f7f7f7] pt-4">
      <p className="text-[10px] font-semibold text-[#999] uppercase tracking-widest mb-2">Phone</p>
      <div className="flex items-start gap-3 justify-between">
        <p className="text-[11px] text-[#999] leading-relaxed max-w-xs flex gap-2">
          <Phone className="w-3.5 h-3.5 text-[#bbb] shrink-0 mt-0.5" />
          <span>
            The extension they call and take calls as in the portal. Their browser rings along with that
            extension&apos;s other phones.
          </span>
        </p>
        <div className="w-56 shrink-0">
          {error ? (
            <p className="text-[11px] text-[#f31260]">{error}</p>
          ) : (
            <Select
              value={state?.extension ?? ""}
              onChange={(v) => void save(v)}
              options={options}
              placeholder={state ? (state.suggested ? `Suggested: ${state.suggested}` : "No phone") : "Loading…"}
              disabled={!state || saving}
              searchable
            />
          )}
        </div>
      </div>
    </div>
  );
}
