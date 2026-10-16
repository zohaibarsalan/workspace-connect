# Workspace Connect

Google Drive and Google Docs for **Codex and Claude Code**, using one shared local Google login.

**[Homepage](https://zohaibarsalan.github.io/workspace-connect/) · [Privacy](https://zohaibarsalan.github.io/workspace-connect/privacy.html) · [Terms](https://zohaibarsalan.github.io/workspace-connect/terms.html)**

Workspace Connect is a small TypeScript installer, launcher, and connection checker around [Taylor Wilsdon’s Google Workspace MCP server](https://github.com/taylorwilsdon/google_workspace_mcp). The upstream server implements the Google tools; this project pins `workspace-mcp==2.1.0` and enables **Drive and Docs only**. It is an independent project, not an official Google, OpenAI, or Anthropic integration.

## What you can do

- Search Drive, browse folders, and read existing documents.
- Create and edit Google Docs, format text, and work with tables, tabs, and comments.
- Use the same OAuth grant from Codex and Claude Code through a private local directory.
- Check tool discovery and authenticated Drive access without printing document contents.

The upstream tools also expose file-management and sharing operations. Review agent permissions before giving an agent access. Tool names and behavior are defined by the pinned upstream version.

## Install

Requires **Node.js 24+**, [uv](https://docs.astral.sh/uv/getting-started/installation/), and the Codex and/or Claude Code CLIs on `PATH`. The code uses native argv arrays, not shell command interpolation. The first server launch uses `uv` to download the pinned Python package and its dependencies. Keep this clone in a stable directory after registering it with agents.

```sh
git clone https://github.com/zohaibarsalan/workspace-connect.git
cd workspace-connect
npm ci
npm run build
```

### 1. Create your Google OAuth client

1. Create or choose a Google Cloud project. **Enabling billing is not required for this setup.**
2. Enable **Google Drive API** and **Google Docs API**.
3. Configure the Google Auth Platform with an app name, support email, and developer contact. For a personal Gmail account, use External / Testing and add your account as a test user.
4. Create an OAuth client of type **Web application**.
5. Add exactly this authorized redirect URI:

   ```text
   http://localhost:8769/oauth2callback
   ```

6. Download the OAuth client JSON and import it:

   ```sh
   node dist/cli.js credentials --file ~/Downloads/client.json
   ```

The default private directory is `~/.config/workspace-connect`. Import creates its directories with mode `0700` and the client file with `0600` on systems supporting POSIX permissions. The downloaded source is left in place; protect or remove it yourself. Tokens are stored by the upstream server. This is local storage, not a claim of encryption at rest. Existing client files are never overwritten.

### 2. Register your coding agents

```sh
node dist/cli.js install --client both
# Or: --client codex / --client claude
```

This uses the official clients’ MCP registration commands, with user scope for Claude Code. Both point to the same configuration directory. It **refuses to replace an existing `google-workspace` server** and preflights both clients before making changes. If the second registration fails, the first remains registered; inspect each client’s `mcp get` output before retrying.

For other MCP clients, print the equivalent stdio configuration:

```sh
node dist/cli.js config
```

### 3. Sign in to Google

```sh
node dist/cli.js auth --email you@example.com --browser Zen
```

`--browser` opens a named browser on macOS. Elsewhere, omit it and open the printed Google URL yourself. Select your account and review the requested Drive/Docs permissions. Keep the command running until authorization completes. Authorize from **one client at a time**; the local callback uses port 8769.

Start fresh coding-agent sessions after installation. Then try:

> Find the project brief in Drive and summarize the introduction.

```sh
node dist/cli.js doctor --email you@example.com
```

Without `--email`, `doctor` checks tool discovery only. With it, it checks a read-only Drive listing. No Google files are changed by `auth` or `doctor`.

## Existing shared setups

If you already have a central MCP catalog, keep using that catalog instead of running this installer over its generated entries. You can point the launcher to an existing compatible private directory without copying credentials:

```sh
node dist/cli.js doctor --config-dir /absolute/private/directory --email you@example.com
node dist/cli.js config --config-dir /absolute/private/directory
```

That directory must contain `client_secret.json` (a Web OAuth client with the redirect URI above) and a `credentials/` subdirectory for the upstream server’s account tokens. Supply `--config-dir` to every command that uses a non-default directory. `WORKSPACE_CONNECT_CONFIG_DIR` is an alternative default.

The generated MCP entry launches this clone’s compiled `dist/cli.js`, so rebuild after source changes. To migrate, review the printed configuration and change the single entry in your central catalog; do not create duplicate Google servers. Existing client approvals and Google consent are separate from configuration presence.

## Data and permission boundaries

- OAuth client credentials and Google tokens stay in the local directory. No credentials are bundled in this repo or supplied by its maintainer.
- The local upstream server calls Google. This project does not run a hosted document proxy, analytics collector, or subscription backend.
- Tool results returned to your coding agent may be sent to its AI provider according to that account’s policies and settings. **Local MCP does not mean the AI provider processes documents locally.**
- Agent approvals are controlled by the agent client. Workspace Connect does not automatically approve sharing, deletion, or other consequential actions.
- To disconnect, revoke access in [Google Account connections](https://myaccount.google.com/connections), remove the MCP entry from each client, and delete the chosen local credential directory when appropriate. Agent history and Google files must be managed separately.

See the [privacy notice](docs/privacy.html) and [project terms](docs/terms.html).

## Google Testing, publishing, and costs

Google OAuth **Testing** grants normally expire after seven days. Run `auth` again when the grant expires. Moving an OAuth app to **In production** is a separate Google Cloud operation; publishing this website does not change that status or automatically verify your Google app.

The static site provides a homepage, privacy notice, and terms for this project. A Google project owner can use these URLs when this project and disclosure accurately describe their integration. Google may additionally require domain verification, app verification, or other information. A Pages deployment alone does not prove Google will accept an OAuth publishing request.

The connector has no subscription fee. GitHub currently provides Pages for public repositories on GitHub Free. Standard Google Drive/Docs API use is currently available at no additional cost; Google documents plans for paid usage above standard thresholds. Your AI subscriptions/usage and storage are separate. **This project cannot guarantee third-party pricing forever and never enables Google billing.**

## Development

```sh
npm run check
npm run preview
```

Tests cover credential validation and file protection, shared client arguments, OAuth URL extraction, and upstream errors returned as plain text. The site check validates relative assets, privacy links, page metadata, and the absence of third-party runtime resources.

The static GitHub Pages source is `docs/`. GitHub Actions runs the TypeScript build, tests, and site checks. Live Google verification requires your own account; CI does not contain OAuth credentials or read private documents.

## Attribution and references

- [Upstream workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp) — Google API tools; MIT licensed.
- [Codex MCP documentation](https://developers.openai.com/codex/mcp/)
- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)
- [Google OAuth expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Google API usage tiers](https://developers.google.com/workspace/tools-safety)
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

Workspace Connect is licensed under [MIT](LICENSE). Dependencies retain their own licenses.
