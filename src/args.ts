import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { CommandKind, LangSpec } from "./types";

export const USAGE = {
  translate: "Usage: /translate <lang>[,<lang>...] [path] [--to <out>] [--last] [-- extra instructions]",
  review: "Usage: /review-translate <lang> <translated-path> [--source <path>] [--fix] [-- extra instructions]",
  init: "Usage: /init-translate [--format csv|json|md] [--langs zh-CN,ja] [--prompts project|user] [--force]",
} as const;

/** Flags that consume the following token as their value, per command. */
const VALUE_FLAGS: Record<string, Set<string>> = {
  translate: new Set(["to"]),
  review: new Set(["source"]),
  init: new Set(["format", "langs", "prompts"]),
};

export interface ParsedArgs {
  langs: LangSpec[];
  path?: string;
  flags: Record<string, string | true>;
  /** Free text after the recognised tokens, passed verbatim to the agent as {{extra}}. */
  extra: string;
  /** Informational notices for the user (e.g. a token that was not treated as a path). */
  notes: string[];
  error?: string;
}

/** Split a command-line string into tokens; double quotes group, backslash escapes inside quotes. */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === "\\" && i + 1 < input.length) {
        cur += input[++i];
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** Validate and canonicalise a BCP 47 tag; returns undefined for malformed tags. */
export function canonicalLang(tag: string): LangSpec | undefined {
  let canonical: string;
  try {
    const [c] = Intl.getCanonicalLocales(tag);
    if (!c) return undefined;
    canonical = c;
  } catch {
    return undefined;
  }
  let name = canonical;
  try {
    name = new Intl.DisplayNames(["en"], { type: "language" }).of(canonical) ?? canonical;
  } catch {
    // keep the tag as the name
  }
  return { tag: canonical, name };
}

/** Parse "zh-CN,ja,ko" into unique LangSpecs; the error names the first bad tag. */
export function parseLangList(raw: string): { langs: LangSpec[]; error?: string } {
  const langs: LangSpec[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(",")) {
    const t = piece.trim();
    if (!t) continue;
    const spec = canonicalLang(t);
    if (!spec) {
      return { langs: [], error: `Unrecognised language tag "${t}": expected a BCP 47 tag such as zh-CN, ja or pt-BR` };
    }
    if (!seen.has(spec.tag)) {
      seen.add(spec.tag);
      langs.push(spec);
    }
  }
  return { langs };
}

/** Looks like a path the user typed on purpose: contains a separator or ends in a short extension. */
export function looksLikePath(token: string): boolean {
  return token.includes("/") || token.includes("\\") || /\.[A-Za-z0-9]{1,8}$/.test(token);
}

export interface ParseOptions {
  kind: CommandKind;
  cwd: string;
  /** Injectable for tests; defaults to fs.stat on the resolved path. */
  fileExists?: (absPath: string) => Promise<boolean>;
}

async function defaultExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export function stripAt(p: string): string {
  return p.replace(/^@/, "");
}

/**
 * Grammar (both commands):
 *   positional 1 = lang list (translate) / single lang (review)
 *   positional 2 = path (optional for translate, required for review)
 *   --flag [value] as declared in VALUE_FLAGS; everything after "--" is extra text
 *   any other token is extra text
 */
export async function parseArgs(raw: string, opts: ParseOptions): Promise<ParsedArgs> {
  const kind = opts.kind;
  const exists = opts.fileExists ?? defaultExists;
  const tokens = tokenize(raw);
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  const extraParts: string[] = [];
  const notes: string[] = [];
  const valueFlags = VALUE_FLAGS[kind];

  let afterDashDash = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (afterDashDash) {
      extraParts.push(t);
      continue;
    }
    if (t === "--") {
      afterDashDash = true;
      continue;
    }
    if (t.startsWith("--") && t.length > 2) {
      const eq = t.indexOf("=");
      const name = eq > 0 ? t.slice(2, eq) : t.slice(2);
      if (eq > 0) {
        flags[name] = t.slice(eq + 1);
      } else if (valueFlags.has(name)) {
        const v = tokens[i + 1];
        if (v === undefined || v.startsWith("--")) {
          return fail(`--${name} needs a value`);
        }
        flags[name] = v;
        i++;
      } else {
        flags[name] = true;
      }
      continue;
    }
    if (positionals.length < 2) {
      positionals.push(t);
    } else {
      extraParts.push(t);
    }
  }

  const empty: ParsedArgs = { langs: [], flags, extra: "", notes };

  if (positionals.length === 0) return fail(USAGE[kind]);

  const langList = parseLangList(positionals[0]);
  if (langList.error) return fail(langList.error);
  if (langList.langs.length === 0) return fail(USAGE[kind]);
  if (kind === "review" && langList.langs.length > 1) {
    return fail("/review-translate takes exactly one target language");
  }
  if (kind === "translate" && langList.langs.length > 1 && flags.to) {
    return fail("--to works with a single target language; for several languages set output.pattern in translation.config.json");
  }

  let path: string | undefined;
  const second = positionals[1];
  if (second !== undefined) {
    const abs = resolve(opts.cwd, stripAt(second));
    if (await exists(abs)) {
      path = second;
    } else if (kind === "review") {
      return fail(`File not found: ${abs}`);
    } else if (looksLikePath(second)) {
      return fail(`File not found: ${abs}`);
    } else {
      notes.push(`"${second}" is not a file; treating it as extra instructions`);
      extraParts.unshift(second);
    }
  } else if (kind === "review") {
    return fail(USAGE.review);
  }

  return { ...empty, langs: langList.langs, path, extra: extraParts.join(" ").trim() };

  function fail(message: string): ParsedArgs {
    return { ...empty, error: message };
  }
}

