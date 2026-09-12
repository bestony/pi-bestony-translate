import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parseArgs, parseInitArgs, stripAt, type ParsedArgs } from "./args";
import { DiscoveryCache, discover } from "./discover";
import { classifyInput, formatRules, type InputFormat } from "./formats";
import { checkStructure, formatIssue, summarizeReport, type StructureReport } from "./structure";
import { tokenize } from "./args";
import { renderGlossary } from "./glossary";
import { INIT_NEXT_STEPS, formatInitLine, runInit } from "./init";
import { OVERRIDE_DIR, defaultsDir } from "./paths";
import { TEMPLATE_FILE, assemble, guessSourcePath, loadTemplate, outputPathFor, renderRules } from "./prompts";
import { reviewOutputFormat } from "./review-output";
import { lastAssistantText } from "./session";
import { suggestionInstructions } from "./suggestions";
import { mkdir, writeFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { basename } from "node:path";
import type { CommandKind, DiscoveredContext, TextSource } from "./types";

export const CUSTOM_TYPE = "bestony-translate";
/** Custom entry type for structure-check results (TUI only, never sent to the model). */
export const STRUCTURE_ENTRY_TYPE = "bestony-translate/structure";

/** A file pair to verify once the agent has finished writing. */
export interface PendingCheck {
  kind: CommandKind;
  lang: string;
  sourcePath: string;
  outputPath: string;
  /** True when the run was /review-translate --json: emit the result as a JSON line for CI. */
  json: boolean;
}

export interface StructureEntryData {
  kind: CommandKind | "check";
  lang?: string;
  sourcePath: string;
  outputPath: string;
  format: InputFormat;
  ok: boolean;
  summary: string;
  issues: StructureReport["issues"];
}

/** Source text above this size is not inlined; the agent reads the file in segments. */
export const INLINE_LIMIT = 40 * 1024;

export interface RunDetails {
  command: CommandKind;
  targetLang: string;
  sourceLabel: string;
  glossaryCount: number;
  promptSource: "project" | "user" | "default";
  deferred: boolean;
}

const SPEC = {
  translate: { bodyVar: "source_text" },
  review: { bodyVar: "translated_text" },
} as const;

/** Per-session state shared by the command handlers. */
export class PluginState {
  readonly cache = new DiscoveryCache();
  /** Target languages from the nearest translation.config.json, for argument completion. */
  targets: string[] = [];
  /** File pairs to structure-check on agent_settled. */
  pending: PendingCheck[] = [];

  async prime(cwd: string): Promise<void> {
    this.cache.clear();
    try {
      const found = await discover(cwd, this.cache);
      this.targets = found.config?.value.targets ?? [];
    } catch {
      this.targets = [];
    }
  }
}

export async function run(pi: ExtensionAPI, ctx: ExtensionCommandContext, state: PluginState, kind: CommandKind, rawArgs: string): Promise<void> {
  const a = await parseArgs(rawArgs, { kind, cwd: ctx.cwd });
  if (a.error) {
    say(ctx, a.error, "error");
    return;
  }
  for (const n of a.notes) say(ctx, n, "info");

  const found = await discover(ctx.cwd, state.cache);
  for (const w of found.warnings) say(ctx, w, "warning");

  const text = await resolveText(ctx, a);
  if (!text) {
    say(ctx, "Nothing to process: give a path, --last, or paste text into the editor", "error");
    return;
  }

  let source: TextSource = text;
  if (kind === "review") {
    const r = await resolveReviewSource(ctx, a, text, found);
    if ("error" in r) {
      say(ctx, r.error, "error");
      return;
    }
    if (r.warning) say(ctx, r.warning, "warning");
    source = r.source;
  }

  const tpl = await loadTemplate(kind, {
    project: ctx.isProjectTrusted() ? join(ctx.cwd, CONFIG_DIR_NAME, OVERRIDE_DIR, TEMPLATE_FILE[kind]) : undefined,
    user: join(getAgentDir(), OVERRIDE_DIR, TEMPLATE_FILE[kind]),
    packaged: join(defaultsDir(), TEMPLATE_FILE[kind]),
  });

  // Classify on the source body (review: the source if we have it, else the translation).
  const classifyBody = kind === "review" && source.body && !source.deferred ? source.body : text.deferred ? undefined : text.body;
  const format = classifyInput(text.label, classifyBody);
  if (format === "unknown") {
    say(ctx, `Unsupported file type for ${text.label}; treating it as plain text (supported today: .md, .txt, .json)`, "warning");
  }

  const suggestionsEnabled = kind === "translate" && a.flags["no-suggest"] !== true && found.config?.value.suggestions !== false;
  const dryRun = a.flags["dry-run"] === true;

  const shared: Record<string, string> = {
    format_rules: formatRules({ format, kind, body: text.deferred ? undefined : text.body, ext: extname(text.label) }),
    source_lang: found.config?.value.sourceLang ?? "auto",
    target_langs: a.langs.map((l) => l.tag).join(", "),
    source_text: source.body,
    source_path: source.label,
    translated_text: kind === "review" ? text.body : "",
    translated_path: kind === "review" ? text.label : "",
    rules: renderRules(found.config?.value),
    style_guide: found.styleGuide?.body ?? "(no style guide)",
    extra: a.extra || "(none)",
    mode: a.flags.fix === true ? "fix" : "report",
  };
  if (kind === "review") shared.output_format = reviewOutputFormat(a.flags.json === true);

  const usage = ctx.getContextUsage();

  // One message per target language; followUp queues them so they run in order.
  for (const lang of a.langs) {
    const glossary = renderGlossary(found.glossary?.entries, lang.tag, source.body);
    if (glossary.truncated) say(ctx, `Glossary for ${lang.tag} trimmed to the longest matching terms`, "warning");

    const sourceAbs = a.path ? resolve(ctx.cwd, stripAt(a.path)) : undefined;
    const outputPath =
      kind === "translate" && sourceAbs
        ? outputPathFor(sourceAbs, lang.tag, {
            to: typeof a.flags.to === "string" ? a.flags.to : undefined,
            pattern: found.config?.value.output?.pattern,
            cwd: ctx.cwd,
          })
        : "";

    const perLang: Record<string, string> = { ...shared, target_lang: lang.tag, target_lang_name: lang.name, glossary: glossary.markdown, output_path: outputPath };
    if (kind === "translate") {
      perLang.suggestions = suggestionInstructions({ enabled: suggestionsEnabled, glossary: found.glossary, cwd: ctx.cwd, lang: lang.tag });
    }
    const { prompt, unknown } = assemble(tpl.body, perLang, SPEC[kind].bodyVar);
    if (unknown.length) say(ctx, `Template has unknown placeholders: ${unknown.map((u) => `{{${u}}}`).join(", ")}`, "warning");

    if (dryRun) {
      // Write the assembled prompt instead of sending it; nothing reaches the model.
      const dir = join(ctx.cwd, CONFIG_DIR_NAME, OVERRIDE_DIR, "dry-run");
      const name = a.path ? basename(stripAt(a.path)) : text.label.replace(/[^\w.-]+/g, "_");
      const file = join(dir, `${kind}.${name}.${lang.tag}.prompt.md`);
      await mkdir(dir, { recursive: true });
      await writeFile(file, prompt, "utf8");
      say(ctx, `dry-run: ${kind} ${lang.tag} → prompt written to ${file}${outputPath ? `; output would go to ${outputPath}` : ""} (${prompt.length} chars, glossary ${glossary.count} terms, template: ${tpl.source})`, "info");
      continue;
    }

    if (usage && usage.contextWindow && usage.tokens != null && usage.tokens + estimateTokens(prompt) > usage.contextWindow * 0.7) {
      say(ctx, `This request will use most of the context window (${lang.tag}); consider /compact first`, "warning");
    }

    const details: RunDetails = {
      command: kind,
      targetLang: lang.tag,
      sourceLabel: text.label,
      glossaryCount: glossary.count,
      promptSource: tpl.source,
      deferred: source.deferred,
    };
    pi.sendMessage(
      { customType: CUSTOM_TYPE, content: prompt, display: true, details },
      { deliverAs: "followUp", triggerTurn: true },
    );

    // Queue the read-only structure check for when the agent has settled.
    if (sourceAbs) {
      if (kind === "translate" && outputPath) {
        state.pending.push({ kind, lang: lang.tag, sourcePath: sourceAbs, outputPath, json: false });
      } else if (kind === "review" && a.flags.fix === true && !source.label.startsWith("(")) {
        state.pending.push({ kind, lang: lang.tag, sourcePath: source.label, outputPath: sourceAbs, json: a.flags.json === true });
      }
    }
  }
}

/**
 * agent_settled handler: pi guarantees no automatic retry, compaction or queued follow-up will run
 * after this event (extensions doc, "agent_start / agent_end / agent_settled"), so every queued
 * /translate message of a multi-language batch has finished by now.
 */
export async function runPendingChecks(pi: ExtensionAPI, ctx: ExtensionContext, state: PluginState): Promise<void> {
  const batch = state.pending.splice(0);
  for (const p of batch) {
    await reportStructure(pi, ctx, await runStructureCheck(p.sourcePath, p.outputPath, p.kind, p.lang), p.json);
  }
}

export async function runStructureCheck(sourcePath: string, outputPath: string, kind: StructureEntryData["kind"], lang?: string): Promise<StructureEntryData> {
  let source: string;
  try {
    source = await readFile(sourcePath, "utf8");
  } catch {
    return { kind, lang, sourcePath, outputPath, format: "unknown", ok: false, summary: "structure: source file not readable", issues: [{ code: "source.missing", path: "", message: `cannot read ${sourcePath}` }] };
  }
  const format = classifyInput(sourcePath, source);
  let output: string;
  try {
    output = await readFile(outputPath, "utf8");
  } catch {
    return { kind, lang, sourcePath, outputPath, format, ok: false, summary: "structure: output file was not written", issues: [{ code: "output.missing", path: "", message: `expected ${outputPath}` }] };
  }
  const report = checkStructure(source, output, format);
  return { kind, lang, sourcePath, outputPath, format, ok: report.ok, summary: summarizeReport(report), issues: report.issues };
}

async function reportStructure(pi: ExtensionAPI, ctx: ExtensionContext, data: StructureEntryData, json: boolean): Promise<void> {
  pi.appendEntry(STRUCTURE_ENTRY_TYPE, data);
  say(ctx, `${basename(data.outputPath)}: ${data.summary}`, data.ok ? "info" : "warning");
  for (const issue of data.issues.slice(0, 8)) say(ctx, "  " + formatIssue(issue), "warning");
  if (data.issues.length > 8) say(ctx, `  … ${data.issues.length - 8} more (expand the structure entry in the transcript)`, "warning");
  if (json && !ctx.hasUI) {
    // CI path: one JSON line on the real stdout so `translate-review-exit-code` can merge `structure`.
    // pi's print mode redirects process.stdout.write/console.log to stderr; fs.writeSync(1) is the
    // only channel that reaches the process's stdout (verified with pi 0.85.1).
    writeSync(1, JSON.stringify({ structure: data.issues, file: data.outputPath, source: data.sourcePath, format: data.format, ok: data.ok }) + "\n");
  }
}

/**
 * Notify the user. ctx.ui.notify is a no-op in print mode (-p) and in JSON mode, so headless runs
 * would otherwise swallow errors such as "File not found"; mirror the message to stderr there.
 */
function say(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
  ctx.ui.notify(message, level);
  if (!ctx.hasUI) process.stderr.write(`[${level}] ${message}\n`);
}

/** /translate-check <source> <output> [--json]: run the structure check by hand. */
export async function checkCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, rawArgs: string): Promise<void> {
  const tokens = tokenize(rawArgs);
  const json = tokens.includes("--json");
  const paths = tokens.filter((t) => !t.startsWith("--"));
  if (paths.length !== 2) {
    say(ctx, "Usage: /translate-check <source> <output> [--json]", "error");
    return;
  }
  const [src, out] = paths.map((p) => resolve(ctx.cwd, stripAt(p)));
  await reportStructure(pi, ctx, await runStructureCheck(src, out, "check"), json);
}

