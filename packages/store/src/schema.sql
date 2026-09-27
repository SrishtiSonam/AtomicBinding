-- SQLite. The shape mirrors postgres.sql exactly; only the types differ.

CREATE TABLE IF NOT EXISTS document (
  id          TEXT    NOT NULL,
  variant     TEXT    NOT NULL CHECK (variant IN ('draft', 'published')),
  type        TEXT    NOT NULL,
  route       TEXT,
  data        TEXT    NOT NULL,          -- JSON
  schema_ver  INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  updated_at  TEXT    NOT NULL,
  updated_by  TEXT    NOT NULL,
  PRIMARY KEY (id, variant)
);

-- Two published documents on one route is a DATABASE error, not a code bug.
CREATE UNIQUE INDEX IF NOT EXISTS doc_route_published
  ON document (route)
  WHERE variant = 'published' AND route IS NOT NULL;

CREATE INDEX IF NOT EXISTS doc_type_variant ON document (type, variant);
CREATE INDEX IF NOT EXISTS doc_list_sort ON document (variant, type, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS doc_list_sort_all ON document (variant, updated_at DESC, id ASC);

CREATE TABLE IF NOT EXISTS document_version (
  id          TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  data        TEXT    NOT NULL,
  schema_ver  INTEGER NOT NULL,
  created_at  TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  PRIMARY KEY (id, version)
);

-- The extracted reference index: "what points at X" without a full scan.
CREATE TABLE IF NOT EXISTS document_ref (
  document_id TEXT NOT NULL,
  variant     TEXT NOT NULL,
  target      TEXT NOT NULL,      -- the referenced id, or a route for git-owned targets
  target_source TEXT NOT NULL,
  field_path  TEXT NOT NULL,
  to_type     TEXT NOT NULL,
  PRIMARY KEY (document_id, variant, field_path)
);

CREATE INDEX IF NOT EXISTS doc_ref_target ON document_ref (target);
