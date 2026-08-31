/**
 * Minimal HTTP client built on the global `fetch` (Node >= 20).
 *
 * Adds the things the checks need and `fetch` does not give directly:
 *   - manual redirect following with the hop chain recorded
 *   - a hard timeout per hop
 *   - a capped, charset-aware body read
 *   - network/TLS errors normalised into a single `FetchError` type
 */

export const DEFAULT_USER_AGENT =
  "readyscan/0.1 (+https://github.com/BlueDevLabs/readyscan)";

/** Responses larger than this are truncated (HTML head, robots, llms, sitemap all fit). */
const MAX_BODY_BYTES = 2_000_000;

export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxRedirects: number;
  /** Extra request headers for a specific probe (e.g. `Accept`, `Origin`). */
  headers?: Record<string, string>;
  /** Read and decode the response body. Defaults to true for GET, false for HEAD. */
  readBody?: boolean;
  method?: "GET" | "HEAD";
}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  ok: boolean;
  headers: Headers;
  /** Decoded body, capped at ~2 MB. Empty string when the body was not read. */
  body: string;
  bodyTruncated: boolean;
  /** Redirect targets followed, in order. */
  redirects: string[];
  /** Wall-clock duration of the whole exchange, in milliseconds. */
  timingMs: number;
}

export class FetchError extends Error {
  override name = "FetchError";
  readonly url: string;
  readonly code: string;
  constructor(url: string, message: string, code = "EFETCH") {
    super(message);
    this.url = url;
    this.code = code;
  }
}

export type Fetcher = (
  url: string,
  extra?: Partial<FetchOptions>,
) => Promise<FetchResult>;

/** Bind a base set of options and return a reusable fetch function. */
export function makeFetcher(base: FetchOptions): Fetcher {
  return (url, extra) =>
    httpFetch(url, {
      ...base,
      ...extra,
      headers: { ...base.headers, ...extra?.headers },
    });
}

export async function httpFetch(
  url: string,
  opts: FetchOptions,
): Promise<FetchResult> {
  const started = performance.now();
  const method = opts.method ?? "GET";
  const readBody = opts.readBody ?? method !== "HEAD";
  const redirects: string[] = [];
  let current = url;

  for (;;) {
    let res: Response;
    try {
      res = await fetch(current, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: {
          "user-agent": opts.userAgent,
          accept: "*/*",
          ...lowerKeys(opts.headers ?? {}),
        },
      });
    } catch (err) {
      throw normalizeFetchError(current, err);
    }

    const isRedirect =
      res.status >= 300 && res.status < 400 && res.headers.has("location");

    if (isRedirect) {
      if (redirects.length >= opts.maxRedirects) {
        await res.body?.cancel().catch(() => {});
        throw new FetchError(
          url,
          `Too many redirects (> ${opts.maxRedirects}).`,
          "EMAXREDIRECTS",
        );
      }
      const location = res.headers.get("location") as string;
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        await res.body?.cancel().catch(() => {});
        throw new FetchError(
          current,
          `Invalid redirect target: ${location}`,
          "EBADREDIRECT",
        );
      }
      await res.body?.cancel().catch(() => {});
      redirects.push(next);
      current = next;
      continue;
    }

    let body = "";
    let bodyTruncated = false;
    if (readBody) {
      const read = await readCappedBody(res);
      body = read.text;
      bodyTruncated = read.truncated;
    } else {
      await res.body?.cancel().catch(() => {});
    }

    return {
      requestedUrl: url,
      finalUrl: current,
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: res.headers,
      body,
      bodyTruncated,
      redirects,
      timingMs: Math.round(performance.now() - started),
    };
  }
}

async function readCappedBody(
  res: Response,
): Promise<{ text: string; truncated: boolean }> {
  const charset = charsetFromContentType(res.headers.get("content-type"));
  if (!res.body) {
    const raw = await res.text().catch(() => "");
    return {
      text: raw.slice(0, MAX_BODY_BYTES),
      truncated: raw.length > MAX_BODY_BYTES,
    };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > MAX_BODY_BYTES) {
        chunks.push(value.subarray(0, MAX_BODY_BYTES - total));
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // A partial body is still worth analysing.
  }

  const buf = Buffer.concat(chunks);
  try {
    return { text: new TextDecoder(charset ?? "utf-8").decode(buf), truncated };
  } catch {
    return { text: buf.toString("utf-8"), truncated };
  }
}

function charsetFromContentType(ct: string | null): string | null {
  if (!ct) return null;
  const m = /charset=["']?([\w-]+)/i.exec(ct);
  return m ? m[1]!.toLowerCase() : null;
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

function normalizeFetchError(url: string, err: unknown): FetchError {
  if (err instanceof FetchError) return err;
  const e = err as {
    name?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new FetchError(url, "Request timed out.", "ETIMEDOUT");
  }

  const code = e?.cause?.code;
  const known: Record<string, string> = {
    ENOTFOUND: "DNS lookup failed (host not found).",
    ECONNREFUSED: "Connection refused.",
    ECONNRESET: "Connection reset by peer.",
    EAI_AGAIN: "DNS lookup timed out.",
    CERT_HAS_EXPIRED: "TLS certificate has expired.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is self-signed.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate chain could not be verified.",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the host name.",
  };
  if (code && known[code]) return new FetchError(url, known[code]!, code);

  const message =
    e?.cause?.message ||
    e?.message ||
    (err instanceof Error ? err.message : String(err));
  return new FetchError(url, message || "Request failed.", code ?? "EFETCH");
}
