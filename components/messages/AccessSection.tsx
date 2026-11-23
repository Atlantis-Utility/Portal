"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Users, RefreshCw, Search } from "lucide-react";
import { useToast } from "@/lib/toast";

interface Person { email: string; name: string; isAdmin: boolean }
interface Rule { mode: "everyone" | "restricted"; allowed: string[] }

/**
 * Who can see this conversation. Administrators only (the route checks).
 *
 * Everyone with Messages sees a conversation unless it's restricted here to
 * named people; administrators always see everything, so they're shown as
 * included rather than offered as a choice.
 */
export default function AccessSection({ sessionId, onChanged }: { sessionId: string; onChanged: () => void }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<{ rule: Rule; people: Person[] } | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Rule["mode"]>("everyone");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/messages/access/${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? "Couldn't load access");
        setLoaded(data);
        setMode(data.rule.mode);
        setPicked(data.rule.allowed ?? []);
        setError("");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't load access");
      }
    })();
    return () => { alive = false; };
  }, [sessionId]);

  const staff = useMemo(() => (loaded?.people ?? []).filter((p) => !p.isAdmin), [loaded]);
  const shown = staff.filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.email.includes(q);
  });
  const dirty = loaded
    ? mode !== loaded.rule.mode || (mode === "restricted" && [...picked].sort().join() !== [...(loaded.rule.allowed ?? [])].sort().join())
    : false;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/messages/access/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, allowed: mode === "restricted" ? picked : [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that");
      setLoaded((l) => (l ? { ...l, rule: data.rule } : l));
      toast.success(mode === "everyone" ? "Everyone with Messages can see this now." : `Only ${picked.length} ${picked.length === 1 ? "person" : "people"} (and admins) can see this now.`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="text-xs text-[#b91c1c]">{error}</p>;
  if (!loaded) return <RefreshCw className="w-4 h-4 animate-spin text-[#999]" />;

  const option = (value: Rule["mode"], title: string, hint: string, Icon: React.ElementType) => (
    <label
      className={`flex gap-2.5 rounded-lg border p-2.5 cursor-pointer transition-colors ${
        mode === value ? "border-[#0a0a0a] bg-[#fafafa]" : "border-[#eaeaea] hover:border-[#d4d4d4]"
      }`}
    >
      <input type="radio" className="mt-0.5" checked={mode === value} onChange={() => setMode(value)} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#0a0a0a]"><Icon className="w-3.5 h-3.5 text-[#666]" /> {title}</span>
        <span className="block text-[11px] text-[#999] mt-0.5">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-2.5">
      {option("everyone", "Everyone with Messages", "The shared inbox default.", Users)}
      {option("restricted", "Only these people", "Plus administrators, who always see everything.", Lock)}

      {mode === "restricted" && (
        <div className="rounded-lg border border-[#eaeaea]">
          <div className="relative border-b border-[#eaeaea]">
            <Search className="w-3.5 h-3.5 text-[#999] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a person"
              className="w-full text-[13px] bg-transparent pl-8 pr-2 py-2 outline-none"
            />
          </div>
          <ul className="max-h-48 overflow-y-auto divide-y divide-[#f4f4f4]">
            {shown.map((p) => (
              <li key={p.email}>
                <label className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer hover:bg-[#fafafa]">
                  <input
                    type="checkbox"
                    checked={picked.includes(p.email)}
                    onChange={(e) => setPicked((list) => (e.target.checked ? [...list, p.email] : list.filter((x) => x !== p.email)))}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] text-[#0a0a0a] truncate">{p.name}</span>
                    <span className="block text-[11px] text-[#999] truncate">{p.email}</span>
                  </span>
                </label>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2.5 py-3 text-[12px] text-[#999]">
                {staff.length === 0 ? "Nobody besides administrators has Messages yet." : "Nobody matches."}
              </li>
            )}
          </ul>
        </div>
      )}

      {dirty && (
        <button
          onClick={save}
          disabled={saving || (mode === "restricted" && picked.length === 0)}
          className="w-full flex items-center justify-center gap-2 bg-[#0a0a0a] text-white text-[13px] font-medium rounded-lg py-2 hover:opacity-90 disabled:opacity-40"
        >
          {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Save access
        </button>
      )}
      <p className="text-[10px] text-[#bbb]">
        In this app only. Whoever signs in to SNAPmobile, the web app or Teams as this conversation&apos;s extension still sees it.
      </p>
    </div>
  );
}
