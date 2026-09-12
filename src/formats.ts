import { extname } from "node:path";
import type { CommandKind } from "./types";

/** Input formats the plugin knows how to instruct the agent about. */
export type InputFormat = "markdown" | "markdown-frontmatter" | "text" | "json" | "unknown";

/** Extensions supported today; anything else is treated as plain text with a warning. */
export const SUPPORTED_EXTENSIONS: Record<string, InputFormat> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".txt": "text",
  ".text": "text",
  ".json": "json",
};

/**
 * Frontmatter keys whose string values are human-readable and get translated.
 * Everything else in the frontmatter (date, slug, draft, layout, lang, permalink, author ids,
 * tags/categories used as taxonomy, lists of ids) stays untouched.
 */
export const FRONTMATTER_TRANSLATABLE_KEYS = [
  "title",
  "subtitle",
  "description",
  "summary",
  "excerpt",
  "tagline",
  "seo_title",
  "seo_description",
] as const;

/** Classification by extension only (no body needed). */
export function detectInputFormat(pathOrLabel: string | undefined): InputFormat {
  if (!pathOrLabel || pathOrLabel.startsWith("(")) return "text"; // pasted text / --last
  return SUPPORTED_EXTENSIONS[extname(pathOrLabel).toLowerCase()] ?? "unknown";
}

export function hasFrontmatter(body: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.test(body);
}

/** Classification by extension plus body: Markdown with a YAML frontmatter block gets its own rules. */
export function classifyInput(pathOrLabel: string | undefined, body?: string): InputFormat {
  const base = detectInputFormat(pathOrLabel);
  if (base === "markdown" && body && hasFrontmatter(body)) return "markdown-frontmatter";
  return base;
}

/** Describe the indentation of a JSON document so the agent can reproduce it. */
export function detectJsonIndent(body: string): string {
  const m = /\n([ \t]+)"/.exec(body);
  if (!m) return "none (single line)";
  const ws = m[1];
  if (ws.includes("\t")) return "tabs";
  return `${ws.length} spaces`;
}

export interface FormatRuleInput {
  format: InputFormat;
  kind: CommandKind;
  /** Source body (used to detect JSON indentation). Optional. */
  body?: string;
  /** Extension of an unknown format, for the note. */
  ext?: string;
}

const MARKDOWN_BODY_RULES = [
  "- Translate prose, list items, table cells, headings, alt text and link text.",
  "- Keep heading levels, list markers, table structure, link targets, image paths, HTML tags, inline code and fenced code blocks exactly as they are.",
];

/** The {{format_rules}} block: what "preserve the format" means for this input type. */
export function formatRules(input: FormatRuleInput): string {
  switch (input.format) {
    case "markdown":
      return ["Input format: Markdown (no frontmatter).", ...MARKDOWN_BODY_RULES].join("\n");
    case "markdown-frontmatter": {
      const keys = FRONTMATTER_TRANSLATABLE_KEYS.join(", ");
      const lines = [
        "Input format: Markdown with a YAML frontmatter block between the leading `---` lines.",
        "- Frontmatter: keep every key, the key order, quoting style and indentation. Translate only the string values of these keys: " + keys + ".",
        "- Leave all other frontmatter values exactly as they are: date, slug, permalink, draft, layout, lang, author and id fields, booleans, numbers, and lists such as tags or categories (they are taxonomy, not prose).",
        "- If a translatable value is a YAML list (e.g. several description lines), translate each item in place; never add or remove items.",
        "- Body (everything after the closing `---`): Markdown rules apply:",
        ...MARKDOWN_BODY_RULES.map((l) => "  " + l),
      ];
      if (input.kind === "review") {
        lines.push(
          "- Review dimension for frontmatter: report as a blocker if a key is missing, renamed or reordered, or if a non-allowlisted value (date, slug, tags, ...) was changed.",
        );
      }
      return lines.join("\n");
    }
    case "text":
      return [
        "Input format: plain text.",
        "- Translate the text; keep line breaks, blank lines, indentation and any markup-like tokens (URLs, paths, identifiers) exactly as they are.",
      ].join("\n");
    case "json": {
      const indent = input.body ? detectJsonIndent(input.body) : "the original";
      const common = [
        "Input format: JSON.",
        "- The output must be valid JSON with exactly the same structure: same keys, same nesting, same array order, same key order.",
        "- Translate only string values that are human-readable text. Never translate keys, URLs, file paths, identifiers, enum-like values, ISO dates, numbers, booleans or null.",
        "- Inside translated strings keep placeholders and markup untouched: {name}, {{count}}, %s, %d, $1, <b>…</b>, \\n escape sequences.",
        `- Keep the original indentation (${indent}) and the trailing-newline convention of the source file.`,
      ];
      if (input.kind === "review") {
        common.push(
          "- Review dimension for JSON: parse both files; report as a blocker if the translation is not valid JSON, if any key is missing or extra, if any non-string value changed, or if a placeholder inside a string was altered.",
        );
      }
      return common.join("\n");
    }
    case "unknown":
    default:
      return [
        `Input format: unrecognised${input.ext ? ` (${input.ext})` : ""}; treated as plain text.`,
        "- Translate visible prose only; keep everything that looks like markup, code, identifiers or configuration exactly as it is.",
      ].join("\n");
  }
}
