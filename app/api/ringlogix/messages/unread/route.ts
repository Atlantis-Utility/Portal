import { NextResponse } from "next/server";
import { tenantDomain } from "@/lib/tenancy";
import { allows, currentViewer, loadRules } from "@/lib/messages/access";
import { ApiAuthError } from "@/lib/api-auth";
import { getMessageSessions, isConfigured } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";
import {
  normalizeSession, dedupeConversations, type RawMessageSession,
} from "@/lib/ringlogix-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many conversations are unread - and nothing else.
 *
 * For the badge on Messages in the sidebar, which every page shows and
 * polls. The full messages route also reads contact books and the
 * colleague list; this reads only the mailbox (one call, cached for five
 * seconds), and counts it exactly the way that route does.
 */
export async function GET() {
  try {
    const viewer = await currentViewer();
    if (!isConfigured()) return NextResponse.json({ unread: 0 });
    const domain = await tenantDomain();
    const rows = ((await getMessageSessions(domain, "*")) ?? []) as RawMessageSession[];
    const rules = await loadRules();
    const unread = dedupeConversations(
      rows.map(normalizeSession).filter((c) => c.sessionId && (c.lastMessage || c.hasMedia)),
    ).filter((c) => c.unread && allows(rules.get(c.sessionId), viewer)).length;
    return NextResponse.json({ unread });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}
