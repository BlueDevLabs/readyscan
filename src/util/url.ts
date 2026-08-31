/** URL parsing and well-known-path helpers. */

export class InvalidTargetError extends Error {
  override name = "InvalidTargetError";
}

/**
 * Normalise a user-supplied target into an absolute http(s) URL.
 * Accepts bare hosts ("example.com"), adding `https://` when no scheme is present.
 */
export function normalizeTarget(input: string): URL {
  const raw = input.trim();
  if (!raw) throw new InvalidTargetError("No URL provided.");

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidTargetError(`Not a valid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidTargetError(
      `Only http and https targets are supported (got "${url.protocol}").`,
    );
  }
  return url;
}

/** The scheme + host of a URL, with no path/query/hash. */
export function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

/** Resolve a path (e.g. "/robots.txt") against the origin of `url`. */
export function atOrigin(url: URL, path: string): string {
  return new URL(path, originOf(url) + "/").toString();
}

/** Swap an https URL to http (used to test scheme downgrade behaviour). */
export function toHttp(url: URL): string {
  const u = new URL(url.toString());
  u.protocol = "http:";
  return u.toString();
}

/**
 * Append `.md` to the path portion of a URL, preserving query and hash.
 * Returns `null` when the path already ends in `.md` or looks like a
 * directory (trailing slash) or a file with another extension.
 */
export function withMdExtension(url: URL): string | null {
  const u = new URL(url.toString());
  const path = u.pathname;
  if (path.endsWith(".md")) return null;
  if (path.endsWith("/") || path === "") return null;
  const last = path.split("/").pop() ?? "";
  if (last.includes(".")) return null; // has some other extension
  u.pathname = `${path}.md`;
  return u.toString();
}
