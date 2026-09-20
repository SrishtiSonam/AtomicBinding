// The SQLite driver, on Node's built-in sqlite. Zero install, and it enforces the same
// partial unique index Postgres does, so route collisions fail identically in dev.

import { DatabaseSync } from "./sqlite-runtime";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  ConflictError, RouteConflictError,
  type DocumentVersion, type ListPage, type ListQuery, type SaveInput,
  type Store, type StoredDocument, type Variant,
} from "./driver";

/** Mirrors packages/store/src/schema.sql — asserted equal by test/ddl.test.ts. */
export const DDL = `
CREATE TABLE IF NOT EXISTS document (
  id          TEXT    NOT NULL,
  variant     TEXT    NOT NULL CHECK (variant IN ('draft', 'published')),
  type        TEXT    NOT NULL,
  route       TEXT,
  data        TEXT    NOT NULL,
  schema_ver  INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  updated_at  TEXT    NOT NULL,
  updated_by  TEXT    NOT NULL,
  PRIMARY KEY (id, variant)
);
CREATE UNIQUE INDEX IF NOT EXISTS doc_route_published
  ON document (route)
  WHERE variant = 'published' AND route IS NOT NULL;
CREATE INDEX IF NOT EXISTS doc_type_variant ON document (type, variant);
CREATE TABLE IF NOT EXISTS document_version (
  id          TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  data        TEXT    NOT NULL,
  schema_ver  INTEGER NOT NULL,
  created_at  TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS document_ref (
  document_id   TEXT NOT NULL,
  variant       TEXT NOT NULL,
  target        TEXT NOT NULL,
  target_source TEXT NOT NULL,
  field_path    TEXT NOT NULL,
  to_type       TEXT NOT NULL,
  PRIMARY KEY (document_id, variant, field_path)
);
CREATE INDEX IF NOT EXISTS doc_ref_target ON document_ref (target);
`;

interface Row {
  id: string; variant: string; type: string; route: string | null;
  data: string; schema_ver: number; version: number;
  updated_at: string; updated_by: string;
}

const hydrate = (row: Row): StoredDocument => ({
  id: row.id,
  variant: row.variant as Variant,
  type: row.type,
  route: row.route,
  data: JSON.parse(row.data) as Record<string, unknown>,
  schemaVer: Number(row.schema_ver),
  version: Number(row.version),
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
});

const encode = (cursor: { updatedAt: string; id: string }): string =>
  Buffer.from(`${cursor.updatedAt}|${cursor.id}`, "utf8").toString("base64url");

const decode = (cursor: string): { updatedAt: string; id: string } => {
  const [updatedAt = "", id = ""] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return { updatedAt, id };
};

