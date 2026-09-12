import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyInput, formatRules, hasFrontmatter } from "../src/formats";
import { runInit } from "../src/init";
import { assemble, stripFrontmatter } from "../src/prompts";
import { JSON_OUTPUT, MARKDOWN_OUTPUT, reviewOutputFormat } from "../src/review-output";
import { SUGGESTIONS_DISABLED_TEXT, suggestionInstructions, suggestionsPath } from "../src/suggestions";
import { DEFAULTS, FIXTURES, makeTempDir } from "./helpers";

const POST = join(FIXTURES, "repo-a", "docs", "post.md");
const SCRIPT = join(FIXTURES, "..", "..", "scripts", "review-exit-code.mjs");

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const vars = (overrides: Record<string, string>) => ({
  format_rules: "",
  source_lang: "en",
  target_lang: "zh-CN",
  target_lang_name: "Chinese (China)",
  target_langs: "zh-CN",
  source_text: "body",
  source_path: "/p/docs/post.md",
  translated_text: "",
  translated_path: "",
  output_path: "/p/docs/post.zh-CN.md",
  glossary: "(none)",
  rules: "(none)",
  style_guide: "(none)",
  extra: "(none)",
  mode: "report",
  ...overrides,
});

describe("item 6: frontmatter-aware Markdown", () => {
  it("classifies an .md with a YAML frontmatter block", async () => {
    const body = await readFile(POST, "utf8");
    expect(hasFrontmatter(body)).toBe(true);
    expect(classifyInput(POST, body)).toBe("markdown-frontmatter");
    expect(classifyInput(join(FIXTURES, "repo-a", "docs", "intro.md"), "# Intro\n")).toBe("markdown");
    expect(classifyInput("/p/a.md")).toBe("markdown"); // no body → cannot know
    expect(classifyInput("/p/a.txt", "---\nx: 1\n---\n")).toBe("text"); // only .md gets the variant
  });

  it("puts the allowlist rule into the assembled translate prompt", async () => {
    const body = await readFile(POST, "utf8");
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "translate.md"), "utf8")).body;
    const rules = formatRules({ format: classifyInput(POST, body), kind: "translate", body });
    const r = assemble(tpl, vars({ format_rules: rules, source_text: body, suggestions: SUGGESTIONS_DISABLED_TEXT }), "source_text");
    expect(r.unknown).toEqual([]);
    expect(r.prompt).toContain("Markdown with a YAML frontmatter block");
    expect(r.prompt).toContain("Translate only the string values of these keys: title, subtitle, description, summary, excerpt, tagline, seo_title, seo_description.");
    expect(r.prompt).toMatch(/Leave all other frontmatter values exactly as they are: date, slug/);
    expect(r.prompt).toContain("lists such as tags or categories");
    expect(r.prompt).toContain("date: 2026-09-11");
    expect(r.prompt).toContain("slug: getting-started-agent");
  });

  it("adds a frontmatter review dimension only for review", async () => {
    const body = await readFile(POST, "utf8");
    expect(formatRules({ format: "markdown-frontmatter", kind: "review", body })).toContain("Review dimension for frontmatter");
    expect(formatRules({ format: "markdown-frontmatter", kind: "translate", body })).not.toContain("Review dimension");
  });
});

