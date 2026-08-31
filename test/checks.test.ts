import { test } from "node:test";
import assert from "node:assert/strict";

import { checkHeaders } from "../src/checks/headers.js";
import { checkAiReadiness } from "../src/checks/aiReadiness.js";
import { ids, makeFakeContext, severityOf, finding } from "./helpers.js";

// --- security headers -------------------------------------------------------

test("headers: bare HTTPS site fails every graded check", async () => {
  const ctx = makeFakeContext({
    target: "https://bare.test/",
    main: { headers: { "content-type": "text/html" } },
    routes: { "http://bare.test/": { status: 200 } },
  });
  const section = await checkHeaders(ctx);

  assert.equal(severityOf(section, "headers/hsts"), "medium");
  assert.equal(severityOf(section, "headers/csp"), "medium");
  assert.equal(severityOf(section, "headers/clickjacking"), "medium");
  assert.equal(severityOf(section, "headers/x-content-type-options"), "low");
  assert.equal(severityOf(section, "headers/referrer-policy"), "low");
  assert.equal(severityOf(section, "headers/http-redirect"), "high"); // answers over http
  assert.equal(section.score?.passed, 0);
});

test("headers: hardened site passes the graded checks", async () => {
  const ctx = makeFakeContext({
    target: "https://safe.test/",
    main: {
      headers: {
        "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
        "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "geolocation=()",
      },
    },
    routes: { "http://safe.test/": { status: 301, headers: { location: "https://safe.test/" } } },
  });
  const section = await checkHeaders(ctx);

  assert.equal(severityOf(section, "headers/hsts"), "pass");
  assert.equal(severityOf(section, "headers/csp"), "pass");
  assert.equal(severityOf(section, "headers/clickjacking"), "pass");
  assert.equal(severityOf(section, "headers/x-content-type-options"), "pass");
  assert.equal(severityOf(section, "headers/referrer-policy"), "pass");
  assert.equal(severityOf(section, "headers/http-redirect"), "pass");
  assert.equal(section.score?.passed, section.score?.graded);
});

test("headers: plain-http target reports one high finding and stops", async () => {
  const ctx = makeFakeContext({ target: "http://insecure.test/", main: {} });
  const section = await checkHeaders(ctx);
  assert.equal(severityOf(section, "headers/https"), "high");
  assert.ok(!ids(section).has("headers/hsts"));
});

test("headers: short HSTS max-age is flagged low", async () => {
  const ctx = makeFakeContext({
    target: "https://safe.test/",
    main: { headers: { "strict-transport-security": "max-age=600" } },
  });
  const section = await checkHeaders(ctx);
  const hsts = finding(section, "headers/hsts");
  assert.equal(hsts?.severity, "low");
  assert.match(hsts?.detail ?? "", /600/);
});

test("headers: insecure cookies are called out", async () => {
  const ctx = makeFakeContext({
    target: "https://safe.test/",
    main: {
      headers: {
        "set-cookie": ["sid=abc; Path=/", "ok=1; Path=/; Secure; HttpOnly; SameSite=Lax"],
      },
    },
  });
  const section = await checkHeaders(ctx);
  const cookies = finding(section, "headers/cookies");
  assert.equal(cookies?.severity, "medium");
  assert.match(cookies?.detail ?? "", /sid: missing Secure, HttpOnly, SameSite/);
});

test("headers: wildcard CORS with credentials is high", async () => {
  const ctx = makeFakeContext({
    target: "https://api.test/",
    main: {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
      },
    },
  });
  const section = await checkHeaders(ctx);
  assert.equal(severityOf(section, "headers/cors"), "high");
});

// --- AI readiness ---------------------------------------------------------

const RICH_HTML = `<!doctype html><html lang="en"><head>
<title>Rich</title>
<meta name="description" content="A well described page about things.">
<link rel="canonical" href="https://rich.test/">
<script type="application/ld+json">{"@type":"WebSite","name":"Rich"}</script>
</head><body>hi</body></html>`;

const RICH_ROBOTS = `User-agent: *
Allow: /

User-agent: GPTBot
Disallow: /

Sitemap: https://rich.test/sitemap.xml
`;

test("ai: a fully-equipped site scores 10/10", async () => {
  const ctx = makeFakeContext({
    target: "https://rich.test/",
    main: {
      headers: {
        "content-type": "text/html; charset=utf-8",
        etag: '"abc123"',
        link: '</index.md>; rel="alternate"; type="text/markdown"',
      },
      body: RICH_HTML,
    },
    routes: {
      "/robots.txt": { headers: { "content-type": "text/plain" }, body: RICH_ROBOTS },
      "/sitemap.xml": {
        headers: { "content-type": "application/xml" },
        body: "<urlset><url><loc>https://rich.test/</loc></url></urlset>",
      },
      "/llms.txt": {
        headers: { "content-type": "text/markdown" },
        body: "# Rich\n\n> A rich site.\n\n## Docs\n- [Guide](https://rich.test/guide)\n",
      },
    },
  });
  const section = await checkAiReadiness(ctx);

  assert.equal(section.score?.passed, 10);
  assert.equal(section.score?.graded, 10);
  assert.equal(severityOf(section, "ai/robots"), "pass");
  assert.equal(severityOf(section, "ai/sitemap"), "pass");
  assert.equal(severityOf(section, "ai/llms-txt"), "pass");
  assert.equal(severityOf(section, "ai/markdown"), "pass");
  assert.equal(severityOf(section, "ai/structured-data"), "pass");

  const crawlers = finding(section, "ai/ai-crawlers");
  assert.match(crawlers?.detail ?? "", /GPTBot\s+blocked/);
});

test("ai: a bare site fails the readiness checks at low/info", async () => {
  const ctx = makeFakeContext({
    target: "https://bare.test/",
    main: { headers: { "content-type": "text/html" }, body: "<title>Bare</title>" },
  });
  const section = await checkAiReadiness(ctx);

  assert.equal(severityOf(section, "ai/robots"), "low");
  assert.equal(severityOf(section, "ai/sitemap"), "low");
  assert.equal(severityOf(section, "ai/llms-txt"), "info");
  assert.equal(severityOf(section, "ai/markdown"), "info");
  assert.equal(severityOf(section, "ai/conditional"), "low");
  assert.equal(severityOf(section, "ai/structured-data"), "info");
  assert.equal(severityOf(section, "ai/meta-title"), "pass"); // it does have a <title>
});

test("ai: robots.txt served as HTML is a medium finding", async () => {
  const ctx = makeFakeContext({
    target: "https://x.test/",
    main: { body: "<title>x</title>" },
    routes: {
      "/robots.txt": {
        headers: { "content-type": "text/html" },
        body: "<!doctype html><html><body>404</body></html>",
      },
    },
  });
  const section = await checkAiReadiness(ctx);
  assert.equal(severityOf(section, "ai/robots"), "medium");
});

test("ai: llms.txt present but off-spec is low", async () => {
  const ctx = makeFakeContext({
    target: "https://x.test/",
    main: { body: "<title>x</title>" },
    routes: {
      "/llms.txt": { headers: { "content-type": "text/plain" }, body: "just some notes\nno structure\n" },
    },
  });
  const section = await checkAiReadiness(ctx);
  assert.equal(severityOf(section, "ai/llms-txt"), "low");
});
