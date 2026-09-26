// POST /api/content/:id/unpublish — remove the published row; the draft survives.

import { NextResponse } from "next/server";
import { openStore } from "@imprint/store";
import { guard } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;

  const { id } = await params;
  const store = openStore();
  const published = store.get(id, "published");
  if (!published) return NextResponse.json({ error: "not published" }, { status: 404 });

  // Who links here? Answered from the index, so unpublishing is a decision rather than
  // an accident. The caller may proceed with ?force=1.
  const holdersByRoute = published.route ? store.inbound(published.route) : [];
  const holdersById = store.inbound(id);
  const holders = [...new Map(
    [...holdersByRoute, ...holdersById].map((holder) => [holder.id, holder])
  ).values()];
  const force = new URL(request.url).searchParams.get("force") === "1";

  if (holders.length > 0 && !force) {
    return NextResponse.json(
      {
        error: "inbound links",
        detail: `${holders.length} published document(s) reference ${published.route}. ` +
          `Publish a redirect first, or repeat with ?force=1.`,
        holders: holders.map((h) => ({ id: h.id, type: h.type, route: h.route })),
      },
      { status: 409 }
    );
  }

  store.unpublish(id);
  return NextResponse.json({ ok: true, unpublished: id, ignoredInbound: holders.length });
}