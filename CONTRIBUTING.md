# Contributing

Thanks for taking a look.

## Setup

```bash
npm install     # installs devDeps and runs an initial build
npm test        # tsc + node --test
npm run typecheck
```

Node 20+ is required. There are no runtime dependencies and the intent is to keep
it that way — the only `dependencies` entry should stay empty.

## Layout

| Path | What |
| --- | --- |
| `src/cli.ts` | argument parsing, exit codes |
| `src/index.ts` | programmatic API (`scan`) and re-exports |
| `src/fetcher.ts` | redirect-following fetch with a hop chain, timeout, capped body |
| `src/report.ts` | `Report` / `Finding` types, text + JSON renderers |
| `src/checks/headers.ts` | security-header check |
| `src/checks/aiReadiness.ts` | robots / sitemap / llms.txt / metadata check |
| `src/checks/*.ts` | shared parsers (`robots.ts`, `html.ts`) and helpers |
| `test/` | `node --test` suites; `test/helpers.ts` builds an in-memory `CheckContext` |

## Adding a finding

1. Emit it from a check via the `Findings` helper: `ok` / `fail` are graded (they
   move the section score), `note` is informational.
2. Give it a stable `id` (`headers/...` or `ai/...`), a one-line `title`, a
   `detail` describing what was observed, and — for anything actionable — a
   `remediation` and a `ref` URL.
3. Add or extend a test in `test/checks.test.ts` using `makeFakeContext`.

Keep severities honest: `high` = exploitable or plaintext exposure, `medium` =
missing standard control, `low` = hardening gap, `info` = FYI / outside the
site's control.

## Pull requests

- One topic per PR.
- `npm test` must pass; add coverage for new behaviour.
- Update `CHANGELOG.md` under `[Unreleased]`.
