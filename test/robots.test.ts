import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRobots, verdictFor } from "../src/checks/robots.js";

const SAMPLE = `
# example policy
User-agent: *
Disallow: /admin/
Allow: /admin/public

User-agent: GPTBot
Disallow: /

User-agent: BadBot
User-agent: OtherBadBot
Disallow: /

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news.xml
`;

test("parseRobots collects groups and sitemaps", () => {
  const r = parseRobots(SAMPLE);
  assert.equal(r.sitemaps.length, 2);
  assert.equal(r.groups.length, 3);
  assert.deepEqual(r.groups[2]?.agents, ["badbot", "otherbadbot"]);
});

test("verdictFor: explicit full block", () => {
  const r = parseRobots(SAMPLE);
  assert.deepEqual(verdictFor(r, "GPTBot"), { verdict: "blocked", explicit: true });
});

test("verdictFor: shared group applies to every listed agent", () => {
  const r = parseRobots(SAMPLE);
  assert.equal(verdictFor(r, "OtherBadBot").verdict, "blocked");
});

test("verdictFor: falls back to the wildcard group", () => {
  const r = parseRobots(SAMPLE);
  const v = verdictFor(r, "ClaudeBot");
  assert.equal(v.explicit, false);
  assert.equal(v.verdict, "partial"); // wildcard disallows /admin/ but not /
});

test("verdictFor: no rules means allowed", () => {
  const r = parseRobots("User-agent: *\n");
  assert.deepEqual(verdictFor(r, "GPTBot"), { verdict: "allowed", explicit: false });
});

test("verdictFor: Disallow with an Allow: / is partial, not blocked", () => {
  const r = parseRobots("User-agent: GPTBot\nDisallow: /\nAllow: /\n");
  assert.equal(verdictFor(r, "GPTBot").verdict, "partial");
});

test("parseRobots ignores comments and blank lines", () => {
  const r = parseRobots("\n\n# just a comment\n   # indented comment\n");
  assert.equal(r.groups.length, 0);
  assert.equal(r.sitemaps.length, 0);
});
