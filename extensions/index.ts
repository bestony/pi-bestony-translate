import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import { completeLangs } from "../src/args";
import { formatIssue } from "../src/structure";
import { CUSTOM_TYPE, PluginState, STRUCTURE_ENTRY_TYPE, checkCommand, initCommand, run, runPendingChecks, type RunDetails, type StructureEntryData } from "../src/run";

// pi loads extensions via jiti. Extensionless relative imports into ../src were verified to
// resolve with pi 0.85.1 (`pi -e ./extensions/index.ts -p "/init-translate"`), as did dispatch of
// extension commands from `pi -p`. If a future jiti requires explicit extensions, switch to
// "../src/run.ts".

export default function (pi: ExtensionAPI) {
  const state = new PluginState();

  // Clear the discovery cache and pre-read translation.config.json for argument completion.
  pi.on("session_start", async (_event, ctx) => {
    await state.prime(ctx.cwd);
  });

  // The assembled prompt participates in LLM context but renders as a one-line summary;
  // expand the message to see the full prompt.
  pi.registerMessageRenderer(CUSTOM_TYPE, (message, options, theme) => {
    const d = message.details as RunDetails | undefined;
    const head = d
      ? theme.fg("accent", `[${d.command === "review" ? "review-translate" : d.command} → ${d.targetLang}] `) +
        `${d.sourceLabel} · glossary ${d.glossaryCount} terms · prompt: ${d.promptSource}${d.deferred ? " · large file, agent reads in segments" : ""}`
      : theme.fg("accent", `[${CUSTOM_TYPE}]`);
    const body = options.expanded ? "\n" + theme.fg("dim", String(message.content)) : "";
    return new Text(head + body, options.outputPad, 0);
  });

  // After the agent has fully settled (no retry / compaction / queued follow-up left), verify the
  // structure of every file a /translate or /review-translate --fix run wrote. Read-only.
  pi.on("agent_settled", async (_event, ctx) => {
    await runPendingChecks(pi, ctx, state);
  });

  // Structure-check results live in the transcript as custom entries (not sent to the model).
  pi.registerEntryRenderer(STRUCTURE_ENTRY_TYPE, (entry, options, theme) => {
    const d = entry.data as StructureEntryData;
    const head = (d.ok ? theme.fg("success", "✓ ") : theme.fg("warning", "! ")) + `${d.outputPath} — ${d.summary}`;
    const body = options.expanded || !d.ok ? d.issues.map((i) => "\n  " + theme.fg("dim", formatIssue(i))).join("") : "";
    return new Text(head + body, 0, 0);
  });

  const langCompletions = (prefix: string): AutocompleteItem[] | null => completeLangs(prefix, state.targets);

  pi.registerCommand("translate", {
    description: "Translate a file or pasted text using the project glossary; several languages: zh-CN,ja",
    getArgumentCompletions: langCompletions,
    handler: (args, ctx) => run(pi, ctx, state, "translate", args),
  });

  pi.registerCommand("review-translate", {
    description: "Review a translation against the project glossary; --source <path>, --fix to apply edits",
    getArgumentCompletions: langCompletions,
    handler: (args, ctx) => run(pi, ctx, state, "review", args),
  });

  pi.registerCommand("translate-check", {
    description: "Compare a translated file's structure (JSON keys/placeholders, frontmatter, headings, code blocks, links) against its source",
    handler: (args, ctx) => checkCommand(pi, ctx, args),
  });

  pi.registerCommand("init-translate", {
    description: "Write default glossary, translation.config.json, style-guide.md and prompt templates into this project",
    handler: (args, ctx) => initCommand(ctx, args),
  });
}
