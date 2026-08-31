/**
 * Programmatic API.
 *
 *   import { scan, renderText } from "readyscan";
 *   const report = await scan("example.com", { checks: ["headers"] });
 *   console.log(renderText(report));
 */

import { readFileSync } from "node:fs";

import {
  DEFAULT_USER_AGENT,
  FetchError,
  httpFetch,
  makeFetcher,
  type FetchOptions,
  type FetchResult,
} from "./fetcher.js";
import { checkAiReadiness } from "./checks/aiReadiness.js";
import { checkHeaders } from "./checks/headers.js";
import type { CheckContext } from "./checks/context.js";
import type { Report, Section } from "./report.js";
import { normalizeTarget } from "./util/url.js";

export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export type CheckName = "headers" | "ai-readiness";

export interface ScanOptions {
  /** Which checks to run. Defaults to both. */
  checks?: CheckName[];
  userAgent?: string;
  /** Per-request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Redirect hops to follow. Default 10. */
  maxRedirects?: number;
}

export async function scan(
  target: string,
  options: ScanOptions = {},
): Promise<Report> {
  const url = normalizeTarget(target);
  const checks = options.checks ?? ["headers", "ai-readiness"];

  const fetchOptions: FetchOptions = {
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    timeoutMs: options.timeoutMs ?? 15_000,
    maxRedirects: options.maxRedirects ?? 10,
  };
  const fetcher = makeFetcher(fetchOptions);

  const main = await fetcher(url.toString());
  const ctx: CheckContext = { target: url, main, fetch: fetcher };

  const sections: Section[] = [];
  if (checks.includes("headers")) sections.push(await checkHeaders(ctx));
  if (checks.includes("ai-readiness")) sections.push(await checkAiReadiness(ctx));

  return {
    target: url.toString(),
    finalUrl: main.finalUrl,
    fetchedAt: new Date().toISOString(),
    http: {
      status: main.status,
      statusText: main.statusText,
      redirects: main.redirects,
      timingMs: main.timingMs,
    },
    sections,
    tool: { name: "readyscan", version: VERSION },
  };
}

export { checkHeaders, checkAiReadiness };
export { httpFetch, makeFetcher, FetchError, DEFAULT_USER_AGENT };
export { normalizeTarget, InvalidTargetError } from "./util/url.js";
export {
  renderText,
  renderJson,
  exceedsThreshold,
  countBySeverity,
  worstSeverity,
  compareSeverity,
} from "./report.js";

export type { CheckContext } from "./checks/context.js";
export type { FetchOptions, FetchResult } from "./fetcher.js";
export type { Report, Section, Finding, Severity } from "./report.js";
