# Contributing to Imprint (AtomicBinding)

Thanks for taking a look — this guide covers how to get set up, how issues
are organised, and what a good PR looks like here. Please also read the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting set up

```bash
npm install                        # requires Node 22.5+
cp .env.example .env.local         # then set IMPRINT_TOKEN
npm run seed -- --reset --legacy   # sample content in ./data/imprint.db
npm run dev                        # site + studio on http://localhost:3100
```

Useful commands while you work:

| Command | What it does |
|---|---|
| `npm run doctor` | Sources, types, pending migrations, and gate status in one pass |
| `npm run gates` | Runs the six build gates; exits 1 on any failure |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Runs the vitest suite (65 tests) |
| `npm run migrate` | Dry-run migrations; add `--apply` to write |

Read `README.md` first, then `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` if
your issue touches the schema, the graph, or the gates — most bugs here trace
back to one of those three files.

## Finding an issue

Issues are labelled by difficulty:

- **Level 1** — docs, config, tooling, small self-contained fixes. Good
  first issues.
- **Level 2** — bugs or features that touch the schema, store, or graph
  packages and need you to understand how the write path or the gates work.

If you're taking part in **Open Source Connect India (OSCI)**, please only
claim one issue at a time so others get a fair shot. To claim an issue,
comment `/claim` on it. If it's not claimed already, you'll be auto-assigned;
issues go back up for grabs after 4 days of inactivity (see the automation
workflow in `.github/workflows`, once #6 lands).

Before starting:

1. Check the issue isn't already claimed or has an open PR against it.
2. If anything about the expected behaviour is unclear, ask on the issue
   before writing code — it's faster than a PR that solves the wrong
   problem.

## Making changes

- Keep PRs scoped to one issue. A PR that fixes a bug *and* refactors
  something unrelated is harder to review and more likely to get stuck.
- Match the existing style — this codebase favours small, explicit
  functions and avoids introducing new dependencies for something a few
  lines of TypeScript can do.
- If you touch `schema/` or `packages/schema`, run `npm run gates` — the
  six gates exist specifically to catch the kind of thing that would
  otherwise only show up as a blank page in production.
- Add or update a test in `test/` for any bug fix or new behavior. PRs that
  only touch behavior without a test are unlikely to be merged as-is.
- Run `npm run typecheck` and `npm test` before opening the PR.

## Commit messages and PR titles

This repo uses issue titles like `bug(store): ...` and `feat(automation):
...` — please follow the same `type(scope): summary` convention for your
PR title and, ideally, your commits (`fix`, `feat`, `docs`, `bug`, `chore`,
etc.), and reference the issue number (e.g. `Fixes #3`).

## Opening the PR

- Use the PR template — it asks for what changed, how you tested it, and
  which issue it closes.
- Link the issue with a closing keyword (`Fixes #2`) so it closes
  automatically on merge.
- Expect review comments — this is a learning-oriented repo, and feedback is
  meant to help, not gatekeep. Please be patient if a maintainer asks for
  changes.

## Questions

If something in this guide is out of date or unclear, please open an issue
using the "Documentation" template rather than guessing — it's likely other
contributors hit the same confusion.
