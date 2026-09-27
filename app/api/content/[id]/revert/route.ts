// POST /api/content/:id/revert — copy an old version forward as the current draft.

import { NextResponse } from "next/server";
import { openStore } from "@imprint/store";
import { DRAFT_HEADERS, guard } from "@/lib/auth";
import { writeDraft } from "@/lib/documents";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;

  const { id } = await params;
  const body = (await request.json()) as { version?: number };
  if (typeof body.version !== "number") {
    return NextResponse.json({ error: "version is required" }, { status: 400 });
  }

  try {
    const store = openStore();
    const snapshot = store.version(id, body.version);
    if (!snapshot) {
      return NextResponse.json({ error: `${id} has no version ${body.version}` }, { status: 404 });
    }

    const draft = store.get(id, "draft");
    if (!draft) {
      return NextResponse.json({ error: `${id} has no draft to revert` }, { status: 404 });
    }

    const result = writeDraft(store, {
      id,
      type: draft.type,
      data: snapshot.data,
      by: "studio",
      expectedVersion: draft.version,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.violations }, { status: 400 });
    }

    return NextResponse.json(result.document, { headers: DRAFT_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 404 });
  }
}