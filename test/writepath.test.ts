import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { openSqliteStore, type Store } from "@imprint/store";
import { writeDraft } from "@/lib/documents";
import { authorised, tokenOf } from "@/lib/auth";

let store: Store;
beforeEach(() => { store = openSqliteStore(":memory:"); });

const request = (url: string, token?: string) =>
  new Request(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

describe("the shared write path", () => {
  it("derives the route from the type's template", () => {
    const result = writeDraft(store, {
      type: "integration",
      by: "test",
      data: {
        name: "Acme", slug: "acme", summary: "Does things.",
        logo: { id: "l", alt: "Acme", path: "/l.svg", absolutePath: "https://cdn/l.svg" },
        category: { _ref: "cat", _source: "cms" },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.document!.route).toBe("/integrations/acme");
  });

  it("refuses a document the schema rejects, and says which fields", () => {
    const result = writeDraft(store, { type: "integration", by: "test", data: { name: "Acme" } });
    expect(result.ok).toBe(false);
    expect(result.violations!.map((v) => v.path)).toEqual(
      expect.arrayContaining(["slug", "summary", "logo", "category"])
    );
  });

  it("refuses an unknown type rather than storing it", () => {
    const result = writeDraft(store, { type: "nope", by: "test", data: {} });
    expect(result.ok).toBe(false);
    expect(result.violations![0]!.message).toContain("unknown type 'nope'");
  });

  it("extracts refs on write, so the inbound index answers without a scan", () => {
    writeDraft(store, {
      id: "rel", type: "release", by: "test",
      data: {
        title: "2.4.0", version: "2-4-0", releasedAt: "2026-08-27T09:00:00.000Z",
        affects: [{ _ref: "/docs/v2/webhooks", _source: "git" }],
      },
    });
    store.publish("rel", "test");
    expect(store.inbound("/docs/v2/webhooks").map((d) => d.id)).toEqual(["rel"]);
  });

  it("writes the schema version the type currently declares", () => {
    const result = writeDraft(store, {
      type: "integration", by: "test",
      data: {
        name: "Acme", slug: "acme", summary: "Does things.",
        logo: { id: "l", alt: "Acme", path: "/l.svg", absolutePath: "https://cdn/l.svg" },
        category: { _ref: "cat", _source: "cms" },
      },
    });
    expect(result.document!.schemaVer).toBe(2);
  });

  it("rebuilds the route and refs when writing an older version forward", () => {
    const first = writeDraft(store, {
      id: "release-1",
      type: "release",
      by: "test",
      data: {
        title: "2.4.0",
        version: "first",
        releasedAt: "2026-08-27T09:00:00.000Z",
        affects: [{ _ref: "/docs/first", _source: "git" }],
      },
    });

    expect(first.ok).toBe(true);
    expect(first.document!.version).toBe(1);

    const second = writeDraft(store, {
      id: "release-1",
      type: "release",
      by: "test",
      expectedVersion: first.document!.version,
      data: {
        title: "2.4.0",
        version: "second",
        releasedAt: "2026-08-27T09:00:00.000Z",
        affects: [{ _ref: "/docs/second", _source: "git" }],
      },
    });

    expect(second.ok).toBe(true);
    expect(second.document!.version).toBe(2);
    expect(second.document!.route).toBe("/releases/second");

    const snapshot = store.version("release-1", 1);
    expect(snapshot).not.toBeNull();

    const reverted = writeDraft(store, {
      id: "release-1",
      type: "release",
      by: "test",
      expectedVersion: second.document!.version,
      data: snapshot!.data,
    });

    expect(reverted.ok).toBe(true);
    expect(reverted.document!.version).toBe(3);
    expect(reverted.document!.route).toBe("/releases/first");
  });
});

describe("the write and draft-read guard", () => {
  const OLD = process.env.IMPRINT_TOKEN;
  beforeEach(() => { process.env.IMPRINT_TOKEN = "secret"; });
  afterAll(() => { process.env.IMPRINT_TOKEN = OLD; });

  it("reads the token from a bearer header or the query string", () => {
    expect(tokenOf(request("http://x/api", "abc"))).toBe("abc");
    expect(tokenOf(request("http://x/api?token=abc"))).toBe("abc");
    expect(tokenOf(request("http://x/api"))).toBeNull();
  });

  it("accepts only the configured token", () => {
    expect(authorised(request("http://x/api", "secret"))).toBe(true);
    expect(authorised(request("http://x/api", "wrong"))).toBe(false);
    expect(authorised(request("http://x/api"))).toBe(false);
  });

  it("refuses everything when no token is configured, rather than letting everything through", () => {
    delete process.env.IMPRINT_TOKEN;
    expect(authorised(request("http://x/api", "anything"))).toBe(false);
  });
});