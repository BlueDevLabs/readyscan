/**
 * AI-readiness check: robots.txt, AI crawler directives, sitemap, llms.txt,
 * Markdown content negotiation, crawl-friendly headers, and page metadata.
 *
 * Findings here are largely descriptive. Whether to allow or block a given AI
 * crawler is a policy decision for the site owner; this check surfaces the
 * current state, it does not tell you what the policy should be.
 */

import type { Section } from "../report.js";
import type { CheckContext } from "./context.js";
import { Findings } from "./findings.js";
import { parseHtml, jsonLdTypes, type HtmlMeta } from "./html.js";
import { AI_CRAWLERS, parseRobots, verdictFor, type ParsedRobots } from "./robots.js";
import { humanBytes, looksLikeText, safeFetch, truncate, yn } from "./util.js";
import { atOrigin, withMdExtension } from "../util/url.js";

const REF = {
  robots: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
  aiCrawlers: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
  sitemap: "https://www.sitemaps.org/protocol.html",
  llms: "https://llmstxt.org/",
  markdown: "https://developer.mozilla.org/docs/Web/HTTP/Content_negotiation",
  jsonld: "https://schema.org/",
  meta: "https://developer.mozilla.org/docs/Web/HTML/Element/meta/name",
  conditional: "https://developer.mozilla.org/docs/Web/HTTP/Conditional_requests",
};

export async function checkAiReadiness(ctx: CheckContext): Promise<Section> {
  const f = new Findings();
  const meta = parseHtml(ctx.main.body);

  const robots = await robotsTxt(f, ctx);
  aiCrawlerDirectives(f, robots);
  xRobotsTag(f, ctx);
  await sitemap(f, ctx, robots);
  await llmsTxt(f, ctx);
  await markdownNegotiation(f, ctx, meta);
  conditionalRequests(f, ctx);
  compression(f, ctx);
  metadata(f, meta);

  return { name: "AI readiness", findings: f.items, score: f.score() };
}

async function robotsTxt(f: Findings, ctx: CheckContext): Promise<ParsedRobots | null> {
  const res = await safeFetch(ctx, atOrigin(ctx.target, "/robots.txt"));
  if (res && res.status === 200 && looksLikeText(res)) {
    const robots = parseRobots(res.body);
    f.ok(
      "ai/robots",
      "robots.txt present",
      `${robots.groups.length} user-agent group(s), ${robots.sitemaps.length} Sitemap directive(s).`,
      REF.robots,
    );
    return robots;
  }
  if (res && res.status === 200) {
    f.fail(
      "ai/robots",
      "robots.txt is not plain text",
      "medium",
      `Content-Type: ${res.headers.get("content-type") ?? "(none)"}. The response at /robots.txt looks like an HTML page.`,
      "Serve /robots.txt as text/plain so crawlers can parse it.",
      REF.robots,
    );
    return null;
  }
  f.fail(
    "ai/robots",
    "No robots.txt",
    "low",
    res ? `HTTP ${res.status} at /robots.txt.` : "Request for /robots.txt failed.",
    "Publish a /robots.txt, even a permissive one, so every crawler has an explicit policy to read.",
    REF.robots,
  );
  return null;
}

function aiCrawlerDirectives(f: Findings, robots: ParsedRobots | null): void {
  if (!robots) {
    f.note(
      "ai/ai-crawlers",
      "AI crawler directives",
      "No parseable robots.txt, so every crawler — AI or not — gets an implicit allow-all.",
      { severity: "info", ref: REF.aiCrawlers },
    );
    return;
  }

  const rows = AI_CRAWLERS.map((c) => ({ ...c, ...verdictFor(robots, c.token) }));
  const named = rows.filter((r) => r.explicit);
  const blocked = rows.filter((r) => r.verdict === "blocked");

  const width = Math.max(...rows.map((r) => r.token.length));
  const table = rows
    .map((r) => {
      const state = `${r.verdict}${r.explicit ? " *" : ""}`;
      return `  ${r.token.padEnd(width)}  ${state.padEnd(11)}  ${r.vendor} / ${r.purpose}`;
    })
    .join("\n");

  f.note(
    "ai/ai-crawlers",
    "AI crawler directives in robots.txt",
    `${named.length}/${rows.length} known AI crawlers are named explicitly; ${blocked.length} blocked from "/". ` +
      "Reported as-is — the allow/block choice is the site owner's to make.\n" +
      "  (* = a robots.txt group names this token; others fall under * or a default)\n" +
      table,
    { severity: "info", ref: REF.aiCrawlers },
  );
}

