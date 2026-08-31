import { test } from "node:test";
import assert from "node:assert/strict";

import { jsonLdTypes, parseHtml } from "../src/checks/html.js";

const PAGE = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>Widgets &amp; Co. &#8212; Home</title>
  <meta name="description" content="We sell widgets.">
  <meta name="robots" content="index, follow, max-snippet:-1">
  <meta property="og:title" content="Widgets &amp; Co.">
  <meta property="og:image" content="https://x.test/og.png">
  <link rel="canonical" href="https://x.test/">
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS">
  <link rel="alternate" type="text/markdown" href="/index.md">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Widgets"}</script>
  <script type="application/ld+json">{ not valid json }</script>
</head>
<body>...</body>
</html>`;

test("parseHtml extracts title with entities decoded", () => {
  const meta = parseHtml(PAGE);
  assert.equal(meta.title, "Widgets & Co. — Home");
});

test("parseHtml reads lang, charset and canonical", () => {
  const meta = parseHtml(PAGE);
  assert.equal(meta.lang, "en-GB");
  assert.equal(meta.charset, "utf-8");
  assert.equal(meta.canonical, "https://x.test/");
});

test("parseHtml indexes meta by name and property", () => {
  const meta = parseHtml(PAGE);
  assert.equal(meta.metaByName.get("description"), "We sell widgets.");
  assert.equal(meta.metaByName.get("robots"), "index, follow, max-snippet:-1");
  assert.equal(meta.metaByProperty.get("og:title"), "Widgets & Co.");
});

test("parseHtml separates feeds from other alternates", () => {
  const meta = parseHtml(PAGE);
  assert.equal(meta.feeds.length, 1);
  assert.equal(meta.feeds[0]?.type, "application/rss+xml");
  assert.ok(meta.alternates.some((a) => a.type === "text/markdown"));
});

test("parseHtml counts every ld+json block but only keeps parseable ones", () => {
  const meta = parseHtml(PAGE);
  assert.equal(meta.jsonLdBlocks, 2);
  assert.equal(meta.jsonLd.length, 1);
  assert.deepEqual(jsonLdTypes(meta.jsonLd), ["Organization"]);
});

test("jsonLdTypes walks arrays and @graph", () => {
  const blocks = [
    [{ "@type": "BreadcrumbList" }],
    { "@graph": [{ "@type": "Article" }, { "@type": ["NewsArticle", "Report"] }] },
  ];
  assert.deepEqual(jsonLdTypes(blocks).sort(), [
    "Article",
    "BreadcrumbList",
    "NewsArticle",
    "Report",
  ]);
});

test("parseHtml on a fragment with no head still works", () => {
  const meta = parseHtml("<title>Bare</title><p>hi</p>");
  assert.equal(meta.title, "Bare");
  assert.equal(meta.canonical, null);
});
