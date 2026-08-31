import { test } from "node:test";
import assert from "node:assert/strict";

import {
  atOrigin,
  InvalidTargetError,
  normalizeTarget,
  originOf,
  toHttp,
  withMdExtension,
} from "../src/util/url.js";

test("normalizeTarget adds https:// to a bare host", () => {
  assert.equal(normalizeTarget("example.com").toString(), "https://example.com/");
});

test("normalizeTarget keeps an explicit scheme", () => {
  assert.equal(normalizeTarget("http://example.com").protocol, "http:");
});

test("normalizeTarget rejects non-http(s) schemes", () => {
  assert.throws(() => normalizeTarget("ftp://example.com"), InvalidTargetError);
});

test("normalizeTarget rejects junk", () => {
  assert.throws(() => normalizeTarget("not a url"), InvalidTargetError);
  assert.throws(() => normalizeTarget("   "), InvalidTargetError);
});

test("originOf / atOrigin drop the path", () => {
  const u = normalizeTarget("https://example.com/a/b?c=1");
  assert.equal(originOf(u), "https://example.com");
  assert.equal(atOrigin(u, "/robots.txt"), "https://example.com/robots.txt");
});

test("toHttp downgrades the scheme only", () => {
  assert.equal(toHttp(normalizeTarget("https://example.com/x")), "http://example.com/x");
});

test("withMdExtension appends .md to extensionless paths", () => {
  assert.equal(
    withMdExtension(new URL("https://example.com/docs/guide")),
    "https://example.com/docs/guide.md",
  );
});

test("withMdExtension declines roots, slashes and existing extensions", () => {
  assert.equal(withMdExtension(new URL("https://example.com/")), null);
  assert.equal(withMdExtension(new URL("https://example.com/docs/")), null);
  assert.equal(withMdExtension(new URL("https://example.com/a.html")), null);
  assert.equal(withMdExtension(new URL("https://example.com/a.md")), null);
});