function xRobotsTag(f: Findings, ctx: CheckContext): void {
  const xrt = ctx.main.headers.get("x-robots-tag");
  if (!xrt) return;
  f.note(
    "ai/x-robots-tag",
    "X-Robots-Tag header on the page",
    `Value: ${xrt}${/no(ai|index|imageai|snippet)|none/i.test(xrt) ? "  (restricts indexing / AI use)" : ""}`,
    { severity: "info", ref: REF.meta },
  );
}

async function sitemap(
  f: Findings,
  ctx: CheckContext,
  robots: ParsedRobots | null,
): Promise<void> {
  const candidates = robots?.sitemaps.length
    ? robots.sitemaps
    : [atOrigin(ctx.target, "/sitemap.xml"), atOrigin(ctx.target, "/sitemap_index.xml")];

  let found: { url: string; body: string } | null = null;
  for (const url of candidates) {
    const res = await safeFetch(ctx, url);
    if (!res || res.status !== 200) continue;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("xml") || /<(urlset|sitemapindex)[\s>]/i.test(res.body)) {
      found = { url, body: res.body };
      break;
    }
  }

  if (!found) {
    f.fail(
      "ai/sitemap",
      "No sitemap found",
      "low",
      `Checked: ${candidates.join(", ")}.`,
      "Publish an XML sitemap and add a 'Sitemap:' line to robots.txt.",
      REF.sitemap,
    );
    return;
  }

  const isIndex = /<sitemapindex[\s>]/i.test(found.body);
  const entries = (found.body.match(isIndex ? /<sitemap>/gi : /<url>/gi) ?? []).length;
  const referenced = Boolean(robots?.sitemaps.length);

  if (referenced) {
    f.ok(
      "ai/sitemap",
      isIndex ? "Sitemap index found" : "Sitemap found",
      `${entries} ${isIndex ? "child sitemap(s)" : "URL(s)"} at ${found.url}; referenced from robots.txt.`,
      REF.sitemap,
    );
  } else {
    f.fail(
      "ai/sitemap",
      "Sitemap found but not referenced in robots.txt",
      "low",
      `${entries} ${isIndex ? "child sitemap(s)" : "URL(s)"} at ${found.url}; robots.txt has no 'Sitemap:' line.`,
      "Add 'Sitemap: " + found.url + "' to robots.txt so crawlers discover it reliably.",
      REF.sitemap,
    );
  }
}