describe("item 2: glossary suggestions", () => {
  const glossary = { path: "/p/glossary.csv", format: "csv" as const, entries: [] };

  it("points at glossary.suggested.<ext> next to the glossary and never at the glossary itself", () => {
    expect(suggestionsPath(glossary, "/p/docs")).toEqual({ path: "/p/glossary.suggested.csv", format: "csv" });
    expect(suggestionsPath({ ...glossary, path: "/p/glossary.json", format: "json" }, "/p")).toEqual({ path: "/p/glossary.suggested.json", format: "json" });
    expect(suggestionsPath(undefined, "/p")).toEqual({ path: "/p/glossary.suggested.csv", format: "csv" });
  });

  it("assembled prompt contains the instruction iff suggestions are enabled", async () => {
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "translate.md"), "utf8")).body;
    const on = suggestionInstructions({ enabled: true, glossary, cwd: "/p", lang: "zh-CN" });
    const off = suggestionInstructions({ enabled: false, glossary, cwd: "/p", lang: "zh-CN" });

    const withOn = assemble(tpl, vars({ suggestions: on }), "source_text");
    expect(withOn.unknown).toEqual([]);
    expect(withOn.prompt).toContain("### Glossary suggestions");
    expect(withOn.prompt).toContain("Append them to /p/glossary.suggested.csv");
    expect(withOn.prompt).toContain("Never write to /p/glossary.csv itself");
    expect(withOn.prompt).toContain("occur at least twice");

    const withOff = assemble(tpl, vars({ suggestions: off }), "source_text");
    expect(withOff.prompt).not.toContain("glossary.suggested");
    expect(withOff.prompt).toContain(SUGGESTIONS_DISABLED_TEXT);
  });

  it("is appended when a user template omits the placeholder", () => {
    const r = assemble("Translate {{source_text}}", vars({ suggestions: "SUGGEST-BLOCK" }), "source_text");
    expect(r.appended).toContain("suggestions");
    expect(r.prompt).toMatch(/## Glossary suggestions\nSUGGEST-BLOCK/);
  });

  it("describes the JSON append mode for JSON glossaries", () => {
    const text = suggestionInstructions({ enabled: true, glossary: { ...glossary, path: "/p/glossary.json", format: "json" }, cwd: "/p", lang: "ja" });
    expect(text).toContain("/p/glossary.suggested.json");
    expect(text).toContain('"targets": { "ja": string }');
  });
});

describe("item 3: --json review output", () => {
  it("switches the output format block", async () => {
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "review.md"), "utf8")).body;
    const md = assemble(tpl, vars({ translated_text: "x", output_format: reviewOutputFormat(false) }), "translated_text");
    const json = assemble(tpl, vars({ translated_text: "x", output_format: reviewOutputFormat(true) }), "translated_text");
    expect(md.unknown).toEqual([]);
    expect(md.prompt).toContain(MARKDOWN_OUTPUT);
    expect(md.prompt).toContain("### Findings");
    expect(json.prompt).toContain(JSON_OUTPUT);
    expect(json.prompt).toContain("exactly one JSON object and nothing else");
    expect(json.prompt).toContain('"findings"');
    expect(json.prompt).toContain('"terminology"');
    expect(json.prompt).toContain('"changes"');
    expect(json.prompt).not.toContain("### Findings");
  });

  it("is appended when a user template omits {{output_format}}", () => {
    const r = assemble("Review {{translated_text}}", vars({ translated_text: "x", output_format: "JSON-BLOCK" }), "translated_text");
    expect(r.prompt).toMatch(/## Output format \(follow exactly\)\nJSON-BLOCK/);
  });

  const run = (input: string, extra: string[] = []) =>
    spawnSync(process.execPath, [SCRIPT, ...extra], { input, encoding: "utf8" });

  it("review-exit-code exits 1 on a blocker, 0 otherwise, 2 without JSON", () => {
    const blocker = JSON.stringify({ summary: "bad", verdict: "block", findings: [{ severity: "blocker" }, { severity: "minor" }], terminology: [], changes: [] });
    const clean = JSON.stringify({ summary: "ok", verdict: "ship", findings: [{ severity: "minor" }], terminology: [], changes: [] });
    const major = JSON.stringify({ summary: "meh", verdict: "fix", findings: [{ severity: "major" }], terminology: [], changes: [] });

    const r1 = run(`some pi banner text\n${blocker}\n`);
    expect(r1.status).toBe(1);
    expect(r1.stdout).toContain("verdict=block blockers=1 major=0 minor=1");

    expect(run(clean).status).toBe(0);
    expect(run(major).status).toBe(0);
    expect(run(major, ["--fail-on", "major"]).status).toBe(1);

    const r2 = run("no json here { broken");
    expect(r2.status).toBe(2);
  });
});

describe("item 5: init leaves .gitignore alone and says so", () => {
  it("does not create or modify .gitignore", async () => {
    const t = await makeTempDir();
    cleanup = t.cleanup;
    const r = await runInit({
      cwd: t.dir,
      agentDir: join(t.dir, "agent"),
      configDirName: ".pi",
      defaultsDir: DEFAULTS,
      format: "csv",
      langs: ["zh-CN"],
      prompts: "project",
      force: false,
      trusted: true,
    });
    expect(r.results.map((x) => x.file)).not.toContain(".gitignore");
    await expect(stat(join(t.dir, ".gitignore"))).rejects.toThrow();
    const { INIT_NEXT_STEPS } = await import("../src/init");
    expect(INIT_NEXT_STEPS.some((l) => /belong in version control/.test(l))).toBe(true);
  });
});
