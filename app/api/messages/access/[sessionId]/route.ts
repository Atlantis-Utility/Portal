import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError } from "@/lib/api-auth";
import { currentViewer, getRule, messagesUsers, setRule } from "@/lib/messages/access";
import { getErrorMessage } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

function refuse(err: unknown) {
  if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  const message = getErrorMessage(err, "Something went wrong");
  if (/conversation_access/.test(message) && /does not exist|schema cache/.test(message)) {
    return NextResponse.json(
      { error: "Conversation access isn't set up yet: run supabase/migration-conversation-access.sql." },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

async function requireAdminViewer() {
  const viewer = await currentViewer();
  if (!viewer.isAdmin) throw new ApiAuthError("Only administrators can change who sees a conversation.", 403);
  return viewer;
}

/** A conversation's access, and the people it could be shared with. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requireAdminViewer();
    const { sessionId } = await params;
    const [rule, people] = await Promise.all([getRule(sessionId), messagesUsers()]);
    return NextResponse.json({ rule, people });
  } catch (err) {
    return refuse(err);
  }
}

/** { mode: "everyone" } or { mode: "restricted", allowed: [emails] }. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const viewer = await requireAdminViewer();
    const { sessionId } = await params;
    const body = (await req.json().catch(() => ({}))) as { mode?: string; allowed?: unknown };
    const mode = body.mode === "restricted" ? "restricted" : "everyone";
    const allowed = Array.isArray(body.allowed) ? body.allowed.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [];
    if (mode === "restricted" && allowed.length === 0) {
      return NextResponse.json({ error: "Pick at least one person, or set it back to Everyone." }, { status: 400 });
    }
    // Only people who actually hold Messages can be given it.
    const holders = new Set((await messagesUsers()).map((p) => p.email));
    const unknown = allowed.filter((e) => !holders.has(e));
    if (unknown.length) {
      return NextResponse.json({ error: `Not on the Users list with Messages: ${unknown.join(", ")}` }, { status: 400 });
    }
    await setRule(sessionId, { mode, allowed }, viewer.email);
    console.log(`[messages] ${viewer.email} set ${sessionId} to ${mode}${mode === "restricted" ? ` (${allowed.length})` : ""}`);
    return NextResponse.json({ rule: { mode, allowed } });
  } catch (err) {
    return refuse(err);
  }
}
