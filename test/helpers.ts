import type { CheckContext } from "../src/checks/context.js";
import type { Fetcher, FetchResult } from "../src/fetcher.js";
import type { Finding, Section } from "../src/report.js";

export interface FakeResponse {
  status?: number;
  /** String values become one header; arrays append (e.g. multiple set-cookie). */
  headers?: Record<string, string | string[]>;
  body?: string;
}

export function fakeResult(url: string, r: FakeResponse = {}): FetchResult {
  const headers = new Headers();
  for (const [key, value] of Object.entries(r.headers ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  const status = r.status ?? 200;
  return {
    requestedUrl: url,
    finalUrl: url,
    status,
    statusText: status === 200 ? "OK" : "",
    ok: status >= 200 && status < 300,
    headers,
    body: r.body ?? "",
    bodyTruncated: false,
    redirects: [],
    timingMs: 1,
  };
}

/**
 * Build a `CheckContext` backed by an in-memory routing table.
 * Routes are keyed by URL, resolved relative to `target`. Unlisted URLs 404.
 */
export function makeFakeContext(opts: {
  target: string;
  main: FakeResponse;
  routes?: Record<string, FakeResponse>;
}): CheckContext {
  const target = new URL(opts.target);
  const table = new Map<string, FakeResponse>();
  table.set(target.toString(), opts.main);
  for (const [key, value] of Object.entries(opts.routes ?? {})) {
    table.set(new URL(key, target).toString(), value);
  }

  const fetch: Fetcher = async (url) => {
    const key = new URL(url, target).toString();
    return fakeResult(key, table.get(key) ?? { status: 404 });
  };

  return { target, main: fakeResult(target.toString(), opts.main), fetch };
}

export function finding(section: Section, id: string): Finding | undefined {
  return section.findings.find((f) => f.id === id);
}

export function severityOf(section: Section, id: string): string | undefined {
  return finding(section, id)?.severity;
}

export function ids(section: Section): Set<string> {
  return new Set(section.findings.map((f) => f.id));
}
