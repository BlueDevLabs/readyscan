/** Security / HTTP response-header check. */

import type { Section } from "../report.js";
import type { CheckContext } from "./context.js";
import { Findings } from "./findings.js";
import { safeFetch, truncate } from "./util.js";
import { toHttp } from "../util/url.js";

const REF = {
  hsts: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Strict-Transport-Security",
  csp: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy",
  xcto: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Content-Type-Options",
  xfo: "https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Frame-Options",
  referrer: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Referrer-Policy",
  permissions: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Permissions-Policy",
  coop: "https://developer.mozilla.org/docs/Web/Security/Cross-Origin-Opener-Policy",
  cookies: "https://developer.mozilla.org/docs/Web/HTTP/Headers/Set-Cookie",
  cors: "https://developer.mozilla.org/docs/Web/HTTP/CORS",
  owasp: "https://owasp.org/www-project-secure-headers/",
};

export async function checkHeaders(ctx: CheckContext): Promise<Section> {
  const f = new Findings();
  const h = ctx.main.headers;
  const finalUrl = new URL(ctx.main.finalUrl);
  const isHttps = finalUrl.protocol === "https:";

  await transportSecurity(f, ctx, h, isHttps, finalUrl);
  contentSecurityPolicy(f, h);
  miscSecurityHeaders(f, h);
  cookies(f, h);
  informationDisclosure(f, h);
  deprecatedHeaders(f, h);
  await cors(f, ctx, h);

  return { name: "Security headers", findings: f.items, score: f.score() };
}

async function transportSecurity(
  f: Findings,
  ctx: CheckContext,
  h: Headers,
  isHttps: boolean,
  finalUrl: URL,
): Promise<void> {
  if (!isHttps) {
    f.fail(
      "headers/https",
      "Site is not served over HTTPS",
      "high",
      `Final URL after redirects is ${finalUrl.toString()}`,
      "Serve the site over TLS and redirect all http:// traffic to https://.",
      REF.owasp,
    );
    return;
  }

  const hsts = h.get("strict-transport-security");
  if (!hsts) {
    f.fail(
      "headers/hsts",
      "HSTS not set",
      "medium",
      "No Strict-Transport-Security header on the HTTPS response.",
      "Add: Strict-Transport-Security: max-age=31536000; includeSubDomains",
      REF.hsts,
    );
  } else {
    const maxAge = Number(/max-age\s*=\s*(\d+)/i.exec(hsts)?.[1] ?? "0");
    const sub = /includesubdomains/i.test(hsts);
    const preload = /preload/i.test(hsts);
    if (maxAge < 15_552_000) {
      f.fail(
        "headers/hsts",
        "HSTS max-age is short",
        "low",
        `max-age=${maxAge} (< 180 days). Full value: ${hsts}`,
        "Raise max-age to at least 15552000; 31536000 (1 year) is typical.",
        REF.hsts,
      );
    } else {
      f.ok(
        "headers/hsts",
        "HSTS set",
        `max-age=${maxAge}${sub ? "; includeSubDomains" : ""}${preload ? "; preload" : ""}`,
        REF.hsts,
      );
    }
    if (!sub) {
      f.note(
        "headers/hsts-subdomains",
        "HSTS without includeSubDomains",
        "Sub-domains are not covered by the current policy.",
        { severity: "low", ref: REF.hsts },
      );
    }
  }

  // Does plain http:// upgrade to https://?
  const httpProbe = await safeFetch(ctx, toHttp(finalUrl), {
    maxRedirects: 0,
    readBody: false,
  });
  if (!httpProbe) {
    f.note(
      "headers/http-redirect",
      "Plain http:// is not reachable",
      "The http:// URL did not respond. Often intentional (TLS-only), sometimes a transient failure.",
      { severity: "info" },
    );
    return;
  }
  if (httpProbe.status >= 300 && httpProbe.status < 400) {
    const loc = httpProbe.headers.get("location") ?? "";
    if (/^https:/i.test(loc) || loc.startsWith("//") || loc.startsWith("/")) {
      f.ok("headers/http-redirect", "http:// redirects to https://", `HTTP ${httpProbe.status} -> ${loc}`);
    } else {
      f.fail(
        "headers/http-redirect",
        "http:// redirect does not upgrade the scheme",
        "medium",
        `HTTP ${httpProbe.status} -> ${loc || "(no Location)"}`,
        "Redirect http:// straight to the https:// origin.",
        REF.owasp,
      );
    }
  } else if (httpProbe.status === 200) {
    f.fail(
      "headers/http-redirect",
      "Site also answers over plain http://",
      "high",
      `http:// returned HTTP 200 with no redirect.`,
      "Return 301/308 to https:// for every http:// request.",
      REF.owasp,
    );
  } else {
    f.note(
      "headers/http-redirect",
      "http:// did not return a redirect",
      `http:// returned HTTP ${httpProbe.status}.`,
      { severity: "info" },
    );
  }
}