async function llmsTxt(f: Findings, ctx: CheckContext): Promise<void> {
  const res = await safeFetch(ctx, atOrigin(ctx.target, "/llms.txt"));
  if (!res || res.status !== 200) {
    f.fail(
      "ai/llms-txt",
      "No llms.txt",
      "info",
      res ? `HTTP ${res.status} at /llms.txt.` : "Request for /llms.txt failed.",
      "Optional but increasingly adopted: add /llms.txt (see llmstxt.org) pointing LLMs at your key docs.",
      REF.llms,
    );
    return;
  }

  const body = res.body.trim();
  if (/^<(?:!doctype|html)[\s>]/i.test(body)) {
    f.fail(
      "ai/llms-txt",
      "/llms.txt returns HTML",
      "medium",
      "The file at /llms.txt looks like an HTML page rather than Markdown.",
      "Serve /llms.txt as Markdown (text/markdown or text/plain).",
      REF.llms,
    );
    return;
  }

  const hasH1 = /^#\s+\S/m.test(body);
  const hasSummary = /^\s*>\s+\S/m.test(body);
  const hasSections = /^##\s+\S/m.test(body);
  const links = (body.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length;

  if (hasH1 && (hasSections || links > 0)) {
    f.ok(
      "ai/llms-txt",
      "llms.txt present and structured",
      `H1 title${hasSummary ? " + blockquote summary" : ""}${hasSections ? " + sections" : ""}, ${links} link(s), ${humanBytes(res.body.length)}.`,
      REF.llms,
    );
  } else {
    f.fail(
      "ai/llms-txt",
      "llms.txt present but off-spec",
      "low",
      `H1: ${yn(hasH1)}, blockquote summary: ${yn(hasSummary)}, "##" sections: ${yn(hasSections)}, links: ${links}.`,
      "Follow the llmstxt.org shape: '# Title', a '>' summary line, then '##' sections of Markdown link lists.",
      REF.llms,
    );
  }

  const full = await safeFetch(ctx, atOrigin(ctx.target, "/llms-full.txt"));
  if (full && full.status === 200) {
    f.note("ai/llms-full", "llms-full.txt present", `${humanBytes(full.body.length)} at /llms-full.txt.`, {
      severity: "info",
      ref: REF.llms,
    });
  }
}

async function markdownNegotiation(
  f: Findings,
  ctx: CheckContext,
  meta: HtmlMeta,
): Promise<void> {
  const signals: string[] = [];

  const viaAccept = await safeFetch(ctx, ctx.main.finalUrl, {
    headers: { accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" },
  });
  const acceptType = (viaAccept?.headers.get("content-type") ?? "").toLowerCase();
  if (
    viaAccept &&
    viaAccept.status === 200 &&
    /text\/(?:x-)?markdown/.test(acceptType) &&
    !acceptType.includes("html")
  ) {
    signals.push(`Accept: text/markdown -> ${acceptType.split(";")[0]}`);
  }

  const mdUrl = withMdExtension(new URL(ctx.main.finalUrl));
  if (mdUrl) {
    const viaDotMd = await safeFetch(ctx, mdUrl);
    const dotMdType = (viaDotMd?.headers.get("content-type") ?? "").toLowerCase();
    const looksMd = /^#{1,6}\s|^\s*[-*]\s|\[[^\]]+\]\([^)]+\)/m.test(
      (viaDotMd?.body ?? "").slice(0, 2000),
    );
    if (viaDotMd && viaDotMd.status === 200 && !dotMdType.includes("html") && looksMd) {
      signals.push(`${mdUrl} returns Markdown`);
    }
  }

  const linkHeader = ctx.main.headers.get("link") ?? "";
  const advertised =
    /type=(["']?)text\/markdown\1/i.test(linkHeader) ||
    meta.alternates.some((a) => a.type.includes("markdown"));
  if (advertised) signals.push('rel="alternate" type="text/markdown" advertised');

  if (signals.length) {
    f.ok("ai/markdown", "Markdown representation available", signals.join("\n"), REF.markdown);
  } else {
    f.fail(
      "ai/markdown",
      "No Markdown representation",
      "info",
      "Requests for text/markdown, a .md URL, and a rel=alternate link all returned HTML only.",
      "Optional: expose a Markdown view via Accept negotiation, a /path.md URL, or a rel=alternate link.",
      REF.markdown,
    );
  }
}

function conditionalRequests(f: Findings, ctx: CheckContext): void {
  const etag = ctx.main.headers.get("etag");
  const lastMod = ctx.main.headers.get("last-modified");
  if (etag || lastMod) {
    f.ok(
      "ai/conditional",
      "Conditional requests supported",
      [etag && `ETag: ${etag}`, lastMod && `Last-Modified: ${lastMod}`].filter(Boolean).join("  "),
      REF.conditional,
    );
  } else {
    f.fail(
      "ai/conditional",
      "No ETag or Last-Modified",
      "low",
      "Crawlers cannot revalidate with If-None-Match / If-Modified-Since and must refetch the whole page each visit.",
      "Emit an ETag or Last-Modified header on HTML responses.",
      REF.conditional,
    );
  }
}

function compression(f: Findings, ctx: CheckContext): void {
  const enc = (ctx.main.headers.get("content-encoding") ?? "").toLowerCase();
  if (/\b(?:gzip|br|zstd|deflate)\b/.test(enc)) {
    f.note("ai/compression", "Response is compressed", `Content-Encoding: ${enc}`, {
      severity: "info",
    });
  } else {
    f.note(
      "ai/compression",
      "Response is not compressed",
      "No Content-Encoding on the HTML response; every crawl transfers the full uncompressed page.",
      { severity: "low", remediation: "Enable gzip or Brotli for text/html." },
    );
  }
}

function metadata(f: Findings, meta: HtmlMeta): void {
  // Title
  if (meta.title) {
    f.ok("ai/meta-title", "<title> present", truncate(meta.title, 120));
    if (meta.title.length > 70) {
      f.note("ai/meta-title-length", "<title> is long", `${meta.title.length} characters; search and AI snippets truncate around 60–70.`, {
        severity: "info",
      });
    }
  } else {
    f.fail("ai/meta-title", "No <title>", "low", "The page has no non-empty <title> element.", "Add a descriptive <title>.", REF.meta);
  }

  // Description
  const desc = meta.metaByName.get("description");
  if (desc && desc.trim()) {
    f.ok("ai/meta-description", "meta description present", truncate(desc, 160));
    if (desc.length > 320) {
      f.note("ai/meta-description-length", "meta description is very long", `${desc.length} characters.`, { severity: "info" });
    }
  } else {
    f.fail(
      "ai/meta-description",
      "No meta description",
      "low",
      "No <meta name=\"description\"> content.",
      "Add a 1–2 sentence <meta name=\"description\">.",
      REF.meta,
    );
  }

  // Canonical
  if (meta.canonical) {
    const absolute = /^https?:\/\//i.test(meta.canonical);
    f.ok("ai/meta-canonical", "Canonical URL set", meta.canonical);
    if (!absolute) {
      f.note("ai/meta-canonical-relative", "Canonical URL is relative", `href="${meta.canonical}" — canonical URLs should be absolute.`, {
        severity: "low",
      });
    }
  } else {
    f.fail(
      "ai/meta-canonical",
      "No canonical URL",
      "low",
      "No <link rel=\"canonical\">. Crawlers may index duplicate URLs separately.",
      "Add <link rel=\"canonical\" href=\"https://…\"> with the absolute preferred URL.",
      REF.meta,
    );
  }

  // Language
  if (meta.lang) {
    f.ok("ai/meta-lang", "Document language set", `<html lang="${meta.lang}">`);
  } else {
    f.fail("ai/meta-lang", "No document language", "low", "The <html> element has no lang attribute.", "Set <html lang=\"…\">.", REF.meta);
  }

  // Structured data
  const types = jsonLdTypes(meta.jsonLd);
  if (meta.jsonLd.length) {
    f.ok(
      "ai/structured-data",
      "JSON-LD structured data present",
      `${meta.jsonLdBlocks} block(s)${types.length ? `, types: ${types.join(", ")}` : ""}.`,
      REF.jsonld,
    );
  } else if (meta.jsonLdBlocks > 0) {
    f.fail(
      "ai/structured-data",
      "JSON-LD present but unparseable",
      "low",
      `${meta.jsonLdBlocks} ld+json block(s) found, none parsed as valid JSON.`,
      "Fix the JSON so machines can read your schema.org markup.",
      REF.jsonld,
    );
  } else {
    f.fail(
      "ai/structured-data",
      "No structured data",
      "info",
      "No JSON-LD (schema.org) blocks on the page.",
      "Add JSON-LD for your primary entity (Organization, Article, Product, …) to improve machine understanding.",
      REF.jsonld,
    );
  }

  // Robots meta (surface only)
  const robotsMeta = meta.metaByName.get("robots");
  if (robotsMeta) {
    f.note(
      "ai/meta-robots",
      "meta robots directive on the page",
      `Value: ${robotsMeta}${/noindex|nofollow|noai|none/i.test(robotsMeta) ? "  (limits indexing / AI use)" : ""}`,
      { severity: "info", ref: REF.meta },
    );
  }

  // Open Graph
  const og = ["og:title", "og:description", "og:image"].filter((k) => meta.metaByProperty.has(k));
  if (og.length === 3) {
    f.note("ai/open-graph", "Open Graph tags present", `Found: ${og.join(", ")}.`, { severity: "info" });
  } else if (og.length > 0) {
    f.note("ai/open-graph", "Open Graph tags incomplete", `Found ${og.join(", ") || "none"}; missing the rest of og:title / og:description / og:image.`, {
      severity: "low",
    });
  } else {
    f.note("ai/open-graph", "No Open Graph tags", "No og: metadata; link unfurls and some AI previews fall back to guesswork.", {
      severity: "low",
    });
  }

  // Feeds
  if (meta.feeds.length) {
    f.note("ai/feeds", "Feed autodiscovery present", meta.feeds.map((x) => `${x.type || "feed"} ${x.href}`).join("\n"), {
      severity: "info",
    });
  }
}
