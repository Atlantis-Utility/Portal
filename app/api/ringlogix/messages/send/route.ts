import { tenantDomain } from "@/lib/tenancy";
import { NextRequest, NextResponse } from "next/server";
import { requireConversation } from "@/lib/messages/access";
import { requireEmployee, ApiAuthError } from "@/lib/api-auth";
import { getMessageSessions, getMessages, sendMessage, sendMedia, isConfigured, RingLogixError } from "@/lib/ringlogix";
import { ringlogixFailure } from "@/lib/ringlogix-response";
import { digitsOf, extensionOf, remoteNumbersOf, type RawMessage, type RawMessageSession } from "@/lib/ringlogix-messages";
import { recordSender } from "@/lib/messages/senders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LENGTH = 1600; // ten segments; past this a carrier starts dropping

/**
 * Attachments. Vercel refuses a request body over 4.5 MB, so the server's
 * cap sits under that; the browser shrinks large photos well below it,
 * because carriers start dropping MMS somewhere past a megabyte or so.
 */
const MAX_MEDIA_BYTES = 3.5 * 1024 * 1024;
const MEDIA_TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif|bmp)|video\/(mp4|3gpp|quicktime)|audio\/(mpeg|mp4|amr|wav|x-wav|aac)|application\/pdf|text\/(vcard|x-vcard|plain|calendar))$/i;
const MEDIA_LIMIT = 1024; // v2 caps a media message's text at 1024

/**
 * Replies to a text.
 *
 * Deliberately a *reply*, not a send: the destination is not taken from
 * the request at all, it is looked up from the conversation being replied
 * to. A browser can therefore only ever write back to somebody who has
 * already written to us, and a typo in a number cannot reach a stranger -
 * the same rule the customer broadcast uses, for the same reason.
 *
 * Starting a brand-new conversation is a separate thing and is not this.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireEmployee();
    if (!isConfigured()) {
      return NextResponse.json({ error: "RingLogix isn't configured" }, { status: 503 });
    }

    // A text arrives as JSON; a picture or file as a form, alongside it.
    let body: { sessionId?: string; user?: string; domain?: string; text?: string } = {};
    let file: File | null = null;
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) return NextResponse.json({ error: "That upload didn't come through - try again." }, { status: 400 });
      body = {
        sessionId: String(form.get("sessionId") ?? ""),
        user: String(form.get("user") ?? ""),
        text: String(form.get("text") ?? ""),
      };
      const f = form.get("file");
      file = f instanceof File && f.size > 0 ? f : null;
    } else {
      body = (await req.json().catch(() => ({}))) as typeof body;
    }

    const text = (body.text ?? "").trim();
    const sessionId = (body.sessionId ?? "").trim();
    const user = (body.user ?? "").trim();
    const domain = await tenantDomain();

    if (!text && !file) return NextResponse.json({ error: "Nothing to send" }, { status: 400 });
    const limit = file ? MEDIA_LIMIT : MAX_LENGTH;
    if (text.length > limit) {
      return NextResponse.json({ error: `That's ${text.length} characters; the limit ${file ? "with an attachment " : ""}is ${limit}.` }, { status: 400 });
    }
    if (file) {
      if (file.size > MAX_MEDIA_BYTES) {
        return NextResponse.json({ error: `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 3.5 MB.` }, { status: 413 });
      }
      if (!MEDIA_TYPES.test(file.type)) {
        return NextResponse.json({ error: `Phones can't receive ${file.type || "that kind of file"} by text. Pictures, short videos, PDFs and contact cards work.` }, { status: 415 });
      }
    }
    if (!sessionId) return NextResponse.json({ error: "Which conversation?" }, { status: 400 });
    await requireConversation(sessionId);

    // The destination comes from the conversation, never from the caller.
    const sessions = ((await getMessageSessions(domain, user || "*")) ?? []) as RawMessageSession[];
    const session = sessions.find((s) => s.session_id === sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "That conversation isn't one of ours, so there's nobody to reply to." },
        { status: 400 },
      );
    }

    // A colleague's thread carries an extension where a customer's carries
    // a number; both are valid destinations, and which one decides whether
    // this is a text or an internal chat.
    const remoteExtension = extensionOf(session.remote);
    // A group carries several numbers and is addressed to all of them at
    // once; replying to only the first would quietly split the thread.
    const numbers = remoteNumbersOf(session.remote);
    const destination = remoteExtension || numbers.join(",");
    if (!destination) {
      return NextResponse.json({ error: "That conversation has nobody on the other end." }, { status: 400 });
    }

    // Our number on this thread. Required for a text - without it
    // RingLogix accepts the message as an internal chat and it never
    // leaves the building.
    const fromNumber = remoteExtension ? undefined : digitsOf(session.smsani);
    if (!remoteExtension && !fromNumber) {
      return NextResponse.json(
        { error: "That conversation has no number of ours on it to send from." },
        { status: 400 },
      );
    }

    // Sent from the extension that holds the thread, so the reply comes
    // from the number they already know and stays in the same conversation
    // rather than opening a second one.
    const from = session.user ?? user;
    let created: { id?: string } | null = null;
    if (file) {
      try {
        await sendMedia({
          domain, user: from, sessionId, message: text, fromNumber,
          destination: remoteExtension ? [remoteExtension] : numbers,
          file: { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type },
        });
      } catch (err) {
        const refused = mediaRefusal(err);
        if (refused) return refused;
        throw err;
      }
      // v2 answers 202 with no id; the stored message is the newest
      // attachment we sent in this conversation.
      const rows = ((await getMessages(domain, from, sessionId).catch(() => [])) ?? []) as RawMessage[];
      const mine = rows
        .filter((m) => m.remotepath && extensionOf(m.from_uid) === from)
        .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))[0];
      created = mine ? { id: mine.id } : null;
    } else {
      created = (await sendMessage({
        domain, user: from, destination, message: text, fromNumber,
      })) as { id?: string } | null;
    }

    // RingLogix returns the message's own id and it is the same id the
    // message carries when read back, so the person who sent it can be
    // attached to that exact message rather than inferred later.
    await recordSender({
      messageId: created?.id ?? "",
      sessionId,
      name: actor.name || actor.email,
      email: actor.email,
    });

    console.log(
      `[${file ? `mms ${file.type} ${file.size}b` : "sms"}] ${actor.email} replied to ${destination} from extension ${from || "(none)"}` +
      `${fromNumber ? ` as ${fromNumber}` : " (internal chat)"}`,
    );
    return NextResponse.json({ ok: true, destination, from, as: fromNumber ?? "" });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return ringlogixFailure(err);
  }
}

/** The refusals v2 gives a media send, in words somebody can act on. */
function mediaRefusal(err: unknown): NextResponse | null {
  if (!(err instanceof RingLogixError)) return null;
  if (err.status === 409) {
    return NextResponse.json({ error: "Everyone in this conversation has opted out (texted STOP), so nothing was sent." }, { status: 409 });
  }
  if (err.status === 415) {
    return NextResponse.json({ error: "The carrier won't take that kind of file. Try a picture (JPEG or PNG)." }, { status: 415 });
  }
  if (err.status === 400) {
    return NextResponse.json({ error: `RingLogix refused the attachment: ${err.reason || "no reason given"}` }, { status: 400 });
  }
  if (err.status === 413) {
    return NextResponse.json({ error: "That file is too large for RingLogix. Try a smaller picture." }, { status: 413 });
  }
  return null;
}