function contentSecurityPolicy(f: Findings, h: Headers): void {
  const csp = h.get("content-security-policy");
  const reportOnly = h.get("content-security-policy-report-only");

  if (!csp) {
    f.fail(
      "headers/csp",
      "No Content-Security-Policy",
      "medium",
      reportOnly
        ? "Only Content-Security-Policy-Report-Only is set, which browsers do not enforce."
        : "No Content-Security-Policy header.",
      "Add a CSP. Roll it out in Report-Only first, then enforce.",
      REF.csp,
    );
    return;
  }

  f.ok("headers/csp", "Content-Security-Policy set", truncate(csp, 220), REF.csp);

  const weak: string[] = [];
  if (/'unsafe-inline'/i.test(csp)) weak.push("'unsafe-inline'");
  if (/'unsafe-eval'/i.test(csp)) weak.push("'unsafe-eval'");
  if (/(?:^|[\s;])(?:default-src|script-src)\s+[^;]*(?:^|\s)\*(?:\s|;|$)/i.test(csp)) {
    weak.push("wildcard script/default source");
  }
  if (weak.length) {
    f.note(
      "headers/csp-weak",
      "CSP contains weak directives",
      `Present: ${weak.join(", ")}. These reduce the protection a CSP provides.`,
      { severity: "low", ref: REF.csp },
    );
  }
}

function miscSecurityHeaders(f: Findings, h: Headers): void {
  const xcto = h.get("x-content-type-options");
  if (xcto && /nosniff/i.test(xcto)) {
    f.ok("headers/x-content-type-options", "X-Content-Type-Options: nosniff", xcto, REF.xcto);
  } else {
    f.fail(
      "headers/x-content-type-options",
      "X-Content-Type-Options is not 'nosniff'",
      "low",
      xcto ? `Value: ${xcto}` : "Header not set.",
      "Add: X-Content-Type-Options: nosniff",
      REF.xcto,
    );
  }

  const xfo = h.get("x-frame-options");
  const csp = h.get("content-security-policy") ?? "";
  const frameAncestors = /frame-ancestors/i.test(csp);
  if (frameAncestors || (xfo && /^(deny|sameorigin)$/i.test(xfo.trim()))) {
    f.ok(
      "headers/clickjacking",
      "Clickjacking protection present",
      frameAncestors ? "CSP frame-ancestors is set." : `X-Frame-Options: ${xfo}`,
      REF.xfo,
    );
  } else {
    f.fail(
      "headers/clickjacking",
      "No clickjacking protection",
      "medium",
      xfo
        ? `X-Frame-Options: ${xfo} (not DENY or SAMEORIGIN) and no CSP frame-ancestors.`
        : "Neither X-Frame-Options nor CSP frame-ancestors is set.",
      "Add 'Content-Security-Policy: frame-ancestors 'self'' (and X-Frame-Options: SAMEORIGIN for old browsers).",
      REF.xfo,
    );
  }

  const rp = h.get("referrer-policy");
  const strong = new Set([
    "no-referrer",
    "no-referrer-when-downgrade",
    "same-origin",
    "origin",
    "strict-origin",
    "origin-when-cross-origin",
    "strict-origin-when-cross-origin",
  ]);
  const rpOk =
    rp && rp.split(",").some((v) => strong.has(v.trim().toLowerCase()));
  if (rpOk) {
    f.ok("headers/referrer-policy", "Referrer-Policy set", rp, REF.referrer);
  } else {
    f.fail(
      "headers/referrer-policy",
      "Referrer-Policy not set",
      "low",
      rp ? `Value: ${rp}` : "Header not set; the browser default applies.",
      "Add: Referrer-Policy: strict-origin-when-cross-origin",
      REF.referrer,
    );
  }

  const pp = h.get("permissions-policy");
  f.note(
    "headers/permissions-policy",
    pp ? "Permissions-Policy set" : "No Permissions-Policy",
    pp
      ? truncate(pp, 220)
      : "Optional. Restricts powerful browser features (camera, geolocation, ...).",
    { severity: "info", ref: REF.permissions },
  );

  const coop = h.get("cross-origin-opener-policy");
  const coep = h.get("cross-origin-embedder-policy");
  const corp = h.get("cross-origin-resource-policy");
  const isolation = [
    coop && `COOP: ${coop}`,
    coep && `COEP: ${coep}`,
    corp && `CORP: ${corp}`,
  ].filter(Boolean);
  f.note(
    "headers/cross-origin",
    isolation.length ? "Cross-origin isolation headers present" : "No cross-origin isolation headers",
    isolation.length
      ? isolation.join("  ")
      : "COOP / COEP / CORP are not set. Best practice for sites that handle sensitive data.",
    { severity: "info", ref: REF.coop },
  );
}

