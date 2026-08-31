import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import { startFixture, type Fixture } from "./fixtures/server.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function cli(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, NO_COLOR: "1" }, timeout: 20_000 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? ((err as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

test("--version prints a semver", async () => {
  const { code, stdout } = await cli(["--version"]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("--help explains usage", async () => {
  const { code, stdout } = await cli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /USAGE/);
  assert.match(stdout, /ai-readiness/);
});

test("unknown option exits 1", async () => {
  const { code, stderr } = await cli(["headers", "example.com", "--bogus"]);
  assert.equal(code, 1);
  assert.match(stderr, /Unknown option/);
});

test("invalid URL exits 1", async () => {
  const { code, stderr } = await cli(["all", "definitely not a url"]);
  assert.equal(code, 1);
  assert.match(stderr, /valid URL/i);
});

test("scans a live fixture end to end", async () => {
  const fixture: Fixture = await startFixture({
    "/": {
      headers: {
        "x-content-type-options": "nosniff",
        etag: '"v1"',
      },
      body: `<!doctype html><html lang="en"><head><title>Fixture</title>
        <meta name="description" content="A fixture page.">
        <link rel="canonical" href="/">
        <script type="application/ld+json">{"@type":"WebPage"}</script>
        </head><body>ok</body></html>`,
    },
    "/robots.txt": {
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nAllow: /\nSitemap: SITEMAP\n",
    },
    "/sitemap.xml": {
      headers: { "content-type": "application/xml" },
      body: "<urlset><url><loc>/</loc></url></urlset>",
    },
  });

  try {
    const { code, stdout } = await cli(["all", fixture.origin]);
    assert.equal(code, 0);
    assert.match(stdout, /Security headers/);
    assert.match(stdout, /AI readiness/);
    // Plain-http fixture -> the HTTPS finding must be present.
    assert.match(stdout, /not served over HTTPS/);

    const json = await cli(["ai-readiness", fixture.origin, "--json"]);
    const report = JSON.parse(json.stdout) as {
      sections: { name: string }[];
      tool: { name: string };
    };
    assert.equal(report.tool.name, "readyscan");
    assert.equal(report.sections.length, 1);
    assert.equal(report.sections[0]?.name, "AI readiness");

    // --fail-on high must trip on the plain-http finding.
    const gated = await cli(["headers", fixture.origin, "--fail-on", "high"]);
    assert.equal(gated.code, 2);
  } finally {
    await fixture.close();
  }
});
