#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  authorizationUrl,
  clientConfig,
  configDirectory,
  failedResponse,
  importCredentials,
  installation,
  responseText,
  serverName,
  serverSpec,
  validateClientSecret,
} from "./core.js";

const help = `Workspace Connect — Google Drive and Docs for your coding agents

  credentials --file CLIENT.json     Import your own Google OAuth Web client
  install --client both             Register with Codex and Claude Code
  config                            Print generic MCP configuration
  auth --email YOU@example.com       Sign in, or reauthorize an expired login
  doctor [--email YOU@example.com]   Check tools and optionally Drive access
  serve                             Start the local MCP server (stdio)

Options:
  --config-dir PATH                 Shared private storage (default ~/.config/workspace-connect)
  --client codex|claude|both         Install target; defaults to both
  --browser NAME                    Open Google consent in a named macOS browser, e.g. Zen
  --help                            Show this help

Requires Node.js 24+, uv, and your own Google Cloud OAuth client.
This project launches workspace-mcp 2.1.0; it is not an official Google/OpenAI/Anthropic product.
`;

async function modified(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return 0;
    throw error;
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      "config-dir": { type: "string" },
      file: { type: "string" },
      client: { type: "string" },
      email: { type: "string" },
      browser: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(help);
    return;
  }
  if (positionals.length !== 1)
    throw new Error("Pass one command. Use --help for usage.");
  const directory = configDirectory(values["config-dir"]);
  const spec = serverSpec(directory);
  const entry = fileURLToPath(import.meta.url);
  const config = clientConfig(directory, entry, process.execPath);
  if (command === "config") {
    console.log(
      JSON.stringify({ mcpServers: { [serverName]: config } }, null, 2),
    );
    return;
  }
  if (command === "credentials") {
    if (!values.file)
      throw new Error("Provide --file with the downloaded Google OAuth JSON.");
    await importCredentials(values.file, directory);
    console.log(
      "OAuth client saved locally. No credentials were sent to Workspace Connect.",
    );
    return;
  }
  if (command === "install") {
    const selected = values.client ?? "both";
    if (!["codex", "claude", "both"].includes(selected))
      throw new Error("--client must be codex, claude, or both.");
    const targets: ("codex" | "claude")[] =
      selected === "both"
        ? ["codex", "claude"]
        : [selected as "codex" | "claude"];
    // Preflight every target before making any changes.
    for (const target of targets) {
      const available = spawnSync(target, ["--version"], { stdio: "ignore" });
      if (available.error || available.status !== 0)
        throw new Error(`${target} is not available on PATH.`);
      const existing = spawnSync(target, ["mcp", "get", serverName], {
        stdio: "ignore",
      });
      if (existing.status === 0)
        throw new Error(
          `${target} already has ${serverName}. Existing configuration was preserved; use the config command to review migration manually.`,
        );
    }
    for (const target of targets) {
      const task = installation(target, config);
      const installed = spawnSync(task.command, task.args, {
        stdio: "inherit",
      });
      if (installed.error || installed.status !== 0)
        throw new Error(
          `${target} installation failed. Earlier successful registrations remain; inspect with ${target} mcp get ${serverName}.`,
        );
    }
    console.log(
      "Registered. Start fresh agent sessions to discover the tools.",
    );
    return;
  }
  if (!["serve", "auth", "doctor"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  if (spawnSync("uv", ["--version"], { stdio: "ignore" }).status !== 0)
    throw new Error(
      "Install uv from https://docs.astral.sh/uv/getting-started/installation/ first.",
    );
  validateClientSecret(
    JSON.parse(await readFile(spec.env.GOOGLE_CLIENT_SECRET_PATH, "utf8")),
  );
  await mkdir(spec.env.WORKSPACE_MCP_CREDENTIALS_DIR, {
    recursive: true,
    mode: 0o700,
  });
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...spec.env }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  // Explicit file-based credentials win over any unrelated ambient Google login.
  delete env["GOOGLE_OAUTH_CLIENT_ID"];
  delete env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (command === "serve") {
    const child = spawn(spec.command, spec.args, { env, stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => child.kill(signal));
    child.on("error", () => {
      console.error("Could not start the upstream MCP server.");
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    return;
  }
  const email = values.email;
  if (command === "auth" && !email)
    throw new Error(
      "Provide --email with the Google account you want to connect.",
    );
  if (email && !/^[^\s/@\\]+@[^\s/@\\]+\.[^\s/@\\]+$/u.test(email))
    throw new Error("Provide a valid Google email address.");
  if (values.browser && process.platform !== "darwin")
    throw new Error(
      "--browser is supported on macOS. Elsewhere, open the printed Google URL yourself.",
    );
  const client = new Client({ name: "workspace-connect", version: "0.1.0" });
  const transport = new StdioClientTransport({ ...spec, env, stderr: "pipe" });
  // Upstream diagnostics can include account information; do not forward them.
  transport.stderr?.on("data", () => {});
  const deadline = setTimeout(
    () => {
      void transport.close();
    },
    command === "auth" ? 600_000 : 60_000,
  );
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const required of [
      "list_drive_items",
      "create_doc",
      "modify_doc_text",
    ]) {
      if (!tools.some((tool) => tool.name === required))
        throw new Error(`Required tool missing: ${required}`);
    }
    console.log(`${tools.length} Drive and Docs tools discovered.`);
    if (!email) return;
    const path = join(directory, "credentials", `${email}.json`);
    const previous = await modified(path);
    const request = {
      name: "list_drive_items",
      arguments: { user_google_email: email, page_size: 1 },
    };
    let result = await client.callTool(request);
    const url = authorizationUrl(responseText(result));
    if (url) {
      if (command !== "auth")
        throw new Error("Google sign-in is required. Run the auth command.");
      console.log(`Approve the Google consent screen:\n${url}`);
      if (values.browser) {
        const opened = spawnSync("open", ["-a", values.browser, url], {
          stdio: "ignore",
        });
        if (opened.status !== 0)
          console.error(
            "Could not open that browser. Open the printed URL manually.",
          );
      }
      let completed = false;
      for (let attempt = 0; attempt < 108; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        if ((await modified(path)) !== previous) {
          completed = true;
          break;
        }
      }
      if (!completed)
        throw new Error("Google consent timed out. Run auth again when ready.");
      result = await client.callTool(request);
    }
    if (failedResponse(result))
      throw new Error(
        "Google Drive access failed. Check API enablement, the account, and consent; no document content has been printed.",
      );
    console.log(
      "Authenticated Drive access passed. Document contents were not printed.",
    );
  } finally {
    clearTimeout(deadline);
    await client.close();
  }
}

main().catch((error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  const message =
    code === "EEXIST"
      ? "A local OAuth client already exists; it was not overwritten."
      : code === "ENOENT"
        ? "OAuth client file not found. Run credentials --file CLIENT.json first, or check --config-dir."
        : error instanceof SyntaxError
          ? "Invalid OAuth client JSON; file contents were not printed."
          : error instanceof Error
            ? error.message
            : "Workspace Connect failed.";
  console.error(message);
  process.exitCode = 1;
});