function cookies(f: Findings, h: Headers): void {
  const set = h.getSetCookie();
  if (!set.length) return;

  const issues: string[] = [];
  for (const cookie of set) {
    const parts = cookie.split(";").map((p) => p.trim().toLowerCase());
    const name = cookie.split("=")[0]?.trim() ?? "(unnamed)";
    const has = (attr: string): boolean =>
      parts.some((p) => p === attr || p.startsWith(`${attr}=`));
    const missing: string[] = [];
    if (!has("secure")) missing.push("Secure");
    if (!has("httponly")) missing.push("HttpOnly");
    if (!has("samesite")) missing.push("SameSite");
    if (missing.length) issues.push(`${name}: missing ${missing.join(", ")}`);
  }

  if (issues.length) {
    f.note(
      "headers/cookies",
      "Set-Cookie missing hardening flags",
      `${set.length} cookie(s) set.\n${issues.join("\n")}`,
      {
        severity: "medium",
        remediation:
          "Add Secure, HttpOnly and SameSite to session cookies (SameSite=Lax or Strict).",
        ref: REF.cookies,
      },
    );
  } else {
    f.note(
      "headers/cookies",
      "Set-Cookie flags look good",
      `${set.length} cookie(s), all with Secure / HttpOnly / SameSite.`,
      { severity: "info", ref: REF.cookies },
    );
  }
}

function informationDisclosure(f: Findings, h: Headers): void {
  const tells: string[] = [];
  const server = h.get("server");
  if (server && /\d/.test(server)) tells.push(`Server: ${server}`);
  const powered = h.get("x-powered-by");
  if (powered) tells.push(`X-Powered-By: ${powered}`);
  for (const key of ["x-aspnet-version", "x-aspnetmvc-version", "x-generator"]) {
    const v = h.get(key);
    if (v) tells.push(`${key}: ${v}`);
  }

  if (tells.length) {
    f.note(
      "headers/info-disclosure",
      "Response advertises server software / versions",
      tells.join("\n"),
      {
        severity: "low",
        remediation: "Strip or generalise Server, X-Powered-By and framework version headers.",
        ref: REF.owasp,
      },
    );
  }
}

function deprecatedHeaders(f: Findings, h: Headers): void {
  const xxss = h.get("x-xss-protection");
  if (xxss && xxss.trim() !== "0") {
    f.note(
      "headers/x-xss-protection",
      "Deprecated X-XSS-Protection is enabled",
      `Value: ${xxss}. The legacy auditor can introduce vulnerabilities and is ignored by modern browsers.`,
      { severity: "low", remediation: "Set 'X-XSS-Protection: 0' or remove it; rely on CSP." },
    );
  }
  if (h.has("public-key-pins") || h.has("public-key-pins-report-only")) {
    f.note(
      "headers/hpkp",
      "Deprecated HPKP header present",
      "HTTP Public Key Pinning is removed from browsers and risks locking users out.",
      { severity: "medium", remediation: "Remove Public-Key-Pins headers." },
    );
  }
  if (h.has("expect-ct")) {
    f.note("headers/expect-ct", "Deprecated Expect-CT header present", `Value: ${h.get("expect-ct")}`, {
      severity: "info",
      remediation: "Expect-CT is obsolete (CT is now always enforced); the header can be removed.",
    });
  }
}

async function cors(f: Findings, ctx: CheckContext, h: Headers): Promise<void> {
  const acao = h.get("access-control-allow-origin");
  const acac = h.get("access-control-allow-credentials");
  if (acao === "*" && acac && /true/i.test(acac)) {
    f.note(
      "headers/cors",
      "CORS allows any origin with credentials",
      "Access-Control-Allow-Origin: * together with Access-Control-Allow-Credentials: true.",
      {
        severity: "high",
        remediation: "Never combine a wildcard origin with credentials. Echo a vetted origin instead.",
        ref: REF.cors,
      },
    );
    return;
  }

  const probeOrigin = "https://readyscan-probe.example";
  const probe = await safeFetch(ctx, ctx.main.finalUrl, {
    headers: { origin: probeOrigin },
    readBody: false,
  });
  const reflected = probe?.headers.get("access-control-allow-origin");
  if (reflected && reflected === probeOrigin) {
    const withCreds = probe?.headers.get("access-control-allow-credentials");
    f.note(
      "headers/cors-reflect",
      "CORS reflects an arbitrary Origin",
      `Sent Origin: ${probeOrigin}, response echoed it back${
        withCreds ? " with Access-Control-Allow-Credentials: true" : ""
      }.`,
      {
        severity: withCreds && /true/i.test(withCreds) ? "high" : "medium",
        remediation: "Validate Origin against an allow-list before echoing it.",
        ref: REF.cors,
      },
    );
  }
}
