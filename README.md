# Imprint

A dual-source content platform. **Docs live in git; everything else lives in a CMS built
from scratch.** Both are normalised into one typed content graph that a single front end
renders from, and six build gates sit between that graph and production.

Next.js 15 · React 19 · TypeScript strict · zod · SQLite (Postgres DDL committed) · Node 22+

---

## Start here

```bash
cp .env.example .env.local     # then set IMPRINT_TOKEN
npm install
npm run seed -- --reset --legacy
npm run dev                    # site + studio on http://localhost:3100
```

| Where | What |
|---|---|
| <http://localhost:3100> | the site — docs from git, everything else from the CMS |
| <http://localhost:3100/studio> | the studio — forms generated from the schema |
| <http://localhost:3100/studio/health> | schema health and the six gates |

```bash
npm run gates      # the six build gates; exits 1 on any failure
npm run doctor     # sources, types, pending migrations, gates
npm run migrate    # dry run; --apply writes
npm test           # 65 tests
npm run typecheck
```

---

## The one idea

> **One definition per type is the sole source of truth for five consumers.**

A `defineDocument` or `defineBlock` call in `schema/` produces, from the same object:

1. a **zod validator** the store and the API write through,
2. an **editor manifest** the studio renders forms from,
3. the **delivery API's** shape,
4. the **render props** the React component types itself with, and
5. the input to the **build gates** that prove the other four still agree.

No codegen. Nothing to regenerate, so nothing can drift. Grep for any field name outside
`schema/` and the one component that renders it — you will not find it.

---

## Two authoring surfaces, one graph

```
   content/**/*.md                        the CMS  (SQLite / Postgres)
   engineers, in pull requests            marketers, in the studio
            │                                       │
       fs adapter                              cms adapter
   frontmatter + block directives          two-row model + zod
            └──────────────┬────────────────────────┘
                           ▼
                  ┌──────────────────┐
                  │  unified graph   │  source-tagged, reference-resolved
                  │     Node[]       │  route-indexed, link-extracted
                  └────────┬─────────┘
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        Next front end  six gates   delivery API
```

Nothing downstream branches on `source`. A page can move between git and the CMS and no
route code changes — which is exactly what the ownership manifest in `schema/index.ts`
exists to make safe.

---

## What is worth looking at

| File | Why |
|---|---|
| `packages/schema/src/binding.ts` | the binding compiler — typed authoring, flat storage, lossless round-trip |
| `packages/schema/src/defs.ts` | `defineDocument` / `defineBlock` / the registry / the ownership manifest |
| `packages/graph/src/gates.ts` | the six gates, each naming what you need to fix it |
| `packages/store/src/sqlite.ts` | the two-row draft/published model, optimistic locking, the inbound index |
| `schema/blocks/integrationGrid.ts` | a block whose cards come from a feed through a checked binding |
| `src/studio/FieldRenderer.tsx` | the one recursive renderer; a field type is one entry in a map |

---

## Bindings, the short version

A binding is stored as flat `{ source, target }` rows — that is the delivery format and
it cannot change. So the typed form is a **compilation target**, not a replacement:

```ts
bind(integrations, integrationCard)
  .replicate()
  .map({
    title: (i) => i.title,
    image: (i) => i.logo.absolutePath,   //   ImageUrl  →  ImageUrl   ✓
    href:  (i) => i.route,
  })
```

Both of these fail to compile:

```ts
image: (i) => i.logo.path      // ImagePath is not assignable to the ImageUrl prop 'image'
title: (i) => i.headline       // feed 'integrations' declares no path 'headline'
```

and `compile(decompile(rows)) === rows` is asserted for every shape the compiler emits,
so the typed form is safe to introduce over data you did not write.

---

## The gates

All six run in CI and turn a silent blank page into a named failure.

| Gate | Catches |
|---|---|
| Route uniqueness | two documents on one route; a route claimed by the wrong source |
| Link integrity | an internal link nothing answers to, with `from → to` |
| Reference resolution | a dangling reference, its field path and its holder |
| Schema validity | a document the current schema rejects — reported, not crashed |
| Binding validity | a source path the feed does not declare; a prop/brand mismatch |
| Binding round-trip | rows the compiler cannot reproduce |

They found two real defects in this repo's own seed content the first time they ran.

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how a URL becomes HTML, and where each decision lives
- [docs/SCHEMA.md](docs/SCHEMA.md) — the schema language: every field type, every rule, and why
- [docs/API.md](docs/API.md) — the delivery API
- [docs/DECISIONS.md](docs/DECISIONS.md) — the calls that are worth arguing about, and the reasoning

## Not built, on purpose

Auth (`src/lib/auth.ts` is the seam), a media pipeline, a rich-text editing surface
(the stored structure is ours; the editor is not), real-time multiplayer, i18n, and a
role matrix. Each is a real product; none of them is this one's thesis.
