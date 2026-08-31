import type { Finding, Severity } from "../report.js";

/**
 * Accumulator for a section's findings.
 *
 * `ok` / `fail` are *graded* — they count towards the section score.
 * `note` is not graded; use it for context and things outside the site's control.
 */
export class Findings {
  readonly items: Finding[] = [];
  private graded = 0;
  private passed = 0;

  /** A graded check that passed. */
  ok(id: string, title: string, detail: string, ref?: string): void {
    this.graded++;
    this.passed++;
    this.items.push({ id, title, severity: "pass", detail, ref });
  }

  /** A graded check that failed. */
  fail(
    id: string,
    title: string,
    severity: Exclude<Severity, "pass">,
    detail: string,
    remediation?: string,
    ref?: string,
  ): void {
    this.graded++;
    this.items.push({ id, title, severity, detail, remediation, ref });
  }

  /** An ungraded, informational finding. */
  note(
    id: string,
    title: string,
    detail: string,
    opts: { severity?: Severity; remediation?: string; ref?: string } = {},
  ): void {
    this.items.push({
      id,
      title,
      severity: opts.severity ?? "info",
      detail,
      remediation: opts.remediation,
      ref: opts.ref,
    });
  }

  score(): { passed: number; graded: number } | undefined {
    return this.graded ? { passed: this.passed, graded: this.graded } : undefined;
  }
}
