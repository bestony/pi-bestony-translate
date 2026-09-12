import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkStructure, extractPlaceholders, outlineMarkdown, splitMarkdown, summarizeReport } from "../src/structure";
import { FIXTURES } from "./helpers";

const S = join(FIXTURES, "structure");
const read = (p: string) => readFile(p, "utf8");

describe("JSON structure check", () => {
  it("passes when keys, order, non-string values and placeholders are preserved", async () => {
    const r = checkStructure(await read(join(FIXTURES, "repo-a", "locales", "en.json")), await read(join(S, "en.zh-CN.good.json")), "json");
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.compared.strings).toBe(4);
    expect(summarizeReport(r)).toMatch(/^structure ok/);
  });

  it("reports order, placeholder, type and extra-key problems with JSON pointers", async () => {
    const r = checkStructure(await read(join(FIXTURES, "repo-a", "locales", "en.json")), await read(join(S, "en.zh-CN.bad.json")), "json");
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => `${i.code}@${i.path}`);
    expect(codes).toContain("json.key-extra@/app/extra");
    expect(codes).toContain("json.key-order@/app");
    expect(codes).toContain("json.placeholder@/app/welcome");
    expect(codes).toContain("json.type-changed@/app/enabled");
    const ph = r.issues.find((i) => i.code === "json.placeholder")!;
    expect(ph.expected).toBe("%d {name}");
    expect(ph.actual).toBe("%s {姓名}");
  });

  it("flags unparsable output and a changed non-string value", () => {
    expect(checkStructure('{"a":1}', "{oops", "json").issues[0].code).toBe("json.output-invalid");
    const r = checkStructure('{"a":1,"b":[1,2]}\n', '{"a":2,"b":[1]}\n', "json");
    expect(r.issues.map((i) => i.code).sort()).toEqual(["json.array-length", "json.value-changed"]);
  });

  it("extracts placeholders of the supported shapes", () => {
    expect(extractPlaceholders("Hi {name}, {{ count }} items, %s %2$d $1 <b>x</b>")).toEqual(["{name}", "{{count}}", "%s", "%2$d", "$1", "<b>", "</b>"].sort());
  });
});

describe("Markdown structure check", () => {
  it("splits frontmatter entries and outlines the body", async () => {
    const src = await read(join(FIXTURES, "repo-a", "docs", "post.md"));
    const s = splitMarkdown(src);
    expect(s.frontmatter?.map((e) => e.key)).toEqual(["title", "description", "date", "slug", "draft", "tags"]);
    expect(s.frontmatter?.find((e) => e.key === "date")?.raw).toBe("2026-09-11");
    const o = outlineMarkdown(s.body);
    expect(o.headings).toEqual([{ level: 1, text: "Getting started" }]);
  });

  it("passes a translation that only touches allowlisted values and prose", async () => {
    const r = checkStructure(await read(join(FIXTURES, "repo-a", "docs", "post.md")), await read(join(S, "post.zh-CN.good.md")), "markdown-frontmatter");
    expect(r.issues).toEqual([]);
    expect(r.compared).toMatchObject({ frontmatterKeys: 6, headings: 1 });
  });

  it("reports reordered keys, changed date/slug/tags, heading level and count", async () => {
    const r = checkStructure(await read(join(FIXTURES, "repo-a", "docs", "post.md")), await read(join(S, "post.zh-CN.bad.md")), "markdown-frontmatter");
    const codes = r.issues.map((i) => `${i.code}@${i.path}`);
    expect(codes).toContain("frontmatter.key-order@frontmatter");
    expect(codes).toContain("frontmatter.value-changed@frontmatter/date");
    expect(codes).toContain("frontmatter.value-changed@frontmatter/slug");
    expect(codes).toContain("frontmatter.value-changed@frontmatter/tags");
    expect(codes).not.toContain("frontmatter.value-changed@frontmatter/title");
    expect(codes).toContain("body.heading-count@body");
    expect(codes).toContain("body.heading-level@body/heading#1");
    expect(r.issues.find((i) => i.path === "frontmatter/date")).toMatchObject({ expected: "2026-09-11", actual: "2026-09-12" });
  });

  it("checks fenced code blocks byte-for-byte and link targets as a multiset", async () => {
    const r = checkStructure(await read(join(S, "guide.md")), await read(join(S, "guide.zh-CN.bad.md")), "markdown");
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("body.code-block-changed");
    expect(codes).toContain("body.link-missing");
    expect(codes).toContain("body.link-extra");
    expect(r.issues.find((i) => i.code === "body.link-missing")?.expected).toBe("https://pi.dev/docs");
    expect(codes).not.toContain("body.heading-count");
    expect(codes).not.toContain("frontmatter.extra");
  });

  it("does nothing for plain text", () => {
    expect(checkStructure("a", "b", "text").ok).toBe(true);
  });
});
