import { NextRequest, NextResponse } from "next/server";
import { requirePageAccess } from "@/lib/api-auth";
import { appOrigin } from "@/lib/app-origin";
import { providerById } from "@/lib/integrations/catalog";
import { insertIntegration, listIntegrations, sealSecret } from "@/lib/integrations/store";
import { newHookToken } from "@/lib/integrations/crypto";
import { PAGE, refuse, splitValues } from "@/lib/integrations/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePageAccess(PAGE);
    return NextResponse.json({ integrations: await listIntegrations() });
  } catch (err) {
    return refuse(err);
  }
}

/**
 * Connects something new. For an incoming webhook the answer carries its
 * URL - the only time it is ever shown, since only its hash is kept.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePageAccess(PAGE);
    const body = (await req.json().catch(() => ({}))) as { provider?: string; name?: string; values?: Record<string, unknown> };
    const provider = providerById(String(body.provider ?? ""));
    if (!provider?.available) return NextResponse.json({ error: "That integration isn't available yet." }, { status: 400 });

    const { config, secret } = splitValues(provider, body.values ?? {}, { config: {}, secret: {} });
    const hook = provider.id === "webhook_in" ? newHookToken() : null;

    const row = await insertIntegration({
      provider: provider.id,
      name: String(body.name ?? "").trim().slice(0, 80) || provider.label,
      config,
      secret: sealSecret(secret),
      hookTokenHash: hook?.hash,
      createdByName: actor.name || actor.email,
      createdByEmail: actor.email,
    });
    console.log(`[integrations] ${actor.email} connected ${provider.id} (${row.id})`);
    return NextResponse.json(
      { id: row.id, hookUrl: hook ? `${appOrigin(req)}/api/hooks/${hook.token}` : null },
      { status: 201 },
    );
  } catch (err) {
    return refuse(err);
  }
}
