/**
 * A deliberately small robots.txt parser — enough to answer
 * "is crawler X allowed to fetch the site root?" and to list Sitemap directives.
 * It is not a full RFC 9309 implementation (no path-pattern matching beyond `/`).
 */

export interface RobotsGroup {
  /** Lower-cased user-agent tokens this group applies to. */
  agents: string[];
  rules: { field: string; value: string }[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!field) continue;

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    // Any other field (disallow, allow, crawl-delay, ...) belongs to a group.
    if (!current) {
      current = { agents: ["*"], rules: [] };
      groups.push(current);
    }
    current.rules.push({ field, value });
    lastLineWasAgent = false;
  }

  return { groups, sitemaps };
}

export type CrawlerVerdict = "allowed" | "blocked" | "partial";

export interface CrawlerRuling {
  verdict: CrawlerVerdict;
  /** True when a group named this exact token (rather than falling under `*`). */
  explicit: boolean;
}

/** Coarse ruling for whether `token` may fetch the site root (`/`). */
export function verdictFor(robots: ParsedRobots, token: string): CrawlerRuling {
  const lower = token.toLowerCase();
  const explicitGroup = robots.groups.find((g) => g.agents.includes(lower));
  const group =
    explicitGroup ?? robots.groups.find((g) => g.agents.includes("*")) ?? null;

  if (!group) return { verdict: "allowed", explicit: false };

  const explicit = Boolean(explicitGroup);
  const disallows = group.rules
    .filter((r) => r.field === "disallow")
    .map((r) => r.value.trim());
  const allows = group.rules
    .filter((r) => r.field === "allow")
    .map((r) => r.value.trim());

  const blocksRoot = disallows.includes("/");
  const allowsRoot = allows.includes("/");
  const hasAnyDisallow = disallows.some((v) => v !== "");

  if (blocksRoot && !allowsRoot) return { verdict: "blocked", explicit };
  if (blocksRoot && allowsRoot) return { verdict: "partial", explicit };
  if (hasAnyDisallow) return { verdict: "partial", explicit };
  return { verdict: "allowed", explicit };
}

/**
 * Known crawlers operated by AI companies, as of early 2026.
 * `purpose` is a short note on what the operator says the bot is for.
 */
export const AI_CRAWLERS: readonly {
  token: string;
  vendor: string;
  purpose: string;
}[] = [
  { token: "GPTBot", vendor: "OpenAI", purpose: "model training" },
  { token: "OAI-SearchBot", vendor: "OpenAI", purpose: "ChatGPT search index" },
  { token: "ChatGPT-User", vendor: "OpenAI", purpose: "user-triggered fetch" },
  { token: "ClaudeBot", vendor: "Anthropic", purpose: "model training" },
  { token: "Claude-User", vendor: "Anthropic", purpose: "user-triggered fetch" },
  { token: "Claude-SearchBot", vendor: "Anthropic", purpose: "search index" },
  { token: "anthropic-ai", vendor: "Anthropic", purpose: "legacy training token" },
  { token: "Google-Extended", vendor: "Google", purpose: "Gemini training / grounding" },
  { token: "PerplexityBot", vendor: "Perplexity", purpose: "search index" },
  { token: "Perplexity-User", vendor: "Perplexity", purpose: "user-triggered fetch" },
  { token: "Applebot-Extended", vendor: "Apple", purpose: "Apple Intelligence training" },
  { token: "Bytespider", vendor: "ByteDance", purpose: "model training" },
  { token: "CCBot", vendor: "Common Crawl", purpose: "open crawl corpus" },
  { token: "Meta-ExternalAgent", vendor: "Meta", purpose: "model training" },
  { token: "Amazonbot", vendor: "Amazon", purpose: "assistant / training" },
  { token: "Diffbot", vendor: "Diffbot", purpose: "knowledge graph" },
  { token: "DuckAssistBot", vendor: "DuckDuckGo", purpose: "DuckAssist answers" },
  { token: "cohere-ai", vendor: "Cohere", purpose: "model training" },
  { token: "Timpibot", vendor: "Timpi", purpose: "search index" },
  { token: "YouBot", vendor: "You.com", purpose: "search index" },
];
