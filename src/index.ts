/**
 * Programmatic entry point for callers that do not go through pi's slash commands
 * (custom SDK integrations, CI scripts). Everything here is pi-independent except for
 * type imports; the pi-bound glue lives in ./run and ../extensions/index.
 *
 * Headless use through pi itself needs none of this: both `pi -p "/translate zh-CN file.md"`
 * and the SDK's `session.prompt("/translate zh-CN file.md")` dispatch the extension command
 * (verified with pi 0.85.1; the SDK needs `await loader.reload()` on a caller-supplied
 * DefaultResourceLoader before createAgentSession).
 */
export { parseArgs, parseInitArgs, parseLangList, canonicalLang, completeLangs, USAGE } from "./args";
export { discover, DiscoveryCache, GLOSSARY_FILES, CONFIG_FILE, STYLE_GUIDE_FILE } from "./discover";
export { detectInputFormat, classifyInput, hasFrontmatter, formatRules, SUPPORTED_EXTENSIONS, FRONTMATTER_TRANSLATABLE_KEYS } from "./formats";
export { suggestionInstructions, suggestionsPath, SUGGESTIONS_DISABLED_TEXT } from "./suggestions";
export { reviewOutputFormat, JSON_OUTPUT, MARKDOWN_OUTPUT } from "./review-output";
export { parseGlossary, renderGlossary, serializeGlossary } from "./glossary";
export { runInit, formatInitLine, INIT_NEXT_STEPS } from "./init";
export { OVERRIDE_DIR, defaultsDir } from "./paths";
export { assemble, loadTemplate, renderRules, outputPathFor, guessSourcePath, stripFrontmatter, TEMPLATE_FILE } from "./prompts";
export { lastAssistantText, assistantText } from "./session";
export { checkStructure, splitMarkdown, outlineMarkdown, extractPlaceholders, formatIssue, summarizeReport } from "./structure";
export { parseConfig, parseJsonWithPositions, formatConfigIssue, loadSchema, SCHEMA_URL } from "./config";
export type * from "./types";
