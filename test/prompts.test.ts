import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectInputFormat, detectJsonIndent, formatRules } from "../src/formats";
import { assemble, expandPattern, guessSourcePath, loadTemplate, outputPathFor, renderRules, stripFrontmatter } from "../src/prompts";
import { reviewOutputFormat } from "../src/review-output";
import { DEFAULTS, FIXTURES } from "./helpers";

const baseVars = {
  format_rules: formatRules({ format: "markdown", kind: "translate" }),
  source_lang: "en",
  target_langs: "zh-CN, ja",
  source_text: "# Intro\n\nThe Agent runs pre-commit.",
  source_path: "/proj/docs/intro.md",
  translated_text: "",
  translated_path: "",
  rules: "1. Tone: concise",
  style_guide: "- Second person.",
  extra: "(none)",
  mode: "report",
  suggestions: "(glossary suggestions are disabled for this run)",
};

const forLang = (tag: string, name: string) => ({
  ...baseVars,
  target_lang: tag,
  target_lang_name: name,
  glossary: `| Term | Rendering | Note |\n| --- | --- | --- |\n| Agent | ${tag === "ja" ? "エージェント" : "智能体"} | |`,
  output_path: `/proj/docs/intro.${tag}.md`,
});

describe("stripFrontmatter", () => {
  it("removes the block and reads description", () => {
    const r = stripFrontmatter("---\ndescription: hello\nother: x\n---\nBody\n");
    expect(r).toEqual({ body: "Body\n", description: "hello" });
  });
  it("leaves text without frontmatter alone", () => {
    expect(stripFrontmatter("Body").body).toBe("Body");
  });
});

describe("assemble with the default translate.md", () => {
  it("fills every placeholder and appends nothing", async () => {
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "translate.md"), "utf8")).body;
    const r = assemble(tpl, forLang("zh-CN", "Chinese (China)"), "source_text");
    expect(r.unknown).toEqual([]);
    expect(r.appended).toEqual([]);
    expect(r.prompt).not.toMatch(/\{\{/);
    expect(r.prompt).toMatchSnapshot();
  });

  it("shares a byte-identical prefix across languages up to the language-specific section", async () => {
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "translate.md"), "utf8")).body;
    const zh = assemble(tpl, forLang("zh-CN", "Chinese (China)"), "source_text").prompt;
    const ja = assemble(tpl, forLang("ja", "Japanese"), "source_text").prompt;
    const marker = "## This task";
    expect(zh.indexOf(marker)).toBeGreaterThan(0);
    expect(zh.slice(0, zh.indexOf(marker))).toBe(ja.slice(0, ja.indexOf(marker)));
    expect(zh).not.toBe(ja);
  });

  it("uses the <name>.<lang>.<ext> convention in the output section", async () => {
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "translate.md"), "utf8")).body;
    const r = assemble(tpl, forLang("zh-CN", "Chinese (China)"), "source_text").prompt;
    expect(r).toContain("README.md → README.zh-CN.md");
    expect(r).toContain("Output path: /proj/docs/intro.zh-CN.md");
  });
});

describe("assemble with the default review.md", () => {
  it("fills every placeholder for a monolingual review", async () => {
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "review.md"), "utf8")).body;
    const { suggestions: _translateOnly, ...reviewVars } = forLang("zh-CN", "Chinese (China)");
    const r = assemble(
      tpl,
      {
        ...reviewVars,
        format_rules: formatRules({ format: "markdown", kind: "review" }),
        source_text: "",
        source_path: "(not found; monolingual review)",
        translated_text: "# 介绍",
        translated_path: "/proj/docs/intro.zh-CN.md",
        extra: "the source is in docs/en/intro.md",
        output_path: "",
        output_format: reviewOutputFormat(false),
      },
      "translated_text",
    );
    expect(r.unknown).toEqual([]);
    expect(r.appended).toEqual([]);
    expect(r.prompt).toContain("<source_text>\n\n</source_text>");
    expect(r.prompt).toContain("the source is in docs/en/intro.md");
    expect(r.prompt).toMatchSnapshot();
  });
});

