import { NextRequest, NextResponse } from "next/server";
import { requirePageAccess } from "@/lib/api-auth";
import { appOrigin } from "@/lib/app-origin";
import { providerById } from "@/lib/integrations/catalog";
import {
  deleteIntegration, getIntegration, listEvents, patchIntegration, sealSecret, secretOf, toView,
} from "@/lib/integrations/store";
import { newHookToken } from "@/lib/integrations/crypto";
import { deliver, syncIntegration, testIntegration } from "@/lib/integrations/engine";
import { PAGE, refuse, splitValues } from "@/lib/integrations/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    await requirePageAccess(PAGE);
    const { id } = await params;
    const row = await getIntegration(id);
    if (!row) return NextResponse.json({ error: "That integration no longer exists." }, { status: 404 });
    return NextResponse.json({ integration: toView(row), events: await listEvents(id) });
  } catch (err) {
    return refuse(err);
  }
}

/**
 * Changes to one integration, by `do`:
 *   update      - name, settings, credential (blank secret keeps the old one)
 *   enable / disable
 *   test        - prove the credential works; changes nothing elsewhere
 *   sync        - bring its contacts in now
 *   send_test   - outgoing webhook: post a sample event
 *   new_hook_url - incoming webhook: replace its URL (the old one stops working)
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const actor = await requirePageAccess(PAGE);
    const { id } = await params;
    const row = await getIntegration(id);
    if (!row) return NextResponse.json({ error: "That integration no longer exists." }, { status: 404 });
    const provider = providerById(row.provider);
    const body = (await req.json().catch(() => ({}))) as { do?: string; name?: string; values?: Record<string, unknown> };

    switch (body.do) {
      case "update": {
        if (!provider) return NextResponse.json({ error: "Unknown integration." }, { status: 400 });
        const { config, secret } = splitValues(provider, body.values ?? {}, { config: row.config, secret: secretOf(row) });
        const updated = await patchIntegration(id, {
          name: String(body.name ?? row.name).trim().slice(0, 80) || provider.label,
          config,
          secret: sealSecret(secret),
        });
        return NextResponse.json({ integration: updated && toView(updated) });
      }
      case "enable":
      case "disable": {
        const updated = await patchIntegration(id, { enabled: body.do === "enable" });
        return NextResponse.json({ integration: updated && toView(updated) });
      }
      case "test":
        return NextResponse.json(await testIntegration(row));
      case "sync":
        console.log(`[integrations] ${actor.email} synced ${row.provider} (${id}) by hand`);
        return NextResponse.json(await syncIntegration(row));
      case "send_test": {
        if (row.provider !== "webhook_out") return NextResponse.json({ error: "Only an outgoing webhook sends events." }, { status: 400 });
        return NextResponse.json(await deliver(row, "test", {
          message: "A test event from Atlantis Portal. Nothing happened; this checks the connection.",
          sentBy: actor.name || actor.email,
        }));
      }
      case "new_hook_url": {
        if (row.provider !== "webhook_in") return NextResponse.json({ error: "Only an incoming webhook has a URL." }, { status: 400 });
        const hook = newHookToken();
        await patchIntegration(id, { hook_token_hash: hook.hash });
        return NextResponse.json({ hookUrl: `${appOrigin(req)}/api/hooks/${hook.token}` });
      }
      default:
        return NextResponse.json({ error: "Unknown change." }, { status: 400 });
    }
  } catch (err) {
    return refuse(err);
  }
}

/** Disconnects it, and removes what it brought in. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const actor = await requirePageAccess(PAGE);
    const { id } = await params;
    await deleteIntegration(id);
    console.log(`[integrations] ${actor.email} removed ${id}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return refuse(err);
  }
}
