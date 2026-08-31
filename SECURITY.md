# Security policy

## Scope

readyscan makes outbound HTTP(S) requests to a URL you provide and to a handful
of well-known paths beneath its origin (`/robots.txt`, `/llms.txt`,
`/llms-full.txt`, `/sitemap.xml`, `/sitemap_index.xml`, a `.md` variant of the
target path, and the `http://` form of the target). It sends no request body,
follows redirects up to a configurable limit, and reads at most ~2 MB of each
response. It does not execute page scripts, store responses, or send data
anywhere other than the target site.

Only scan hosts you are authorised to test.

## Reporting a vulnerability

Email **contact@bluedevlabs.com** with details and, if possible, a reproduction.
Please do not open a public issue for security reports. You can expect an
acknowledgement within a few business days.

## Supported versions

This project is pre-1.0. Fixes land on the latest release only.
