import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";

test("installation preflight preserves an existing client without registering either target", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-connect-clients-"));
  try {
    const bin = join(root, "bin"),
      log = join(root, "calls.jsonl");
    await mkdir(bin);
    for (const name of ["codex", "claude"]) {
      const source = `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(process.env.WORKSPACE_CONNECT_TEST_LOG,JSON.stringify({client:${JSON.stringify(name)},args:process.argv.slice(2)})+'\\n');process.exit(process.argv[2]==='--version'||${JSON.stringify(name)}==='codex'?0:1);\n`;
      await writeFile(join(bin, name), source, { mode: 0o755 });
    }
    const result = spawnSync(
      process.execPath,
      [resolve("dist/cli.js"), "install", "--client", "both"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: bin + delimiter + process.env.PATH,
          WORKSPACE_CONNECT_TEST_LOG: log,
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Existing configuration was preserved/);
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(calls.every((call) => !call.args.includes("add")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed credential input is rejected without echoing its contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-connect-json-"));
  try {
    const source = join(root, "bad.json");
    await writeFile(source, '{"private":"do-not-echo-this-marker",');
    const result = spawnSync(
      process.execPath,
      [
        resolve("dist/cli.js"),
        "credentials",
        "--file",
        source,
        "--config-dir",
        join(root, "private"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid OAuth client JSON/);
    assert.ok(
      !(result.stdout + result.stderr).includes("do-not-echo-this-marker"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
