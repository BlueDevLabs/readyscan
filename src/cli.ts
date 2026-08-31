#!/usr/bin/env node
/** Command-line entry point. */

import { FetchError } from "./fetcher.js";
import {
  scan,
  VERSION,
  InvalidTargetError,
  type CheckName,
} from "./index.js";
import {
  exceedsThreshold,
  renderJson,
  renderText,
  type Severity,
} from "./report.js";
import { setColorEnabled } from "./util/color.js";

const HELP = `readyscan v${VERSION}
Audit a site's security headers and its readiness for AI crawlers.

USAGE
  readyscan <command> <url> [options]

COMMANDS
  headers <url>        Security / HTTP response-header check
  ai-readiness <url>   robots.txt, llms.txt, sitemap, AI crawler directives,
                       Markdown negotiation, crawl headers, page metadata
  all <url>            Run every check (also the default for a bare URL)

OPTIONS
  --json                 Emit the full report as JSON
  --fail-on <level>      Exit 2 if any finding is >= level (high | medium | low)
  -A, --user-agent <ua>  Override the request User-Agent
  --timeout <ms>         Per-request timeout (default 15000)
  --max-redirects <n>    Redirect hops to follow (default 10)
  --no-color             Disable ANSI colour
  -h, --help             Show this help
  -v, --version          Print the version

EXAMPLES
  readyscan all example.com
  readyscan headers https://example.com --fail-on medium
  readyscan ai-readiness example.com --json
`;

class UsageError extends Error {}

interface ParsedCli {
  command: "headers" | "ai-readiness" | "all";
  target: string;
  json: boolean;
  userAgent: string | undefined;
  timeoutMs: number;
  maxRedirects: number;
  failOn: Severity | undefined;
}

type ParseResult = ParsedCli | { help: true } | { version: true };

function takeValue(args: string[], flag: string): string {
  const value = args.shift();
  if (value === undefined) throw new UsageError(`${flag} needs a value.`);
  return value;
}

function toInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`${flag} needs a non-negative number (got "${value}").`);
  }
  return Math.floor(n);
}

function toSeverity(value: string): Severity {
  if (value === "high" || value === "medium" || value === "low") return value;
  throw new UsageError(`--fail-on must be high, medium or low (got "${value}").`);
}

function parseArgs(argv: string[]): ParseResult {
  const args = [...argv];
  let command: ParsedCli["command"] | null = null;
  const positionals: string[] = [];
  let json = false;
  let noColor = false;
  let userAgent: string | undefined;
  let timeoutMs = 15_000;
  let maxRedirects = 10;
  let failOn: Severity | undefined;

  while (args.length) {
    const arg = args.shift() as string;
    switch (arg) {
      case "-h":
      case "--help":
        return { help: true };
      case "-v":
      case "--version":
        return { version: true };
      case "--json":
        json = true;
        break;
      case "--no-color":
        noColor = true;
        break;
      case "-A":
      case "--user-agent":
        userAgent = takeValue(args, arg);
        break;
      case "--timeout":
        timeoutMs = toInt(takeValue(args, arg), arg);
        break;
      case "--max-redirects":
        maxRedirects = toInt(takeValue(args, arg), arg);
        break;
      case "--fail-on":
        failOn = toSeverity(takeValue(args, arg));
        break;
      default: {
        if (arg.startsWith("-")) throw new UsageError(`Unknown option: ${arg}`);
        const asCommand =
          arg === "ai" ? "ai-readiness" : arg === "headers" || arg === "ai-readiness" || arg === "all" ? arg : null;
        if (!command && asCommand) command = asCommand;
        else positionals.push(arg);
      }
    }
  }

  if (noColor) setColorEnabled(false);

  if (!command && positionals.length) command = "all";
  if (!command) return { help: true };

  const target = positionals[0];
  if (!target) throw new UsageError(`Missing <url> for "${command}".`);
  if (positionals.length > 1) {
    throw new UsageError(`Unexpected argument: ${positionals[1]}`);
  }

  return { command, target, json, userAgent, timeoutMs, maxRedirects, failOn };
}

async function main(): Promise<number> {
  let parsed: ParseResult;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n\nRun "readyscan --help" for usage.\n`);
      return 1;
    }
    throw err;
  }

  if ("help" in parsed) {
    process.stdout.write(HELP);
    return 0;
  }
  if ("version" in parsed) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const checks: CheckName[] =
    parsed.command === "all" ? ["headers", "ai-readiness"] : [parsed.command];

  try {
    const report = await scan(parsed.target, {
      checks,
      userAgent: parsed.userAgent,
      timeoutMs: parsed.timeoutMs,
      maxRedirects: parsed.maxRedirects,
    });
    process.stdout.write((parsed.json ? renderJson(report) : renderText(report)) + "\n");
    return parsed.failOn && exceedsThreshold(report, parsed.failOn) ? 2 : 0;
  } catch (err) {
    if (err instanceof InvalidTargetError || err instanceof FetchError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
