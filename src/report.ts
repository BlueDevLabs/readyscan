/** Report data model plus text and JSON renderers. */

import { bold, cyan, dim, gray, green, red, yellow } from "./util/color.js";

export type Severity = "high" | "medium" | "low" | "info" | "pass";

export interface Finding {
  /** Stable identifier, e.g. `headers/hsts` or `ai/llms-txt`. */
  id: string;
  title: string;
  severity: Severity;
  /** What was observed. May contain newlines. */
  detail: string;
  /** What to change. Omitted for `pass` and purely informational findings. */
  remediation?: string;
  /** Reference URL for the check. */
  ref?: string;
}

export interface Section {
  name: string;
  findings: Finding[];
  /** Optional heuristic score: `passed` out of `graded` graded checks. */
  score?: { passed: number; graded: number };
}

export interface Report {
  target: string;
  finalUrl: string;
  fetchedAt: string;
  http: {
    status: number;
    statusText: string;
    redirects: string[];
    timingMs: number;
  };
  sections: Section[];
  tool: { name: string; version: string };
}

const RANK: Record<Severity, number> = {
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  pass: 0,
};

export const SEVERITIES: readonly Severity[] = [
  "high",
  "medium",
  "low",
  "info",
  "pass",
];

export function compareSeverity(a: Severity, b: Severity): number {
  return RANK[b] - RANK[a];
}

export function worstSeverity(findings: readonly Finding[]): Severity {
  let worst: Severity = "pass";
  for (const f of findings) if (RANK[f.severity] > RANK[worst]) worst = f.severity;
  return worst;
}

/** True when any finding is at or above `threshold` (never triggered by `pass`). */
export function exceedsThreshold(report: Report, threshold: Severity): boolean {
  const min = RANK[threshold];
  for (const section of report.sections) {
    for (const f of section.findings) {
      if (f.severity !== "pass" && RANK[f.severity] >= min) return true;
    }
  }
  return false;
}

export function countBySeverity(report: Report): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    pass: 0,
  };
  for (const section of report.sections) {
    for (const f of section.findings) counts[f.severity]++;
  }
  return counts;
}

export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

const WIDTH = 78;

export function renderText(report: Report): string {
  const lines: string[] = [];
  const push = (s = ""): void => void lines.push(s);

  push(
    `${bold("readyscan")} ${gray("v" + report.tool.version)}  ${gray("•")}  ${cyan(
      report.target,
    )}`,
  );
  const { http } = report;
  push(
    `HTTP ${http.status}${http.statusText ? " " + http.statusText : ""}  ${gray(
      `${http.timingMs}ms`,
    )}`,
  );
  if (report.finalUrl !== report.target) push(gray(`final  ${report.finalUrl}`));
  if (http.redirects.length) {
    push(gray(`hops   ${http.redirects.join(" -> ")}`));
  }
  push();

  for (const section of report.sections) {
    const score = section.score
      ? gray(`  score ${section.score.passed}/${section.score.graded}`)
      : "";
    push(bold(`-- ${section.name} --`) + score);

    const sorted = [...section.findings].sort((a, b) =>
      compareSeverity(a.severity, b.severity),
    );
    if (!sorted.length) push(gray("  (no findings)"));

    for (const f of sorted) {
      const title = f.severity === "pass" ? gray(f.title) : f.title;
      push(`  ${badge(f.severity)} ${title}`);
      if (f.detail) push(dim(indentBlock(f.detail, "      ")));
      if (f.remediation) push(indentBlock("-> " + f.remediation, "      "));
      // Refs are URLs: keep them on one line so they stay copy-pasteable.
      if (f.ref) push(gray("      see " + f.ref));
    }
    push();
  }

  const c = countBySeverity(report);
  const summary = [
    c.high ? red(`${c.high} high`) : "",
    c.medium ? yellow(`${c.medium} medium`) : "",
    c.low ? yellow(`${c.low} low`) : "",
    c.info ? cyan(`${c.info} info`) : "",
    green(`${c.pass} pass`),
  ]
    .filter(Boolean)
    .join(gray(" | "));
  push(bold("summary  ") + summary);

  return lines.join("\n");
}

function badge(sev: Severity): string {
  switch (sev) {
    case "high":
      return red(bold(" HIGH "));
    case "medium":
      return yellow(bold(" MED  "));
    case "low":
      return yellow(" LOW  ");
    case "info":
      return cyan(" INFO ");
    case "pass":
      return green(" PASS ");
  }
}

function indentBlock(text: string, indent: string): string {
  const width = WIDTH - indent.length;
  return text
    .split("\n")
    .flatMap((line) =>
      // Lines that are already indented are structured content (tables,
      // key/value lists) — pass them through without re-wrapping.
      /^\s/.test(line) ? [line] : wrapLine(line, width),
    )
    .map((line) => indent + line)
    .join("\n");
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const parts = line.split(/(\s+)/);
  const out: string[] = [];
  let cur = "";
  for (const part of parts) {
    if (cur.trim() && (cur + part).length > width) {
      out.push(cur.trimEnd());
      cur = part.replace(/^\s+/, "");
    } else {
      cur += part;
    }
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out.length ? out : [line];
}
