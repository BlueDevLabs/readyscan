import type { FetchOptions, FetchResult } from "../fetcher.js";
import type { CheckContext } from "./context.js";

/** Fetch a sub-resource, returning `null` instead of throwing on network errors. */
export async function safeFetch(
  ctx: CheckContext,
  url: string,
  extra?: Partial<FetchOptions>,
): Promise<FetchResult | null> {
  try {
    return await ctx.fetch(url, extra);
  } catch {
    return null;
  }
}

/** Heuristic: does this response look like plain text rather than an HTML page? */
export function looksLikeText(res: FetchResult): boolean {
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("html")) return false;
  if (ct.includes("text") || ct.includes("plain") || ct === "") return true;
  return !/^\s*</.test(res.body);
}

export function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

export function yn(value: boolean): string {
  return value ? "yes" : "no";
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
