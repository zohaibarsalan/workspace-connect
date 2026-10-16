import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizationUrl,
  clientConfig,
  failedResponse,
  importCredentials,
  installation,
  redirectUri,
  serverSpec,
  validateClientSecret,
} from "../dist/core.js";

const oauth = {
  web: {
    client_id: "example.apps.googleusercontent.com",
    client_secret: "test-only-value",
    redirect_uris: [redirectUri],
  },
};

test("both clients share one directory and preserve paths with spaces as argv", () => {
  const config = clientConfig(
    "/tmp/private account",
    "/tmp/my project/dist/cli.js",
    "/usr/bin/node",
  );
  assert.deepEqual(installation("codex", config).args.slice(-5), [
    "/usr/bin/node",
    "/tmp/my project/dist/cli.js",
    "serve",
    "--config-dir",
    "/tmp/private account",
  ]);
  assert.deepEqual(
    installation("claude", config).args.slice(-5),
    installation("codex", config).args.slice(-5),
  );
  const spec = serverSpec("/tmp/private account");
  assert.ok(spec.args.includes("workspace-mcp==2.1.0"));
  assert.deepEqual(spec.args.slice(-5), [
    "--tools",
    "drive",
    "docs",
    "--tool-tier",
    "complete",
  ]);
  assert.equal(spec.env.GOOGLE_OAUTH_REDIRECT_URI, redirectUri);
  assert.throws(() => serverSpec("relative"));
});

test("rejects the wrong OAuth client type and callback before saving credentials", () => {
  for (const bad of [
    null,
    {},
    { installed: oauth.web },
    { web: { ...oauth.web, client_secret: "" } },
    {
      web: {
        ...oauth.web,
        redirect_uris: ["http://localhost:8000/oauth2callback"],
      },
    },
  ]) {
    assert.throws(() => validateClientSecret(bad));
  }
  validateClientSecret(oauth);
});

test("credential import keeps secrets private and never overwrites a connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-connect-"));
  try {
    const source = join(root, "download.json"),
      directory = join(root, "private");
    await writeFile(source, JSON.stringify(oauth));
    await importCredentials(source, directory);
    const saved = join(directory, "client_secret.json");
    assert.equal((await stat(saved)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    await writeFile(
      source,
      JSON.stringify({ web: { ...oauth.web, client_secret: "replacement" } }),
    );
    await assert.rejects(importCredentials(source, directory), {
      code: "EEXIST",
    });
    assert.deepEqual(JSON.parse(await readFile(saved, "utf8")), oauth);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("handles upstream validation failures even when isError is false", () => {
  assert.equal(
    failedResponse({
      isError: false,
      content: [{ type: "text", text: "Error: 'end_index' is required" }],
    }),
    true,
  );
  assert.equal(failedResponse({ isError: true }), true);
  assert.equal(
    failedResponse({ content: [{ type: "text", text: "Found 1 item." }] }),
    false,
  );
});

test("extracts only the Google authorization URL and preserves encoded parameters", () => {
  assert.equal(
    authorizationUrl(
      "Approve (https://accounts.google.com/o/oauth2/auth?state=abc&scope=a%20b).",
    ),
    "https://accounts.google.com/o/oauth2/auth?state=abc&scope=a%20b",
  );
  assert.equal(
    authorizationUrl("https://accounts.google.com.evil.example/auth"),
    undefined,
  );
  assert.equal(authorizationUrl("https://example.com/auth"), undefined);
});
