/**
 * Regex-based extraction of `<head>` metadata.
 *
 * This is intentionally lightweight: no DOM, no JavaScript execution. It reads
 * what a server sends in the initial HTML response, which is also what most
 * crawlers see. Content injected by client-side scripts is not visible here.
 */

export interface HtmlMeta {
  title: string | null;
  lang: string | null;
  charset: string | null;
  canonical: string | null;
  /** `<meta name="...">` content, keyed by lower-cased name. */
  metaByName: Map<string, string>;
  /** `<meta property="...">` content (Open Graph etc.), keyed by lower-cased property. */
  metaByProperty: Map<string, string>;
  /** Parsed JSON-LD blocks. Blocks that fail to parse are dropped. */
  jsonLd: unknown[];
  /** Number of `<script type="application/ld+json">` blocks seen (parsed or not). */
  jsonLdBlocks: number;
  /** `<link rel="alternate">` entries. */
  alternates: { type: string; href: string; title: string }[];
  /** Subset of alternates that are RSS/Atom feeds. */
  feeds: { type: string; href: string; title: string }[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  "#34": '"',
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name: string) => {
    const key = name.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key]!;
    if (key.startsWith("#x")) {
      const cp = parseInt(key.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    if (key.startsWith("#")) {
      const cp = parseInt(key.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return m;
  });
}

function attrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([a-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const key = m[1]!.toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    out.set(key, decodeEntities(value));
  }
  return out;
}

export function parseHtml(body: string): HtmlMeta {
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(body);
  const head = headMatch ? headMatch[1]! : body.slice(0, 20_000);

  const meta: HtmlMeta = {
    title: null,
    lang: null,
    charset: null,
    canonical: null,
    metaByName: new Map(),
    metaByProperty: new Map(),
    jsonLd: [],
    jsonLdBlocks: 0,
    alternates: [],
    feeds: [],
  };

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  if (titleMatch) {
    const t = decodeEntities(titleMatch[1]!).replace(/\s+/g, " ").trim();
    meta.title = t || null;
  }

  const langMatch = /<html\b[^>]*\slang\s*=\s*["']?([\w-]+)/i.exec(body);
  if (langMatch) meta.lang = langMatch[1]!;

  const charsetMatch =
    /<meta\b[^>]*\bcharset\s*=\s*["']?([\w-]+)/i.exec(body.slice(0, 2048)) ??
    /<meta\b[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset=([\w-]+)/i.exec(
      head,
    );
  if (charsetMatch) meta.charset = charsetMatch[1]!.toLowerCase();

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const content = a.get("content");
    if (content === undefined) continue;
    const name = a.get("name");
    const property = a.get("property");
    if (name) meta.metaByName.set(name.toLowerCase(), content);
    if (property) meta.metaByProperty.set(property.toLowerCase(), content);
  }

  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const rel = (a.get("rel") ?? "").toLowerCase();
    const href = a.get("href") ?? "";
    if (!href) continue;
    if (rel.split(/\s+/).includes("canonical")) {
      meta.canonical ??= href;
    }
    if (rel.split(/\s+/).includes("alternate")) {
      const type = (a.get("type") ?? "").toLowerCase();
      const entry = { type, href, title: a.get("title") ?? "" };
      meta.alternates.push(entry);
      if (/rss|atom|feed/.test(type)) meta.feeds.push(entry);
    }
  }

  for (const block of body.match(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ) ?? []) {
    meta.jsonLdBlocks++;
    const inner = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(block)?.[1] ?? "";
    try {
      meta.jsonLd.push(JSON.parse(inner));
    } catch {
      // Malformed JSON-LD is common; count it but don't fail.
    }
  }

  return meta;
}

/** Collect the `@type` values from parsed JSON-LD (handles arrays and @graph). */
export function jsonLdTypes(blocks: readonly unknown[]): string[] {
  const types = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
    if (Array.isArray(obj["@graph"])) obj["@graph"].forEach(visit);
  };
  blocks.forEach(visit);
  return [...types];
}
