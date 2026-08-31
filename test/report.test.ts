import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countBySeverity,
  exceedsThreshold,
  renderJson,
  renderText,
  worstSeverity,
  type Report,
} from "../src/report.js";
import { setColorEnabled } from "../src/util/color.js";

setColorEnabled(false);

function report(overrides: Partial<Report> = {}): Report {
  return {
    target: "https://x.test/",
    finalUrl: "https://x.test/",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    http: { status: 200, statusText: "OK", redirects: [], timingMs: 12 },
    tool: { name: "readyscan", version: "0.0.0" },
    sections: [
      {
        name: "Security headers",
        findings: [
          { id: "a", title: "A", severity: "high", detail: "bad" },
          { id: "b", title: "B", severity: "low", detail: "meh" },
          { id: "c", title: "C", severity: "pass", detail: "good" },
        ],
        score: { passed: 1, graded: 3 },
      },
    ],
    ...overrides,
  };
}

test("countBySeverity tallies every section", () => {
  assert.deepEqual(countBySeverity(report()), {
    high: 1,
    medium: 0,
    low: 1,
    info: 0,
    pass: 1,
  });
});

test("worstSeverity ignores order", () => {
  assert.equal(
    worstSeverity([
      { id: "x", title: "", severity: "pass", detail: "" },
      { id: "y", title: "", severity: "medium", detail: "" },
      { id: "z", title: "", severity: "low", detail: "" },
    ]),
    "medium",
  );
});

test("exceedsThreshold compares against the level, never triggered by pass", () => {
  const r = report();
  assert.equal(exceedsThreshold(r, "high"), true);
  assert.equal(exceedsThreshold(r, "medium"), true); // high >= medium
  const clean = report({
    sections: [{ name: "s", findings: [{ id: "p", title: "", severity: "pass", detail: "" }] }],
  });
  assert.equal(exceedsThreshold(clean, "low"), false);
});

test("renderJson round-trips", () => {
  const parsed = JSON.parse(renderJson(report())) as Report;
  assert.equal(parsed.sections[0]?.findings.length, 3);
  assert.equal(parsed.sections[0]?.score?.graded, 3);
});

test("renderText is plain (colour auto-disabled off-TTY) and shows the essentials", () => {
  const text = renderText(report());
  assert.ok(text.includes("readyscan"));
  assert.ok(text.includes("Security headers"));
  assert.ok(text.includes("score 1/3"));
  assert.ok(text.includes("summary"));
  assert.ok(!text.includes(String.fromCharCode(27)), "no ANSI escape sequences");
});

test("renderText shows the redirect chain when present", () => {
  const text = renderText(
    report({
      finalUrl: "https://x.test/home",
      http: {
        status: 200,
        statusText: "OK",
        redirects: ["https://x.test/home"],
        timingMs: 5,
      },
    }),
  );
  assert.ok(text.includes("final  https://x.test/home"));
  assert.ok(text.includes("hops"));
});
