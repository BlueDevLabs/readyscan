import type { Fetcher, FetchResult } from "../fetcher.js";

/** Everything a check needs: the fetched target plus a fetcher for sub-requests. */
export interface CheckContext {
  /** Normalised URL that was requested on the command line. */
  target: URL;
  /** Result of fetching `target` (may be a non-2xx response). */
  main: FetchResult;
  /** Fetch function for sub-requests (robots.txt, the http:// variant, `.md` probes...). */
  fetch: Fetcher;
}
