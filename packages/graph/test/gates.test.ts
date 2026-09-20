import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildGraph, cmsAdapter, fsAdapter, inboundReport, runGates } from "@imprint/graph";
import { compile, extractLinks, extractRefs } from "@imprint/schema";
import { openSqliteStore, type Store } from "@imprint/store";
import { integrationGrid, registry } from "~/schema";

const ROOT = "packages/graph/test/fixtures";
const BY = "test";

let store: Store;

const put = (type: string, route: string | null, data: Record<string, unknown>, publish = true) => {
  const id = randomUUID();
  const def = registry.documents[type]!;
  store.save({
    id, type, route, data, schemaVer: def.schemaVersion, updatedBy: BY,
    refs: extractRefs(def.fields, data, registry),
  });
  if (publish) store.publish(id, BY);
  return id;
};

const build = (variant: "draft" | "published" = "published") =>
  buildGraph({
    adapters: [fsAdapter(), cmsAdapter(store, registry)],
    registry,
    variant,
    root: ROOT,
  });

beforeEach(() => {
  store = openSqliteStore(":memory:");
});

describe("the graph", () => {
  it("merges both sources into one shape, tagged but not branched on", async () => {
    put("marketingPage", "/pricing", {
      title: "Pricing", slug: "pricing",
      body: [{ _type: "hero", _key: "k1", heading: "Simple pricing" }],
    });

    const graph = await build();
    const sources = new Set(graph.nodes.map((n) => n.source));
    expect(sources).toEqual(new Set(["git", "cms"]));
    expect(graph.byRoute.get("/docs/ok")!.source).toBe("git");
    expect(graph.byRoute.get("/pricing")!.source).toBe("cms");

    // Every node carries the same fields regardless of where it came from.
    for (const node of graph.nodes) {
      expect(node).toHaveProperty("route");
      expect(node).toHaveProperty("blocks");
      expect(node).toHaveProperty("searchText");
    }
  });

  it("parses markdown directives into the same block instances the studio writes", async () => {
    const graph = await build();
    const page = graph.byRoute.get("/docs/ok")!;
    expect(page.blocks[0]!._type).toBe("richTextBlock");
    expect(page.blocks.every((b) => typeof b._key === "string" && b._key.length > 0)).toBe(true);
  });
});

describe("gate 1 · route uniqueness", () => {
  it("names both claimants when two documents want one route", async () => {
    put("marketingPage", "/twice", { title: "A", slug: "twice", body: [{ _type: "hero", _key: "k", heading: "A" }] });
    // A second published row on one route is refused by the store, so stage the
    // collision the only way it can actually happen: a git file and a CMS row.
    const graph = await build();
    graph.nodes.push({ ...graph.byRoute.get("/twice")!, id: "content/docs/twice.md", source: "git" });

    const report = runGates(graph, registry);
    const finding = report.findings.find((f) => f.gate === "route-uniqueness");
    expect(finding?.message).toMatch(/two documents claim '\/twice'/);
    expect(finding?.message).toContain("git:");
    expect(finding?.message).toContain("cms:");
  });

  it("fails a route claimed by the wrong source", async () => {
    // /docs is owned by git. A CMS row claiming it is structurally wrong.
    put("marketingPage", "/docs/sneaky", {
      title: "Sneaky", slug: "sneaky", body: [{ _type: "hero", _key: "k", heading: "hi" }],
    });

    const report = runGates(await build(), registry);
    expect(report.findings.some((f) => /owned by git, but a cms document claims it/.test(f.message))).toBe(true);
    expect(report.ok).toBe(false);
  });
});

describe("gate 2 · link integrity", () => {
  it("fails a broken internal link with from → to", async () => {
    const report = runGates(await build(), registry);
    const finding = report.findings.find((f) => f.gate === "link-integrity");
    expect(finding?.message).toContain("/docs/broken → /docs/does-not-exist");
  });
});

