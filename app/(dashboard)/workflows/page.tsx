"use client";

import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw, Lock } from "lucide-react";
import Header from "@/components/layout/Header";
import ScheduledMessages, { type ScheduleConversation } from "@/components/messages/ScheduledMessages";
import { useAuth } from "@/lib/auth-context";
import { formatPhone } from "@/lib/utils";
import { SCHEDULE_OPTION } from "@/lib/workflows/types";
import type { SmsConversation } from "@/lib/ringlogix-messages";

interface Loaded {
  conversations: ScheduleConversation[];
  contacts: Array<{ number: string; name: string }>;
  senders: Array<{ number: string; user: string }>;
}

/**
 * Workflows: automations people set up themselves.
 *
 * Today that is scheduled texts - once, or on a repeat. The same list grows
 * as new triggers arrive (a text comes in, another app calls in). Also
 * reachable from Messages, where "Scheduled" opens the same thing over the
 * inbox.
 */
export default function WorkflowsPage() {
  const { authUser } = useAuth();
  const canSchedule = Boolean(authUser?.pageOptions?.includes(SCHEDULE_OPTION));
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  // The scheduler picks from the inbox's conversations, the contact book and
  // our sending numbers, all of which the messages route already assembles.
  useEffect(() => {
    if (!canSchedule) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/ringlogix/messages");
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(body.message ?? body.error ?? "Couldn't read the inbox");
        const names: Record<string, string> = body.names ?? {};
        const book: Record<string, { name: string }> = body.contacts ?? {};
        const label = (c: SmsConversation) =>
          c.name ||
          (c.remoteExtension && names[c.remoteExtension]) ||
          (!c.isGroup && book[(c.remoteNumbers[0] ?? "").slice(-10)]?.name) ||
          c.remoteNumbers.map((n) => book[n.slice(-10)]?.name || formatPhone(n) || n).join(", ") ||
          "Conversation";
        setData({
          conversations: ((body.conversations ?? []) as SmsConversation[]).map((c) => ({
            sessionId: c.sessionId, user: c.user, label: label(c), isGroup: c.isGroup,
          })),
          contacts: Object.entries(book).map(([number, info]) => ({ number, name: info.name })),
          senders: body.senders ?? [],
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't read the inbox");
      }
    })();
    return () => { alive = false; };
  }, [canSchedule]);

  return (
    <div>
      <Header
        title="Workflows"
        subtitle="Texts that go out on their own: reminders, notices and follow-ups, once or on a repeat"
      />

      {!canSchedule ? (
        <div className="bg-white border border-[#eaeaea] rounded-xl p-10 text-center">
          <Lock className="w-6 h-6 text-[#bbb] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#0a0a0a] mb-1">You can&apos;t set up workflows yet</p>
          <p className="text-xs text-[#999] max-w-sm mx-auto">
            Ask an administrator to tick <strong>Schedule messages</strong> under Messages in your profile.
          </p>
        </div>
      ) : error ? (
        <div className="bg-white border border-[#eaeaea] rounded-xl p-10 text-center">
          <AlertCircle className="w-6 h-6 text-[#f31260] mx-auto mb-3" />
          <p className="text-sm text-[#0a0a0a] mb-1">Couldn&apos;t load what workflows need</p>
          <p className="text-xs text-[#999]">{error}</p>
        </div>
      ) : !data ? (
        <div className="bg-white border border-[#eaeaea] rounded-xl p-10 text-center">
          <RefreshCw className="w-5 h-5 animate-spin text-[#999] mx-auto" />
        </div>
      ) : (
        <ScheduledMessages inline {...data} />
      )}
    </div>
  );
}
