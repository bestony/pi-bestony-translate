import { readFile } from "node:fs/promises";
import { join, parse as parsePath, sep } from "node:path";
import type { CommandKind, TranslationConfig } from "./types";

export type TemplateSource = "project" | "user" | "default";

export interface TemplateCandidates {
  /** Project-level override; pass undefined when the project is not trusted. */
  project?: string;
  user: string;
  packaged: string;
}

export interface LoadedTemplate {
  body: string;
  description?: string;
  source: TemplateSource;
  path: string;
}

export const TEMPLATE_FILE: Record<CommandKind, string> = {
  translate: "translate.md",
  review: "review.md",
};

/** Strip a leading YAML frontmatter block; only `description` is read. */
export function stripFrontmatter(text: string): { body: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { body: text };
  const fm = m[1];
  const desc = /^description:\s*(.*)$/m.exec(fm)?.[1]?.trim();
  return { body: text.slice(m[0].length), description: desc || undefined };
}

/** Project → user → packaged. First readable file wins. */
export async function loadTemplate(kind: CommandKind, c: TemplateCandidates): Promise<LoadedTemplate> {
  const order: [TemplateSource, string | undefined][] = [
    ["project", c.project],
    ["user", c.user],
    ["default", c.packaged],
  ];
  for (const [source, path] of order) {
    if (!path) continue;
    try {
      const raw = await readFile(path, "utf8");
      const { body, description } = stripFrontmatter(raw);
      return { body, description, source, path };
    } catch {
      // try the next layer
    }
  }
  throw new Error(`No ${TEMPLATE_FILE[kind]} template found (looked in project, user and package defaults)`);
}

/** Placeholders that hold material the plugin always injects. */
export const MATERIAL_PLACEHOLDERS: Record<string, string> = {
  format_rules: "## Format rules",
  rules: "## Project rules",
  style_guide: "## Style guide",
  glossary: "## Glossary",
  suggestions: "## Glossary suggestions",
  output_format: "## Output format (follow exactly)",
};

export const KNOWN_PLACEHOLDERS = new Set([
  "format_rules",
  "suggestions",
  "output_format",
  "source_lang",
  "target_lang",
  "target_lang_name",
  "target_langs",
  "source_text",
  "source_path",
  "translated_text",
  "translated_path",
  "output_path",
  "glossary",
  "rules",
  "style_guide",
  "extra",
  "mode",
]);

export interface AssembleResult {
  prompt: string;
  /** Placeholder names found in the template that the plugin does not know. Left as-is. */
  unknown: string[];
  /** Material / body blocks that were appended because the template omitted them. */
  appended: string[];
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Replace {{name}} placeholders. Material placeholders (glossary, rules, style_guide) and the
 * body placeholder (source_text / translated_text) are appended under a fixed heading when the
 * template does not mention them, so the glossary is always injected. Unknown placeholders stay.
 */
export function assemble(template: string, vars: Record<string, string>, bodyVar: string): AssembleResult {
  const present = new Set<string>();
  const unknown: string[] = [];
  const prompt = template.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (name in vars) {
      present.add(name);
      return vars[name];
    }
    if (!unknown.includes(name)) unknown.push(name);
    return whole;
  });

  const appended: string[] = [];
  const tail: string[] = [];
  for (const [name, heading] of Object.entries(MATERIAL_PLACEHOLDERS)) {
    if (!present.has(name) && name in vars) {
      appended.push(name);
      tail.push(`${heading}\n${vars[name]}`);
    }
  }
  if (!present.has(bodyVar) && bodyVar in vars) {
    appended.push(bodyVar);
    const heading = bodyVar === "translated_text" ? "## Translated text" : "## Source text";
    tail.push(`${heading}\n<${bodyVar}>\n${vars[bodyVar]}\n</${bodyVar}>`);
  }

  const out = tail.length ? `${prompt.trimEnd()}\n\n${tail.join("\n\n")}\n` : prompt;
  return { prompt: out, unknown, appended };
}

/** Render translation.config.json into the numbered list used for {{rules}}. */
export function renderRules(config: TranslationConfig | undefined): string {
  if (!config) return "(no project rules; translation.config.json not found)";
  const lines: string[] = [];
  if (config.tone) lines.push(`Tone: ${config.tone}`);
  if (config.doNotTranslate?.length) lines.push(`Do not translate: ${config.doNotTranslate.join(", ")}`);
  if (config.preserve?.length) lines.push(`Preserve untouched: ${config.preserve.join(", ")}`);
  if (config.sourceLang) lines.push(`Source language: ${config.sourceLang}`);
  if (config.targets?.length) lines.push(`Configured target languages: ${config.targets.join(", ")}`);
  if (lines.length === 0) return "(translation.config.json has no rules)";
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

export const DEFAULT_OUTPUT_PATTERN = "{dir}/{name}.{lang}{ext}";
export const DEFAULT_SOURCE_PATTERN = "{dir}/{name}{ext}";

/** Expand {dir} {name} {ext} {lang} in a pattern against an absolute path. */
export function expandPattern(pattern: string, absPath: string, lang: string, nameOverride?: string): string {
  const p = parsePath(absPath);
  return pattern
    .replace(/\{dir\}/g, p.dir)
    .replace(/\{name\}/g, nameOverride ?? p.name)
    .replace(/\{ext\}/g, p.ext)
    .replace(/\{lang\}/g, lang)
    .split("/")
    .join(sep);
}

export function outputPathFor(sourceAbs: string, lang: string, opts: { to?: string; pattern?: string; cwd: string }): string {
  if (opts.to) return join(opts.cwd, opts.to);
  return expandPattern(opts.pattern ?? DEFAULT_OUTPUT_PATTERN, sourceAbs, lang);
}

/**
 * Guess the source file for a translated file: strip a trailing ".<lang>" from the name
 * (docs/intro.zh-CN.md → docs/intro.md), then apply review.sourcePattern.
 */
export function guessSourcePath(translatedAbs: string, lang: string, pattern = DEFAULT_SOURCE_PATTERN): string {
  const p = parsePath(translatedAbs);
  const suffix = `.${lang}`;
  const baseName = p.name.toLowerCase().endsWith(suffix.toLowerCase()) ? p.name.slice(0, -suffix.length) : p.name;
  return expandPattern(pattern, translatedAbs, lang, baseName);
}
