// The content service's storage contract.
//
// A document has AT MOST TWO ROWS: draft and published. There is no status flag anyone
// has to maintain, and "has unpublished changes" is a comparison, not a field.

export type Variant = "draft" | "published";

export interface StoredDocument {
  id: string;
  variant: Variant;
  type: string;
  /** Null for singletons and non-routable types. */
  route: string | null;
  data: Record<string, unknown>;
  /** The schema version this row was WRITTEN against, not the current one. */
  schemaVer: number;
  /** Monotonic per document. The optimistic lock compares against it. */
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface DocumentVersion {
  id: string;
  version: number;
  data: Record<string, unknown>;
  schemaVer: number;
  createdAt: string;
  createdBy: string;
}

export interface ListQuery {
  type?: string;
  variant: Variant;
  limit?: number;
  /** Opaque. Cursor pagination, because an accurate total costs a full scan and an
   *  inaccurate one is worse than none. */
  cursor?: string;
}

export interface ListPage {
  items: StoredDocument[];
  nextCursor: string | null;
}

export interface SaveInput {
  id: string;
  type: string;
  route: string | null;
  data: Record<string, unknown>;
  schemaVer: number;
  updatedBy: string;
  /** The version the editor loaded. Omit only when creating. */
  expectedVersion?: number;
  /** Flat list of every reference the document holds, for the inbound index. */
  refs?: { _ref: string; _source: string; path: string; to: string }[];
}

/** Thrown when another editor saved first. The API answers 409 with this. */
export class ConflictError extends Error {
  constructor(
    readonly id: string,
    readonly expected: number,
    readonly actual: number,
    readonly updatedBy: string
  ) {
    super(
      `${id} was saved by ${updatedBy} while you were editing ` +
        `(you loaded v${expected}, the draft is now v${actual})`
    );
    this.name = "ConflictError";
  }
}

/** Thrown when publishing would put two documents on one route. */
export class RouteConflictError extends Error {
  constructor(readonly route: string, readonly heldBy: string) {
    super(`route '${route}' is already published by document ${heldBy}`);
    this.name = "RouteConflictError";
  }
}

export interface RewriteOptions {
  /** Optional function to compute/derive refs for the rewritten document */
  computeRefs?: (data: Record<string, unknown>) => SaveInput["refs"];
  /** Optional function to compute the new route for the rewritten document */
  computeRoute?: (data: Record<string, unknown>) => string | null;
}

export interface Store {
  get(id: string, variant: Variant): StoredDocument | null;
  byRoute(route: string, variant: Variant): StoredDocument | null;
  list(query: ListQuery): ListPage;
  /** Every document of a type, unpaginated. For the graph build. */
  all(variant: Variant, type?: string): StoredDocument[];

  save(input: SaveInput): StoredDocument;
  publish(id: string, by: string): StoredDocument;
  unpublish(id: string): void;
  remove(id: string): void;

  versions(id: string): DocumentVersion[];
  revert(id: string, version: number, by: string): StoredDocument;

  /** Documents whose refs point at `target`. Powers the unpublish guard. */
  inbound(target: string): StoredDocument[];

  /** Rewrites data for every document of a type. Used by the migration runner. */
  rewrite(
    type: string,
    apply: (data: Record<string, unknown>) => Record<string, unknown>,
    to: number,
    by: string,
    options?: RewriteOptions
  ): { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[];

  close(): void;
}
