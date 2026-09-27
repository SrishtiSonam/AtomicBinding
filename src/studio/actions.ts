"use server";

// Server actions are the studio's write path. The token never reaches the browser —
// this is the seam a real auth provider slots into: replace `actor()` and everything
// above it is unchanged.

import { revalidatePath } from "next/cache";
import { validateDocument, type Violation } from "@imprint/schema";
import { ConflictError, openStore, RouteConflictError } from "@imprint/store";
import { newId, writeDraft } from "@/lib/documents";
import { registry } from "~/schema";

function actor(): string {
  // Bought, not built. Until then, one editor.
  return "studio";
}

export interface ActionResult {
  ok: boolean;
  id?: string;
  version?: number;
  error?: string;
  violations?: Violation[];
  /** Set on a 409 so the studio can offer "view their changes / overwrite". */
  conflict?: { expected: number; actual: number; updatedBy: string };
  /** Set when unpublishing is blocked by inbound links. */
  holders?: { id: string; title: string; route: string | null }[];
}

export async function saveDraft(input: {
  id: string;
  type: string;
  data: Record<string, unknown>;
  version?: number;
}): Promise<ActionResult> {
  try {
    const result = writeDraft(openStore(), {
      id: input.id,
      type: input.type,
      data: input.data,
      by: actor(),
      ...(input.version !== undefined ? { expectedVersion: input.version } : {}),
    });

    if (!result.ok) return { ok: false, error: "This does not satisfy the schema yet.", violations: result.violations };

    revalidatePath("/studio", "layout");
    return { ok: true, id: result.document!.id, version: result.document!.version };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        error: error.message,
        conflict: { expected: error.expected, actual: error.actual, updatedBy: error.updatedBy },
      };
    }
    return { ok: false, error: (error as Error).message };
  }
}

export async function createDocument(type: string, data: Record<string, unknown>): Promise<ActionResult> {
  return saveDraft({ id: newId(), type, data });
}

export async function publishDocument(id: string): Promise<ActionResult> {
  const store = openStore();
  const draft = store.get(id, "draft");
  if (!draft) return { ok: false, error: "There is no draft to publish." };

  const def = registry.documents[draft.type];
  if (def) {
    const result = validateDocument(def, draft.data, registry);
    if (!result.ok) {
      return { ok: false, error: "Fix these before publishing.", violations: result.violations };
    }
  }

  try {
    const published = store.publish(id, actor());
    revalidatePath("/", "layout");
    revalidatePath("/studio", "layout");
    return { ok: true, id, version: published.version };
  } catch (error) {
    if (error instanceof RouteConflictError) {
      return { ok: false, error: `${error.message}. Change the slug, or unpublish the other one first.` };
    }
    return { ok: false, error: (error as Error).message };
  }
}

export async function unpublishDocument(id: string, force = false): Promise<ActionResult> {
  const store = openStore();
  const published = store.get(id, "published");
  if (!published) return { ok: false, error: "It is not published." };

  const holders = published.route ? store.inbound(published.route) : [];
  if (holders.length && !force) {
    return {
      ok: false,
      error:
        `${holders.length} published document(s) link to ${published.route}. ` +
        `Publish a redirect first, or unpublish anyway.`,
      holders: holders.map((h) => ({
        id: h.id,
        title: String(h.data[registry.documents[h.type]?.titleField ?? "title"] ?? h.id),
        route: h.route,
      })),
    };
  }

  store.unpublish(id);
  revalidatePath("/", "layout");
  revalidatePath("/studio", "layout");
  return { ok: true, id };
}

export async function revertDocument(id: string, version: number): Promise<ActionResult> {
  try {
    const store = openStore();
    const snapshot = store.version(id, version);

    if (!snapshot) {
      return { ok: false, error: `${id} has no version ${version}` };
    }

    const draft = store.get(id, "draft");
    if (!draft) {
      return { ok: false, error: `${id} has no draft to revert` };
    }

    const result = writeDraft(store, {
      id,
      type: draft.type,
      data: snapshot.data,
      by: actor(),
      expectedVersion: draft.version,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: "This does not satisfy the schema yet.",
        violations: result.violations,
      };
    }

    revalidatePath("/studio", "layout");
    return { ok: true, id, version: result.document!.version };
  } catch (error) {
    if (error instanceof ConflictError) {
      return {
        ok: false,
        error: error.message,
        conflict: {
          expected: error.expected,
          actual: error.actual,
          updatedBy: error.updatedBy,
        },
      };
    }

    return { ok: false, error: (error as Error).message };
  }
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  const store = openStore();
  const document = store.get(id, "draft") ?? store.get(id, "published");
  if (!document) return { ok: false, error: "Already gone." };

  // Block on inbound references. No cascade, no silent orphan: deleting something three
  // documents point at is a decision, not an accident.
  const holders = document.route ? store.inbound(document.route) : [];
  const byId = store.inbound(id);
  const all = [...holders, ...byId];

  if (all.length) {
    return {
      ok: false,
      error: `${all.length} document(s) reference this. Remove those references first.`,
      holders: all.map((h) => ({
        id: h.id,
        title: String(h.data[registry.documents[h.type]?.titleField ?? "title"] ?? h.id),
        route: h.route,
      })),
    };
  }

  store.remove(id);
  revalidatePath("/studio", "layout");
  return { ok: true, id };
}
