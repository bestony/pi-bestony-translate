import { describe, expect, it } from "vitest";
import { canonicalLang, completeLangs, looksLikePath, parseArgs, parseInitArgs, tokenize } from "../src/args";

const exists = (paths: string[]) => async (p: string) => paths.some((x) => p.endsWith(x));

describe("tokenize", () => {
  it("splits on whitespace and honours double quotes", () => {
    expect(tokenize('zh-CN "my docs/intro.md" --to out.md')).toEqual(["zh-CN", "my docs/intro.md", "--to", "out.md"]);
  });
  it("returns [] for empty input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("canonicalLang", () => {
  it("canonicalises case", () => {
    expect(canonicalLang("zh-cn")?.tag).toBe("zh-CN");
    expect(canonicalLang("pt-br")?.tag).toBe("pt-BR");
  });
  it("rejects malformed tags", () => {
    expect(canonicalLang("xx-!!")).toBeUndefined();
    expect(canonicalLang("")).toBeUndefined();
  });
  it("gives an English display name", () => {
    expect(canonicalLang("ja")?.name).toBe("Japanese");
  });
});

describe("parseArgs /translate", () => {
  const cwd = "/proj";

  it("parses several languages and a path", async () => {
    const a = await parseArgs("zh-CN,ja,ko docs/a.md", { kind: "translate", cwd, fileExists: exists(["docs/a.md"]) });
    expect(a.error).toBeUndefined();
    expect(a.langs.map((l) => l.tag)).toEqual(["zh-CN", "ja", "ko"]);
    expect(a.path).toBe("docs/a.md");
    expect(a.extra).toBe("");
  });

  it("de-duplicates languages", async () => {
    const a = await parseArgs("zh-CN,zh-cn", { kind: "translate", cwd, fileExists: exists([]) });
    expect(a.langs.map((l) => l.tag)).toEqual(["zh-CN"]);
  });

  it("errors on a bad tag", async () => {
    const a = await parseArgs("xx-!! docs/a.md", { kind: "translate", cwd, fileExists: exists([]) });
    expect(a.error).toMatch(/Unrecognised language tag "xx-!!"/);
  });

  it("prints usage when lang is missing", async () => {
    const a = await parseArgs("", { kind: "translate", cwd, fileExists: exists([]) });
    expect(a.error).toMatch(/^Usage: \/translate/);
  });

  it("treats a non-file second token as extra instructions with a note", async () => {
    const a = await parseArgs("zh-CN make it casual", { kind: "translate", cwd, fileExists: exists([]) });
    expect(a.error).toBeUndefined();
    expect(a.path).toBeUndefined();
    expect(a.extra).toBe("make it casual");
    expect(a.notes[0]).toMatch(/not a file/);
  });

  it("reports a missing file when the token looks like a path", async () => {
    const a = await parseArgs("zh-CN docs/missing.md", { kind: "translate", cwd, fileExists: exists([]) });
    expect(a.error).toMatch(/^File not found: .*docs\/missing\.md$/);
  });

  it("strips a leading @ before checking the file", async () => {
    const a = await parseArgs("zh-CN @docs/a.md", { kind: "translate", cwd, fileExists: exists(["docs/a.md"]) });
    expect(a.path).toBe("@docs/a.md");
    expect(a.error).toBeUndefined();
  });

  it("puts everything after -- into extra, even flag-looking tokens", async () => {
    const a = await parseArgs("zh-CN docs/a.md -- keep --to literally", {
      kind: "translate",
      cwd,
      fileExists: exists(["docs/a.md"]),
    });
    expect(a.extra).toBe("keep --to literally");
    expect(a.flags.to).toBeUndefined();
  });

  it("collects --to and --last", async () => {
    const a = await parseArgs("ja docs/a.md --to out/a.ja.md --last", { kind: "translate", cwd, fileExists: exists(["docs/a.md"]) });
    expect(a.flags.to).toBe("out/a.ja.md");
    expect(a.flags.last).toBe(true);
  });

  it("rejects --to with several languages", async () => {
    const a = await parseArgs("zh-CN,ja docs/a.md --to x.md", { kind: "translate", cwd, fileExists: exists(["docs/a.md"]) });
    expect(a.error).toMatch(/--to works with a single target language/);
  });
});

describe("parseArgs /review-translate", () => {
  const cwd = "/proj";

  it("requires the translated path", async () => {
    const a = await parseArgs("zh-CN", { kind: "review", cwd, fileExists: exists([]) });
    expect(a.error).toMatch(/^Usage: \/review-translate/);
  });

  it("does not guess: a missing translated path is an error", async () => {
    const a = await parseArgs("zh-CN whatever", { kind: "review", cwd, fileExists: exists([]) });
    expect(a.error).toMatch(/^File not found/);
  });

  it("takes exactly one language", async () => {
    const a = await parseArgs("zh-CN,ja docs/a.zh-CN.md", { kind: "review", cwd, fileExists: exists(["a.zh-CN.md"]) });
    expect(a.error).toMatch(/exactly one target language/);
  });

  it("collects --source and --fix", async () => {
    const a = await parseArgs("zh-CN docs/a.zh-CN.md --source docs/a.md --fix", {
      kind: "review",
      cwd,
      fileExists: exists(["a.zh-CN.md"]),
    });
    expect(a.flags.source).toBe("docs/a.md");
    expect(a.flags.fix).toBe(true);
  });
});

describe("parseInitArgs", () => {
  it("has sane defaults", () => {
    const a = parseInitArgs("");
    expect(a).toMatchObject({ format: "csv", prompts: "project", force: false });
    expect(a.langs.map((l) => l.tag)).toEqual(["zh-CN"]);
  });
  it("parses all flags", () => {
    const a = parseInitArgs("--format json --langs zh-CN,ja --prompts user --force");
    expect(a).toMatchObject({ format: "json", prompts: "user", force: true });
    expect(a.langs.map((l) => l.tag)).toEqual(["zh-CN", "ja"]);
  });
  it("rejects a bad format", () => {
    expect(parseInitArgs("--format yaml").error).toMatch(/--format must be csv, json or md/);
  });
  it("rejects positionals", () => {
    expect(parseInitArgs("csv").error).toMatch(/^Usage: \/init-translate/);
  });
});

describe("looksLikePath / completeLangs", () => {
  it("recognises paths", () => {
    expect(looksLikePath("docs/a")).toBe(true);
    expect(looksLikePath("README")).toBe(false);
    expect(looksLikePath("notes.txt")).toBe(true);
  });
  it("completes the last comma segment", () => {
    expect(completeLangs("zh-CN,j", ["zh-CN", "ja", "ko"])).toEqual([{ value: "zh-CN,ja", label: "ja" }]);
    expect(completeLangs("", ["zh-CN"])).toEqual([{ value: "zh-CN", label: "zh-CN" }]);
    expect(completeLangs("zh-CN docs", ["zh-CN"])).toBeNull();
  });
});