describe("gate 3 · reference resolution", () => {
  it("resolves a CROSS-SOURCE reference by route", async () => {
    const category = put("category", "/integrations/category/payments", { name: "Payments", slug: "payments" });
    put("integration", "/integrations/acme", {
      name: "Acme", slug: "acme", summary: "Pays things.",
      logo: { id: "l1", alt: "Acme", path: "/l.svg", absolutePath: "https://cdn/l.svg" },
      category: { _ref: category, _source: "cms" },
      docsEntry: { _ref: "/docs/ok", _source: "git" },
    });

    const graph = await build();
    const acme = graph.byRoute.get("/integrations/acme")!;
    const docsRef = acme.refs.find((r) => r.path === "docsEntry")!;

    expect(docsRef.missing).toBe(false);
    expect(docsRef.title).toBe("A fine page");
    expect(docsRef.route).toBe("/docs/ok");
  });

  it("fails a dangling reference, naming the field path and the holder", async () => {
    const category = put("category", "/integrations/category/payments", { name: "Payments", slug: "payments" });
    put("integration", "/integrations/ghost", {
      name: "Ghost", slug: "ghost", summary: "Points nowhere.",
      logo: { id: "l1", alt: "Ghost", path: "/l.svg", absolutePath: "https://cdn/l.svg" },
      category: { _ref: category, _source: "cms" },
      docsEntry: { _ref: "/docs/moved-away", _source: "git" },
    });

    const report = runGates(await build(), registry);
    const finding = report.findings.find((f) => f.gate === "reference-resolution");
    expect(finding?.message).toContain("docsEntry");
    expect(finding?.message).toContain("/docs/moved-away");
    expect(finding?.where.route).toBe("/integrations/ghost");
  });
});

describe("gate 4 · schema validity", () => {
  it("fails a document the current schema rejects, without crashing the build", async () => {
    put("marketingPage", "/bad", { title: "Bad", slug: "bad", body: [] }); // minCount 1

    const graph = await build();
    expect(graph.byRoute.get("/bad")).toBeDefined(); // it still loaded
    const report = runGates(graph, registry);
    expect(report.findings.some((f) => f.gate === "schema-validity")).toBe(true);
  });

  it("fails a document with an unregistered type in CMS store", async () => {
    const id = randomUUID();
    store.save({
      id,
      type: "deprecatedPageType",
      route: "/deprecated",
      data: { title: "Old Page" },
      schemaVer: 1,
      updatedBy: BY,
      refs: [],
    });
    store.publish(id, BY);

    const graph = await build();
    const node = graph.byId.get(id);
    expect(node).toBeDefined();
    expect(node?.violations).toHaveLength(1);
    expect(node?.violations[0]?.message).toContain("no document type 'deprecatedPageType' is registered");

    const report = runGates(graph, registry);
    const finding = report.findings.find((f) => f.gate === "schema-validity");
    expect(finding?.message).toContain("no document type 'deprecatedPageType' is registered");
    expect(report.ok).toBe(false);
  });
});

describe("gates 5 and 6 · bindings", () => {
  const good = compile(integrationGrid.binding!);

  it("passes a binding the schema agrees with", async () => {
    put("marketingPage", "/directory", {
      title: "Directory", slug: "directory",
      body: [{ _type: "integrationGrid", _key: "g1", heading: "All of them", _binding: good }],
    });

    const report = runGates(await build(), registry);
    expect(report.findings.filter((f) => f.gate === "binding-validity")).toHaveLength(0);
    expect(report.findings.filter((f) => f.gate === "binding-round-trip")).toHaveLength(0);
  });

  it("fails a stored path the feed does not declare", async () => {
    put("marketingPage", "/directory", {
      title: "Directory", slug: "directory",
      body: [{
        _type: "integrationGrid", _key: "g1",
        _binding: [{ source: "integrations.results.0.headline", target: "title" }],
      }],
    });

    const report = runGates(await build(), registry);
    const finding = report.findings.find((f) => f.gate === "binding-validity");
    expect(finding?.message).toContain("declares no path 'headline'");
  });

  it("fails a brand mismatch stored by hand", async () => {
    put("marketingPage", "/directory", {
      title: "Directory", slug: "directory",
      body: [{
        _type: "integrationGrid", _key: "g1",
        _binding: [{ source: "integrations.results.0.logo.path", target: "image" }],
      }],
    });

    const report = runGates(await build(), registry);
    const finding = report.findings.find((f) => f.gate === "binding-validity");
    expect(finding?.message).toContain("is imagePath, but prop 'image'");
    expect(finding?.message).toContain("is imageUrl");
  });

  it("fails rows the compiler cannot reproduce", async () => {
    put("marketingPage", "/directory", {
      title: "Directory", slug: "directory",
      body: [{
        _type: "integrationGrid", _key: "g1",
        _binding: [
          { source: "integrations.results.0.title", target: "title" },
          { source: "integrations.results.2.title", target: "title" },
        ],
      }],
    });

    const report = runGates(await build(), registry);
    expect(report.findings.some((f) => f.gate === "binding-round-trip")).toBe(true);
  });
});

describe("the inbound index", () => {
  it("counts who links here, by section, for the unpublish guard", async () => {
    const graph = await build();
    const report = inboundReport(graph, "/docs/other");
    expect(report.total).toBe(1);
    expect(report.bySection).toEqual({ docs: 1 });
  });
});