/** Parse the /init-translate argument string. */
export interface InitArgs {
  format: "csv" | "json" | "md";
  langs: LangSpec[];
  prompts: "project" | "user";
  force: boolean;
  error?: string;
}

export function parseInitArgs(raw: string): InitArgs {
  const tokens = tokenize(raw);
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith("--")) return { ...INIT_DEFAULTS, error: USAGE.init };
    const eq = t.indexOf("=");
    const name = eq > 0 ? t.slice(2, eq) : t.slice(2);
    if (eq > 0) {
      flags[name] = t.slice(eq + 1);
    } else if (VALUE_FLAGS.init.has(name)) {
      const v = tokens[i + 1];
      if (v === undefined || v.startsWith("--")) return { ...INIT_DEFAULTS, error: `--${name} needs a value` };
      flags[name] = v;
      i++;
    } else {
      flags[name] = true;
    }
  }
  const format = String(flags.format ?? "csv");
  if (format !== "csv" && format !== "json" && format !== "md") {
    return { ...INIT_DEFAULTS, error: `--format must be csv, json or md (got "${format}")` };
  }
  const prompts = String(flags.prompts ?? "project");
  if (prompts !== "project" && prompts !== "user") {
    return { ...INIT_DEFAULTS, error: `--prompts must be project or user (got "${prompts}")` };
  }
  const langList = parseLangList(String(flags.langs ?? "zh-CN"));
  if (langList.error) return { ...INIT_DEFAULTS, error: langList.error };
  if (langList.langs.length === 0) return { ...INIT_DEFAULTS, error: "--langs needs at least one language tag" };
  return { format, langs: langList.langs, prompts, force: flags.force === true };
}

const INIT_DEFAULTS: InitArgs = { format: "csv", langs: [], prompts: "project", force: false };

/**
 * Argument completion for the first positional: offers configured target languages.
 * Handles a comma-separated prefix by completing only the last segment.
 */
export function completeLangs(prefix: string, targets: readonly string[]): { value: string; label: string }[] | null {
  if (prefix.includes(" ")) return null; // past the language argument
  const lastComma = prefix.lastIndexOf(",");
  const head = lastComma >= 0 ? prefix.slice(0, lastComma + 1) : "";
  const tail = lastComma >= 0 ? prefix.slice(lastComma + 1) : prefix;
  const already = new Set(head.split(",").filter(Boolean));
  const items = targets
    .filter((t) => !already.has(t) && t.toLowerCase().startsWith(tail.toLowerCase()))
    .map((t) => ({ value: head + t, label: t }));
  return items.length > 0 ? items : null;
}
