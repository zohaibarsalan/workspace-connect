import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const upstreamVersion = "2.1.0";
export const serverName = "google-workspace";
export const callbackPort = 8769;
export const redirectUri = `http://localhost:${callbackPort}/oauth2callback`;

export function configDirectory(input?: string): string {
  const value =
    input ??
    process.env["WORKSPACE_CONNECT_CONFIG_DIR"] ??
    join(homedir(), ".config", "workspace-connect");
  return resolve(
    value.startsWith("~/") ? join(homedir(), value.slice(2)) : value,
  );
}

export function serverSpec(directory: string) {
  if (!isAbsolute(directory))
    throw new Error("Use an absolute configuration directory.");
  return {
    command: "uv",
    args: [
      "tool",
      "run",
      "--from",
      `workspace-mcp==${upstreamVersion}`,
      "workspace-mcp",
      "--transport",
      "stdio",
      "--single-user",
      "--tools",
      "drive",
      "docs",
      "--tool-tier",
      "complete",
    ],
    env: {
      GOOGLE_CLIENT_SECRET_PATH: join(directory, "client_secret.json"),
      WORKSPACE_MCP_CREDENTIALS_DIR: join(directory, "credentials"),
      WORKSPACE_MCP_PORT: String(callbackPort),
      GOOGLE_OAUTH_REDIRECT_URI: redirectUri,
      MCP_ENABLE_OAUTH21: "false",
    },
  };
}

export function clientConfig(directory: string, entry: string, node: string) {
  return { command: node, args: [entry, "serve", "--config-dir", directory] };
}

export function installation(
  client: "codex" | "claude",
  config: ReturnType<typeof clientConfig>,
) {
  const command = [config.command, ...config.args];
  return client === "codex"
    ? { command: "codex", args: ["mcp", "add", serverName, "--", ...command] }
    : {
        command: "claude",
        args: [
          "mcp",
          "add",
          "--scope",
          "user",
          "--transport",
          "stdio",
          serverName,
          "--",
          ...command,
        ],
      };
}

export function validateClientSecret(input: unknown): void {
  if (typeof input !== "object" || input === null || !("web" in input)) {
    throw new Error(
      "Download a Web application OAuth client JSON from Google Cloud.",
    );
  }
  const web: unknown = input.web;
  if (
    typeof web !== "object" ||
    web === null ||
    !("client_id" in web) ||
    !("client_secret" in web) ||
    typeof web.client_id !== "string" ||
    !web.client_id.endsWith(".apps.googleusercontent.com") ||
    typeof web.client_secret !== "string" ||
    !web.client_secret
  ) {
    throw new Error(
      "The OAuth client JSON is missing a valid client ID or secret.",
    );
  }
  if (
    !("redirect_uris" in web) ||
    !Array.isArray(web.redirect_uris) ||
    !web.redirect_uris.includes(redirectUri)
  ) {
    throw new Error(
      `Add this exact authorized redirect URI in Google Cloud: ${redirectUri}`,
    );
  }
}

export async function importCredentials(
  source: string,
  directory: string,
): Promise<void> {
  const contents = await readFile(source, "utf8");
  validateClientSecret(JSON.parse(contents));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(join(directory, "credentials"), { recursive: true, mode: 0o700 });
  const target = join(directory, "client_secret.json");
  // Never overwrite an existing connection, even when two installers race.
  await copyFile(source, target, constants.COPYFILE_EXCL);
  await chmod(target, 0o600);
}

export function responseText(result: unknown): string {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  )
    return "";
  return result.content
    .flatMap((part: unknown) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      )
        return [part.text];
      return [];
    })
    .join("\n");
}

export function authorizationUrl(text: string): string | undefined {
  const match = text.match(
    /https:\/\/accounts\.google\.com\/[^\s<>"')]+/u,
  )?.[0];
  return match ? new URL(match).href : undefined;
}

export function failedResponse(result: unknown): boolean {
  if (typeof result !== "object" || result === null || !("content" in result))
    return true;
  return (
    ("isError" in result && result.isError === true) ||
    /^\s*Error:/mu.test(responseText(result))
  );
}