function estimateTokens(s: string): number {
  // Rough: ~4 chars per token for Latin text, ~1.5 for CJK. Good enough for a warning threshold.
  let cjk = 0;
  for (const ch of s) if (/[　-鿿가-힯]/.test(ch)) cjk++;
  return Math.ceil((s.length - cjk) / 4 + cjk / 1.5);
}

async function readSource(abs: string): Promise<TextSource> {
  const st = await stat(abs);
  if (st.size > INLINE_LIMIT) {
    return {
      body: `File too large to inline; read it with the read tool in segments: ${abs} (${Math.round(st.size / 1024)} KB)`,
      label: abs,
      deferred: true,
    };
  }
  return { body: await readFile(abs, "utf8"), label: abs, deferred: false };
}

/** path → --last → editor paste → undefined */
async function resolveText(ctx: ExtensionCommandContext, a: ParsedArgs): Promise<TextSource | undefined> {
  if (a.path) return readSource(resolve(ctx.cwd, stripAt(a.path)));

  if (a.flags.last === true) {
    const last = lastAssistantText(ctx.sessionManager.getBranch());
    if (last) return { body: last, label: "(last assistant message)", deferred: false };
    say(ctx, "No assistant message found on this branch for --last", "warning");
  }

  if (ctx.hasUI) {
    const pasted = await ctx.ui.editor("Paste the text to process", "");
    if (pasted?.trim()) return { body: pasted, label: "(pasted text)", deferred: false };
  }
  return undefined;
}

