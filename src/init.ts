import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { SCHEMA_URL } from "./config";
import { parseGlossary, serializeGlossary } from "./glossary";
import { CONFIG_FILE, STYLE_GUIDE_FILE } from "./discover";
import { OVERRIDE_DIR } from "./paths";
import type { GlossaryFormat, TranslationConfig } from "./types";

export interface InitOptions {
  cwd: string;
  /** Pi's project config dir name, normally ".pi" (CONFIG_DIR_NAME). */
  configDirName: string;
  /** Pi's user agent dir, normally ~/.pi/agent (getAgentDir()). */
  agentDir: string;
  /** Package defaults/ directory. */
  defaultsDir: string;
  format: GlossaryFormat;
  langs: string[];
  prompts: "project" | "user";
  force: boolean;
  trusted: boolean;
}

export type InitStatus = "written" | "skipped" | "error";

export interface InitFileResult {
  /** Path relative to cwd when inside it, otherwise absolute. */
  file: string;
  absPath: string;
  status: InitStatus;
  reason?: string;
}

export interface InitResult {
  results: InitFileResult[];
  error?: string;
}

/**
 * Write a default for every file the plugin can load:
 * glossary.<ext>, translation.config.json, style-guide.md, and the two prompt templates.
 * Each file is skipped independently when it already exists unless `force`.
 * Nothing is written when the project is not trusted.
 */
export async function runInit(opts: InitOptions): Promise<InitResult> {
  if (!opts.trusted) {
    return { results: [], error: "Project is not trusted; nothing written (run /trust and retry)" };
  }

  const exampleEntries = parseGlossary(await readFile(join(opts.defaultsDir, "glossary.example.json"), "utf8"), "json");
  const exampleConfig = JSON.parse(await readFile(join(opts.defaultsDir, "translation.config.example.json"), "utf8")) as TranslationConfig;
  const styleGuide = await readFile(join(opts.defaultsDir, "style-guide.example.md"), "utf8");
  const translateTpl = await readFile(join(opts.defaultsDir, "translate.md"), "utf8");
  const reviewTpl = await readFile(join(opts.defaultsDir, "review.md"), "utf8");

  // "$schema" first so editors pick it up; the plugin's own validator ignores the key.
  const config: TranslationConfig & { $schema: string } = { $schema: SCHEMA_URL, ...exampleConfig, targets: [...opts.langs] };
  const promptsDir =
    opts.prompts === "user" ? join(opts.agentDir, OVERRIDE_DIR) : join(opts.cwd, opts.configDirName, OVERRIDE_DIR);

  const targets: { absPath: string; body: string }[] = [
    { absPath: join(opts.cwd, `glossary.${opts.format}`), body: serializeGlossary(exampleEntries, opts.format, opts.langs) },
    { absPath: join(opts.cwd, CONFIG_FILE), body: JSON.stringify(config, null, 2) + "\n" },
    { absPath: join(opts.cwd, STYLE_GUIDE_FILE), body: styleGuide },
    { absPath: join(promptsDir, "translate.md"), body: translateTpl },
    { absPath: join(promptsDir, "review.md"), body: reviewTpl },
  ];

  const results: InitFileResult[] = [];
  for (const t of targets) {
    const rel = relative(opts.cwd, t.absPath);
    const file = rel && !rel.startsWith("..") ? rel : t.absPath;
    try {
      await mkdir(dirname(t.absPath), { recursive: true });
      // "wx" fails with EEXIST when the file exists: no stat-then-write race.
      await writeFile(t.absPath, t.body, { encoding: "utf8", flag: opts.force ? "w" : "wx" });
      results.push({ file, absPath: t.absPath, status: "written" });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        results.push({ file, absPath: t.absPath, status: "skipped", reason: "exists; use --force to overwrite" });
      } else {
        results.push({ file, absPath: t.absPath, status: "error", reason: (err as Error).message });
      }
    }
  }
  return { results };
}

export function formatInitLine(r: InitFileResult): string {
  const status = r.status.padEnd(8);
  return r.reason ? `${status}${r.file} (${r.reason})` : `${status}${r.file}`;
}

export const INIT_NEXT_STEPS = [
  "Edit the glossary and translation.config.json, then run /translate <lang> <file>. Prompt templates live in the bestony-translate/ directory that was just written.",
  "Commit these files: glossary.*, translation.config.json, style-guide.md and .pi/bestony-translate/ belong in version control (the plugin never adds them to .gitignore).",
] as const;
