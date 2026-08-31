# readyscan

[![npm](https://img.shields.io/npm/v/readyscan.svg)](https://www.npmjs.com/package/readyscan)
[![CI](https://github.com/BlueDevLabs/readyscan/actions/workflows/ci.yml/badge.svg)](https://github.com/BlueDevLabs/readyscan/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)

A small CLI that audits a URL from two angles:

- **`headers`** — the security-relevant HTTP response headers (HSTS, CSP, clickjacking protection, cookie flags, CORS, information disclosure, deprecated headers).
- **`ai-readiness`** — how legible the site is to crawlers and AI agents: `robots.txt`, AI crawler directives, XML sitemap, `llms.txt`, Markdown content negotiation, crawl-friendly headers, and `<head>` metadata.

One request path, a readable report, an optional JSON mode, and a `--fail-on` switch for CI. No runtime dependencies.

> **Scope.** readyscan reports what a single HTTP response and a handful of well-known files reveal. It is a first-pass linter, not a replacement for a full scanner (OWASP ZAP, Mozilla Observatory, `nuclei`) or for reading the specs.

## Quick start

Run it without installing (needs Node 20+):

```bash
npx readyscan all example.com
```

Or install it:

```bash
npm install -g readyscan
readyscan all example.com
```

## Usage

```
readyscan <command> <url> [options]

COMMANDS
  headers <url>        Security / HTTP response-header check
  ai-readiness <url>   robots.txt, llms.txt, sitemap, AI crawler directives,
                       Markdown negotiation, crawl headers, page metadata
  all <url>            Run every check (also the default for a bare URL)

OPTIONS
  --json                 Emit the full report as JSON
  --fail-on <level>      Exit 2 if any finding is >= level (high | medium | low)
  -A, --user-agent <ua>  Override the request User-Agent
  --timeout <ms>         Per-request timeout (default 15000)
  --max-redirects <n>    Redirect hops to follow (default 10)
  --no-color             Disable ANSI colour
  -h, --help             Show this help
  -v, --version          Print the version
```

### Example

```
$ readyscan all https://developer.mozilla.org

readyscan v0.1.0  •  https://developer.mozilla.org/
HTTP 200 OK  238ms
final  https://developer.mozilla.org/en-US/

-- Security headers --  score 5/5
   LOW   CSP contains weak directives
      Present: 'unsafe-inline'. These reduce the protection a CSP provides.
      see https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy
   PASS  HSTS set
      max-age=63072000
   PASS  Clickjacking protection present
      X-Frame-Options: DENY
   ...

-- AI readiness --  score 7/10
   LOW   No Open Graph tags
   INFO  AI crawler directives in robots.txt
      0/20 known AI crawlers are named explicitly; 0 blocked from "/".
      Reported as-is — the allow/block choice is the site owner's to make.
   PASS  robots.txt present
   PASS  Sitemap found
   PASS  JSON-LD structured data present
      3 block(s), types: Organization, WebSite, WebPage.
   ...

summary  3 low | 6 info | 12 pass
```

## What each check looks at

### `headers`

| Area | Findings |
| --- | --- |
| Transport | HTTPS in use, `http://` → `https://` upgrade, HSTS presence / `max-age` / `includeSubDomains` |
| Content | Content-Security-Policy presence and weak directives (`unsafe-inline`, `unsafe-eval`, wildcard sources) |
| Framing | `X-Frame-Options` or CSP `frame-ancestors` |
| Sniffing | `X-Content-Type-Options: nosniff` |
| Referrer | `Referrer-Policy` presence and value |
| Cookies | `Secure`, `HttpOnly`, `SameSite` on every `Set-Cookie` |
| CORS | wildcard `Access-Control-Allow-Origin` with credentials; reflected `Origin` |
| Isolation | `Permissions-Policy`, COOP / COEP / CORP (informational) |
| Disclosure | version-bearing `Server`, `X-Powered-By`, framework version headers |
| Deprecated | `X-XSS-Protection`, HPKP, `Expect-CT` |

The graded score covers the load-bearing checks (HSTS, http upgrade, CSP, framing, sniffing, referrer). Everything else is reported but not scored.

### `ai-readiness`

| Area | Findings |
| --- | --- |
| robots.txt | present, served as text, parseable, group and `Sitemap:` count |
| AI crawlers | current allow / block state for ~20 known AI crawler tokens (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, CCBot, Bytespider, …), reported without judgement |
| Sitemap | discoverable (from `robots.txt` or the usual paths), well-formed, URL / child count, referenced in `robots.txt` |
| llms.txt | present, Markdown (not HTML), follows the [llmstxt.org](https://llmstxt.org/) shape; `llms-full.txt` noted |
| Markdown | `Accept: text/markdown` negotiation, `/path.md` variant, `rel="alternate"` link |
| Crawl headers | `ETag` / `Last-Modified` for conditional requests, `Content-Encoding`, `X-Robots-Tag` |
| Metadata | `<title>`, meta description, canonical URL, `<html lang>`, JSON-LD types, `meta robots`, Open Graph, feed autodiscovery |

**On AI crawler directives:** readyscan shows you the policy your `robots.txt` currently expresses for each crawler. Whether to allow or block any of them is your call — the tool does not recommend one way or the other.

## CI usage

Both the text and JSON reports always print. Add `--fail-on` to turn findings into a non-zero exit (`2`) for a pipeline gate:

```yaml
# .github/workflows/site-audit.yml
name: site audit
on: [push]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx readyscan headers https://example.com --fail-on medium
```

Exit codes: `0` clean (or `--fail-on` not set), `1` bad usage / network error, `2` findings met the `--fail-on` threshold.

## Programmatic API

```ts
import { scan, renderText, exceedsThreshold } from "readyscan";

const report = await scan("example.com", { checks: ["ai-readiness"] });
console.log(renderText(report));

if (exceedsThreshold(report, "high")) process.exitCode = 2;
```

`scan()` returns a plain `Report` object (`target`, `finalUrl`, `http`, `sections[].findings[]`, `sections[].score`). See [`src/report.ts`](src/report.ts) for the types.

## What it does not do

- **No JavaScript rendering.** It reads the HTML the server sends, like most crawlers — not the DOM after hydration.
- **HTML is parsed with regular expressions**, not a real parser. Metadata extraction is best-effort.
- **One URL per run.** No crawling, no auth flows, no spidering a sitemap.
- **`robots.txt` matching is coarse** — it answers "may this crawler fetch `/`", not arbitrary path-pattern questions.
- **No opinion on crawler policy, TLS cipher suites, DNS, email (SPF/DMARC), or `.well-known/security.txt`.**

## Development

```bash
npm install        # installs devDeps and builds
npm run build      # tsc -> dist/
npm test           # build, then node --test
npm run typecheck  # tsc --noEmit
```

Sources in `src/`, tests in `test/`. The check modules are `src/checks/headers.ts` and `src/checks/aiReadiness.ts`; both take a `CheckContext` (a fetched page plus a fetcher) and return a scored `Section`.

## License

MIT — see [LICENSE](LICENSE).
