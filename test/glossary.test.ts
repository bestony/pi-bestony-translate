import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, parseGlossary, renderGlossary, serializeGlossary } from "../src/glossary";
import type { GlossaryEntry } from "../src/types";
import { DEFAULTS } from "./helpers";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes and CRLF", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});

describe("parseGlossary", () => {
  it("reads the three example formats into the same entries", async () => {
    const csv = parseGlossary(await readFile(join(DEFAULTS, "glossary.example.csv"), "utf8"), "csv");
    const json = parseGlossary(await readFile(join(DEFAULTS, "glossary.example.json"), "utf8"), "json");
    const md = parseGlossary(await readFile(join(DEFAULTS, "glossary.example.md"), "utf8"), "md");
    expect(csv).toEqual(json);
    expect(md).toEqual(json);
    expect(json.find((e) => e.source === "pre-commit")).toMatchObject({ keep: true, targets: {} });
  });

  it("rejects a CSV without a source column", () => {
    expect(() => parseGlossary("term,zh-CN\nAgent,智能体\n", "csv")).toThrow(/source/);
  });
});

describe("serializeGlossary", () => {
  it("round-trips through every format with the requested language columns", async () => {
    const entries = parseGlossary(await readFile(join(DEFAULTS, "glossary.example.json"), "utf8"), "json");
    for (const format of ["csv", "json", "md"] as const) {
      const text = serializeGlossary(entries, format, ["zh-CN", "ja"]);
      const back = parseGlossary(text, format);
      expect(back.map((e) => e.source)).toEqual(entries.map((e) => e.source));
      expect(back.find((e) => e.source === "Agent")?.targets["zh-CN"]).toBe("智能体");
    }
    expect(serializeGlossary(entries, "csv", ["zh-CN", "ja"]).split("\n")[0]).toBe("source,zh-CN,ja,note,keep");
  });
});

describe("renderGlossary", () => {
  const entries: GlossaryEntry[] = [
    { source: "Agent", targets: { "zh-CN": "智能体", ja: "エージェント" }, note: "Product docs" },
    { source: "extension", targets: { "zh-CN": "扩展" } },
    { source: "extension", targets: { "zh-CN": "插件" }, note: "WordPress chapter only" },
    { source: "pre-commit", targets: {}, keep: true, note: "Tool name" },
    { source: "only-ja", targets: { ja: "のみ" } },
  ];

  it("renders one language column, merges multiple renderings and lists keep terms", () => {
    const r = renderGlossary(entries, "zh-CN", "");
    expect(r.count).toBe(3);
    expect(r.markdown).toContain("| Agent | 智能体 | Product docs |");
    expect(r.markdown).toContain("| extension | 扩展 \\| 插件 (by context) | WordPress chapter only |");
    expect(r.markdown).toContain("- pre-commit — Tool name");
    expect(r.markdown).not.toContain("only-ja");
  });

  it("says so when there is no glossary", () => {
    expect(renderGlossary(undefined, "zh-CN", "").markdown).toMatch(/no glossary/);
    expect(renderGlossary([], "zh-CN", "").count).toBe(0);
  });

  it("filters by occurrence above maxEntries", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ source: `term${i}`, targets: { "zh-CN": `词${i}` } }));
    const r = renderGlossary(many, "zh-CN", "This text mentions term3 and TERM7 only.", { maxEntries: 5 });
    expect(r.filtered).toBe(true);
    expect(r.count).toBe(2);
    expect(r.markdown).toContain("term3");
    expect(r.markdown).toContain("term7");
    expect(r.markdown).not.toContain("term1 ");
  });

  it("uses word boundaries for Latin terms", () => {
    const many = Array.from({ length: 3 }, (_, i) => ({ source: `ext${i}`, targets: { "zh-CN": `x${i}` } }));
    const r = renderGlossary(many, "zh-CN", "ext1ension ext2", { maxEntries: 1 });
    expect(r.markdown).toContain("ext2");
    expect(r.markdown).not.toContain("ext1");
  });
});
