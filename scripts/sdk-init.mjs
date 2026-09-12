#!/usr/bin/env node
// Headless check: does the pi SDK dispatch extension commands from session.prompt()?
// Loads this package's extension through DefaultResourceLoader and runs /init-translate
// in a fresh temp project. Prints which files were written and what ended up in the session.
//
//   node scripts/sdk-init.mjs
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "..", "extensions", "index.ts");

const cwd = mkdtempSync(join(tmpdir(), "bt-sdk-"));
mkdirSync(join(cwd, ".git")); // make it a repo root so discovery stops here
const agentDir = mkdtempSync(join(tmpdir(), "bt-agent-"));
// Non-interactive runs never show a trust prompt; they use defaultProjectTrust from global settings.
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "always" }), "utf8");

const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  additionalExtensionPaths: [extensionPath],
  noSkills: true,
  noPromptTemplates: true,
  noContextFiles: true,
});
// A caller-supplied loader must be loaded explicitly (createAgentSession only reloads the loader it creates itself).
await loader.reload();

const { session, extensionsResult } = await createAgentSession({
  cwd,
  agentDir,
  sessionManager: SessionManager.inMemory(cwd),
  resourceLoader: loader,
});

console.log("extensions loaded:", extensionsResult.extensions.map((e) => e.path));
console.log("errors:", extensionsResult.errors);

let preflight;
await session.prompt("/init-translate --langs zh-CN,ja", { preflightResult: (ok) => (preflight = ok) });
await session.waitForIdle();

const listing = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((d) => d.isFile()).map((d) => join(d.parentPath ?? d.path, d.name).slice(cwd.length + 1));
console.log("preflight accepted:", preflight);
console.log("files written:", listing(cwd).filter((f) => !f.startsWith(".git/")));
console.log("session messages:", session.messages.map((m) => ({ role: m.role, preview: typeof m.content === "string" ? m.content.slice(0, 60) : Array.isArray(m.content) ? m.content.map((c) => c.type).join(",") : "" })));
session.dispose();
