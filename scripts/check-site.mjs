import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
const root = resolve("docs");
for (const file of (await readdir(root)).filter((name) =>
  name.endsWith(".html"),
)) {
  const text = await readFile(join(root, file), "utf8");
  assert.match(text, /<html lang="en">/);
  assert.match(text, /name="viewport"/);
  assert.match(text, /<title>[^<]+<\/title>/);
  assert.ok(
    !/<script\b|fonts\.google|GOCSPX-|AIza[A-Za-z0-9_-]{20}/i.test(text),
    `${file}: unexpected script or credential`,
  );
  for (const match of text.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = match[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const local = href.split("#")[0];
    const target = resolve(dirname(join(root, file)), local || ".");
    assert.ok(target.startsWith(root), `Link leaves site: ${href}`);
    await stat(target);
  }
  if (file === "index.html") assert.ok(text.includes('href="privacy.html"'));
}
const css = await readFile(join(root, "style.css"), "utf8");
assert.ok(
  !/@import|url\(https?:/.test(css),
  "Fonts and assets must be self-contained.",
);
console.log(
  "Static pages, relative links, privacy link, and external-resource checks passed.",
);