/** --source → review.sourcePattern guess → monolingual (empty source). */
async function resolveReviewSource(
  ctx: ExtensionCommandContext,
  a: ParsedArgs,
  translated: TextSource,
  found: DiscoveredContext,
): Promise<{ source: TextSource; warning?: string } | { error: string }> {
  if (typeof a.flags.source === "string") {
    const abs = resolve(ctx.cwd, stripAt(a.flags.source));
    try {
      return { source: await readSource(abs) };
    } catch {
      return { error: `--source file does not exist: ${abs}` };
    }
  }
  const translatedAbs = resolve(ctx.cwd, stripAt(a.path!));
  const guess = guessSourcePath(translatedAbs, a.langs[0].tag, found.config?.value.review?.sourcePattern);
  if (guess !== translatedAbs) {
    try {
      return { source: await readSource(guess) };
    } catch {
      // fall through to monolingual
    }
  }
  return {
    source: { body: "", label: "(not found; monolingual review)", deferred: false },
    warning: `Source text not found (tried ${guess}); reviewing monolingually`,
  };
}

export async function initCommand(ctx: ExtensionCommandContext, rawArgs: string): Promise<void> {
  const args = parseInitArgs(rawArgs);
  if (args.error) {
    say(ctx, args.error, "error");
    return;
  }
  await ctx.waitForIdle();
  const result = await runInit({
    cwd: ctx.cwd,
    configDirName: CONFIG_DIR_NAME,
    agentDir: getAgentDir(),
    defaultsDir: defaultsDir(),
    format: args.format,
    langs: args.langs.map((l) => l.tag),
    prompts: args.prompts,
    force: args.force,
    trusted: ctx.isProjectTrusted(),
  });
  if (result.error) {
    say(ctx, result.error, "error");
    return;
  }
  for (const r of result.results) {
    say(ctx, formatInitLine(r), r.status === "error" ? "error" : r.status === "skipped" ? "warning" : "info");
  }
  for (const line of INIT_NEXT_STEPS) say(ctx, line, "info");
}
