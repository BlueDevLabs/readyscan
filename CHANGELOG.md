# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-31

Initial release.

### Added

- `headers` command: HSTS, CSP (with weak-directive detection), clickjacking
  protection, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
  cross-origin isolation headers, `Set-Cookie` flags, CORS (wildcard-with-credentials
  and reflected `Origin`), information disclosure, and deprecated headers. Includes an
  `http://` → `https://` upgrade probe.
- `ai-readiness` command: `robots.txt`, allow/block state for ~20 known AI crawler
  tokens, XML sitemap discovery and shape, `llms.txt` / `llms-full.txt`, Markdown
  content negotiation (`Accept`, `.md`, `rel="alternate"`), conditional-request and
  compression headers, `X-Robots-Tag`, and `<head>` metadata (title, description,
  canonical, `lang`, JSON-LD, `meta robots`, Open Graph, feeds).
- `all` command and a bare-URL default that runs both checks.
- Text and `--json` output; `--fail-on <level>` for CI gating (exit code `2`).
- Programmatic API: `scan()`, `renderText()`, `renderJson()`, `exceedsThreshold()`.
- Zero runtime dependencies; Node 20+.

[Unreleased]: https://github.com/BlueDevLabs/readyscan/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BlueDevLabs/readyscan/releases/tag/v0.1.0
