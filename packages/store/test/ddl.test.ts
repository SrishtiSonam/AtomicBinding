import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DDL } from "@imprint/store";

/** The driver inlines its DDL so nothing has to resolve a .sql path at runtime. That
 *  makes schema.sql a second copy — so assert the two never diverge. */
const normalise = (sql: string) =>
  sql
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

describe("the SQLite DDL", () => {
  it("matches packages/store/src/schema.sql", () => {
    const file = readFileSync("packages/store/src/schema.sql", "utf8");
    expect(normalise(DDL)).toBe(normalise(file));
  });

  it("declares the partial unique index that makes a route collision a DB error", () => {
    expect(normalise(DDL)).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS doc_route_published ON document (route) WHERE variant = 'published' AND route IS NOT NULL"
    );
  });
});