describe("assemble with user templates", () => {
  it("appends missing material blocks and the body block under fixed headings", () => {
    const r = assemble("Translate to {{target_lang}}. Extra: {{extra}}", forLang("zh-CN", "Chinese (China)"), "source_text");
    expect(r.appended).toEqual(["format_rules", "rules", "style_guide", "glossary", "suggestions", "source_text"]);
    expect(r.prompt).toMatch(/## Format rules\n/);
    expect(r.prompt).toMatch(/## Project rules\n1\. Tone: concise/);
    expect(r.prompt).toMatch(/## Style guide\n- Second person\./);
    expect(r.prompt).toMatch(/## Glossary\n\| Term/);
    expect(r.prompt).toMatch(/## Source text\n<source_text>\n# Intro/);
  });

  it("keeps unknown placeholders verbatim and reports them", () => {
    const r = assemble("{{glossary}} {{foo}} {{ bar }} {{source_text}} {{rules}} {{style_guide}} {{format_rules}} {{suggestions}}", forLang("ja", "Japanese"), "source_text");
    expect(r.unknown).toEqual(["foo", "bar"]);
    expect(r.prompt).toContain("{{foo}}");
    expect(r.prompt).toContain("{{ bar }}");
    expect(r.appended).toEqual([]);
  });
});

describe("loadTemplate", () => {
  it("prefers project, then user, then packaged", async () => {
    const packaged = join(DEFAULTS, "translate.md");
    const missing = join(FIXTURES, "nope", "translate.md");
    const fromDefault = await loadTemplate("translate", { project: missing, user: missing, packaged });
    expect(fromDefault.source).toBe("default");
    expect(fromDefault.description).toMatch(/^Default translation prompt/);

    const asUser = await loadTemplate("translate", { project: missing, user: join(FIXTURES, "repo-a", "style-guide.md"), packaged });
    expect(asUser.source).toBe("user");

    const asProject = await loadTemplate("translate", { project: join(FIXTURES, "repo-a", "docs", "intro.md"), user: missing, packaged });
    expect(asProject.source).toBe("project");

    const untrusted = await loadTemplate("translate", { project: undefined, user: missing, packaged });
    expect(untrusted.source).toBe("default");
  });
});

describe("paths and rules", () => {
  it("builds <name>.<lang>.<ext> by default", () => {
    expect(outputPathFor("/p/README.md", "zh-CN", { cwd: "/p" })).toBe("/p/README.zh-CN.md");
    expect(outputPathFor("/p/notes.txt", "ja", { cwd: "/p" })).toBe("/p/notes.ja.txt");
    expect(outputPathFor("/p/locales/en.json", "ko", { cwd: "/p" })).toBe("/p/locales/en.ko.json");
  });
  it("honours output.pattern and --to", () => {
    expect(expandPattern("{dir}/{lang}/{name}{ext}", "/p/docs/a.md", "ja")).toBe("/p/docs/ja/a.md");
    expect(outputPathFor("/p/a.md", "ja", { to: "out/x.md", cwd: "/p" })).toBe("/p/out/x.md");
  });
  it("guesses the source from a translated name", () => {
    expect(guessSourcePath("/p/docs/intro.zh-CN.md", "zh-CN")).toBe("/p/docs/intro.md");
    expect(guessSourcePath("/p/docs/intro.md", "zh-CN")).toBe("/p/docs/intro.md");
    expect(guessSourcePath("/p/zh-CN/intro.md", "zh-CN", "{dir}/../en/{name}{ext}")).toBe("/p/zh-CN/../en/intro.md");
  });
  it("renders rules from config", () => {
    expect(renderRules(undefined)).toMatch(/not found/);
    expect(renderRules({ tone: "Concise", doNotTranslate: ["Pi"] })).toBe("1. Tone: Concise\n2. Do not translate: Pi");
  });
});

describe("formats", () => {
  it("detects supported formats and treats pasted text as text", () => {
    expect(detectInputFormat("/p/a.md")).toBe("markdown");
    expect(detectInputFormat("/p/a.txt")).toBe("text");
    expect(detectInputFormat("/p/locales/en.json")).toBe("json");
    expect(detectInputFormat("/p/a.docx")).toBe("unknown");
    expect(detectInputFormat("(pasted text)")).toBe("text");
  });

  it("describes JSON rules with the detected indentation and placeholders", async () => {
    const body = await readFile(join(FIXTURES, "repo-a", "locales", "en.json"), "utf8");
    expect(detectJsonIndent(body)).toBe("2 spaces");
    expect(detectJsonIndent('{\n\t"a": 1\n}')).toBe("tabs");
    expect(detectJsonIndent('{"a":1}')).toBe("none (single line)");
    const rules = formatRules({ format: "json", kind: "translate", body });
    expect(rules).toContain("same keys");
    expect(rules).toContain("{name}");
    expect(rules).toContain("%s");
    expect(rules).toContain("Keep the original indentation (2 spaces)");
    expect(rules).not.toContain("Review dimension");
    expect(formatRules({ format: "json", kind: "review", body })).toContain("key is missing or extra");
  });

  it("assembles a JSON translation prompt end to end", async () => {
    const body = await readFile(join(FIXTURES, "repo-a", "locales", "en.json"), "utf8");
    const tpl = stripFrontmatter(await readFile(join(DEFAULTS, "translate.md"), "utf8")).body;
    const r = assemble(
      tpl,
      {
        ...forLang("zh-CN", "Chinese (China)"),
        format_rules: formatRules({ format: "json", kind: "translate", body }),
        source_text: body,
        source_path: "/proj/locales/en.json",
        output_path: "/proj/locales/en.zh-CN.json",
      },
      "source_text",
    );
    expect(r.unknown).toEqual([]);
    expect(r.prompt).toContain("Input format: JSON.");
    expect(r.prompt).toContain('"welcome": "Hello, {name}! You have %d new messages."');
    expect(r.prompt).toContain("Output path: /proj/locales/en.zh-CN.json");
  });
});