export function openSqliteStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(DDL);

  const tx = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const selectOne = db.prepare("SELECT * FROM document WHERE id = ? AND variant = ?");
  const selectRoute = db.prepare("SELECT * FROM document WHERE route = ? AND variant = ?");

  const writeRefs = (id: string, variant: Variant, refs: SaveInput["refs"]) => {
    db.prepare("DELETE FROM document_ref WHERE document_id = ? AND variant = ?").run(id, variant);
    if (!refs?.length) return;
    const insert = db.prepare(
      `INSERT OR REPLACE INTO document_ref
         (document_id, variant, target, target_source, field_path, to_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ref of refs) insert.run(id, variant, ref._ref, ref._source, ref.path, ref.to);
  };

  const store: Store = {
    get(id, variant) {
      const row = selectOne.get(id, variant) as unknown as Row | undefined;
      return row ? hydrate(row) : null;
    },

    byRoute(route, variant) {
      const row = selectRoute.get(route, variant) as unknown as Row | undefined;
      return row ? hydrate(row) : null;
    },

    all(variant, type) {
      const rows = type
        ? db.prepare("SELECT * FROM document WHERE variant = ? AND type = ? ORDER BY id")
            .all(variant, type)
        : db.prepare("SELECT * FROM document WHERE variant = ? ORDER BY id").all(variant);
      return (rows as unknown as Row[]).map(hydrate);
    },

    list(query: ListQuery): ListPage {
      const limit = Math.min(query.limit ?? 25, 200);
      const clauses = ["variant = ?"];
      const params: (string | number)[] = [query.variant];

      if (query.type) { clauses.push("type = ?"); params.push(query.type); }
      if (query.cursor) {
        const { updatedAt, id } = decode(query.cursor);
        clauses.push("(updated_at < ? OR (updated_at = ? AND id > ?))");
        params.push(updatedAt, updatedAt, id);
      }

      const rows = db
        .prepare(
          `SELECT * FROM document WHERE ${clauses.join(" AND ")}
           ORDER BY updated_at DESC, id ASC LIMIT ?`
        )
        .all(...params, limit + 1) as unknown as Row[];

      const page = rows.slice(0, limit).map(hydrate);
      const last = page[page.length - 1];
      return {
        items: page,
        // No total count: an accurate one costs a full scan, and an inaccurate one is
        // worse than none.
        nextCursor: rows.length > limit && last ? encode({ updatedAt: last.updatedAt, id: last.id }) : null,
      };
    },

    save(input: SaveInput): StoredDocument {
      return tx(() => {
        const existing = selectOne.get(input.id, "draft") as unknown as Row | undefined;

        if (existing && input.expectedVersion !== undefined) {
          const actual = Number(existing.version);
          if (actual !== input.expectedVersion) {
            throw new ConflictError(input.id, input.expectedVersion, actual, existing.updated_by);
          }
        }

        const version = existing ? Number(existing.version) + 1 : 1;
        const updatedAt = new Date().toISOString();
        const data = JSON.stringify(input.data);

        db.prepare(
          `INSERT INTO document (id, variant, type, route, data, schema_ver, version, updated_at, updated_by)
           VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id, variant) DO UPDATE SET
             type = excluded.type, route = excluded.route, data = excluded.data,
             schema_ver = excluded.schema_ver, version = excluded.version,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`
        ).run(input.id, input.type, input.route, data, input.schemaVer, version, updatedAt, input.updatedBy);

        db.prepare(
          `INSERT OR REPLACE INTO document_version (id, version, data, schema_ver, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(input.id, version, data, input.schemaVer, updatedAt, input.updatedBy);

        writeRefs(input.id, "draft", input.refs);

        return hydrate(selectOne.get(input.id, "draft") as unknown as Row);
      });
    },

    publish(id, by) {
      return tx(() => {
        const draft = selectOne.get(id, "draft") as unknown as Row | undefined;
        if (!draft) throw new Error(`${id} has no draft to publish`);

        if (draft.route) {
          const holder = selectRoute.get(draft.route, "published") as unknown as Row | undefined;
          if (holder && holder.id !== id) throw new RouteConflictError(draft.route, holder.id);
        }

        const at = new Date().toISOString();
        db.prepare(
          `INSERT INTO document (id, variant, type, route, data, schema_ver, version, updated_at, updated_by)
           VALUES (?, 'published', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id, variant) DO UPDATE SET
             type = excluded.type, route = excluded.route, data = excluded.data,
             schema_ver = excluded.schema_ver, version = excluded.version,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`
        ).run(id, draft.type, draft.route, draft.data, draft.schema_ver, draft.version, at, by);

        db.prepare(
          `DELETE FROM document_ref WHERE document_id = ? AND variant = 'published'`
        ).run(id);
        db.prepare(
          `INSERT INTO document_ref (document_id, variant, target, target_source, field_path, to_type)
           SELECT document_id, 'published', target, target_source, field_path, to_type
           FROM document_ref WHERE document_id = ? AND variant = 'draft'`
        ).run(id);

        return hydrate(selectOne.get(id, "published") as unknown as Row);
      });
    },

    unpublish(id) {
      tx(() => {
        db.prepare("DELETE FROM document WHERE id = ? AND variant = 'published'").run(id);
        db.prepare("DELETE FROM document_ref WHERE document_id = ? AND variant = 'published'").run(id);
      });
    },

    remove(id) {
      tx(() => {
        db.prepare("DELETE FROM document WHERE id = ?").run(id);
        db.prepare("DELETE FROM document_ref WHERE document_id = ?").run(id);
        db.prepare("DELETE FROM document_version WHERE id = ?").run(id);
      });
    },

    versions(id): DocumentVersion[] {
      const rows = db
        .prepare("SELECT * FROM document_version WHERE id = ? ORDER BY version DESC")
        .all(id) as unknown as { id: string; version: number; data: string; schema_ver: number; created_at: string; created_by: string }[];
      return rows.map((row) => ({
        id: row.id,
        version: Number(row.version),
        data: JSON.parse(row.data) as Record<string, unknown>,
        schemaVer: Number(row.schema_ver),
        createdAt: row.created_at,
        createdBy: row.created_by,
      }));
    },

    revert(id, version, by) {
      const snapshot = db
        .prepare("SELECT * FROM document_version WHERE id = ? AND version = ?")
        .get(id, version) as unknown as { data: string; schema_ver: number } | undefined;
      if (!snapshot) throw new Error(`${id} has no version ${version}`);

      const draft = store.get(id, "draft");
      if (!draft) throw new Error(`${id} has no draft to revert`);

      return store.save({
        id,
        type: draft.type,
        route: draft.route,
        data: JSON.parse(snapshot.data) as Record<string, unknown>,
        schemaVer: Number(snapshot.schema_ver),
        updatedBy: by,
        expectedVersion: draft.version,
      });
    },

    inbound(target) {
      const rows = db
        .prepare(
          `SELECT d.* FROM document d
             JOIN document_ref r ON r.document_id = d.id AND r.variant = d.variant
            WHERE r.target = ? AND d.variant = 'published'
            GROUP BY d.id`
        )
        .all(target) as unknown as Row[];
      return rows.map(hydrate);
    },

    rewrite(type, apply, to, by, options) {
      return tx(() => {
        const rows = db
          .prepare("SELECT * FROM document WHERE type = ? ORDER BY id, variant")
          .all(type) as unknown as Row[];
        const changes: { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
        const at = new Date().toISOString();

        for (const row of rows) {
          const before = JSON.parse(row.data) as Record<string, unknown>;
          const after = apply(structuredClone(before));
          const encoded = JSON.stringify(after);

          let route = row.route;
          if (options?.computeRoute) {
            try {
              route = options.computeRoute(after);
            } catch {
              route = null;
            }
          }

          if (encoded === row.data && Number(row.schema_ver) === to && route === row.route) continue;

          db.prepare(
            "UPDATE document SET data = ?, route = ?, schema_ver = ?, updated_at = ?, updated_by = ? WHERE id = ? AND variant = ?"
          ).run(encoded, route, to, at, by, row.id, row.variant);

          if (options?.computeRefs) {
            const refs = options.computeRefs(after);
            writeRefs(row.id, row.variant as Variant, refs);
          }

          if (row.variant === "draft") {
            const version = Number(row.version) + 1;
            db.prepare("UPDATE document SET version = ? WHERE id = ? AND variant = 'draft'")
              .run(version, row.id);
            // A version row per document, so the migration is revertible.
            db.prepare(
              `INSERT OR REPLACE INTO document_version (id, version, data, schema_ver, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(row.id, version, encoded, to, at, by);
            changes.push({ id: row.id, before, after });
          }
        }
        return changes;
      });
    },

    close() {
      db.close();
    },
  };

  return store;
}
