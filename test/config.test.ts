import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_URL, formatConfigIssue, loadSchema, parseConfig, parseJsonWithPositions } from "../src/config";
import { discover } from "../src/discover";
import { runInit } from "../src/init";
import { DEFAULTS, makeRepo, makeTempDir } from "./helpers";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const VALID = `{
  "$schema": "${SCHEMA_URL}",
  "sourceLang": "en",
  "targets": ["zh-CN", "ja"],
  "tone": "Concise.",
  "doNotTranslate": ["Pi"],
  "preserve": ["code"],
  "output": { "pattern": "{dir}/{name}.{lang}{ext}" },
  "review": { "sourcePattern": "{dir}/{name}{ext}" },
  "suggestions": false
}
`;

describe("parseJsonWithPositions", () => {
  it("records line and column of keys and values", () => {
    const root = parseJsonWithPositions('{\n  "a": 1,\n  "b": {\n    "c": [true, "x"]\n  }\n}');
    expect(root.members?.get("a")).toMatchObject({ value: 1, keyPos: { line: 2, column: 3 }, pos: { line: 2, column: 8 } });
    const c = root.members?.get("b")?.members?.get("c");
    expect(c?.keyPos).toEqual({ line: 4, column: 5 });
    expect(c?.items?.[1]).toMatchObject({ value: "x", pos: { line: 4, column: 17 } });
  });
  it("throws with a position on syntax errors", () => {
    expect(() => parseJsonWithPositions('{ "a": }')).toThrow(/at 1:8/);
  });
});

describe("parseConfig", () => {
  it("accepts a valid config unchanged", () => {
    const r = parseConfig(VALID);
    expect(r.issues).toEqual([]);
    expect(r.value).toMatchObject({ sourceLang: "en", targets: ["zh-CN", "ja"], suggestions: false, output: { pattern: "{dir}/{name}.{lang}{ext}" } });
  });

  it("reports an unknown key with pointer and line, and drops it", () => {
    const r = parseConfig('{\n  "sourceLang": "en",\n  "toen": "typo",\n  "review": { "sourcePatern": "x" }\n}\n');
    expect(r.issues).toEqual([
      { pointer: "/toen", line: 3, column: 3, code: "unknown-key", message: 'unknown key "toen"' },
      { pointer: "/review/sourcePatern", line: 4, column: 15, code: "unknown-key", message: 'unknown key "sourcePatern"' },
    ]);
    expect(r.value).toEqual({ sourceLang: "en", review: {} });
    expect(formatConfigIssue("translation.config.json", r.issues[0])).toBe('translation.config.json:3:3 /toen unknown key "toen"');
  });

  it("reports a wrong type with pointer and line, and drops the value", () => {
    const r = parseConfig('{\n  "targets": "zh-CN",\n  "suggestions": "no",\n  "doNotTranslate": ["Pi", 42]\n}\n');
    expect(r.issues.map((i) => [i.pointer, i.line, i.code, i.message])).toEqual([
      ["/targets", 2, "wrong-type", "expected array, got string"],
      ["/suggestions", 3, "wrong-type", "expected boolean, got string"],
      ["/doNotTranslate/1", 4, "wrong-type", "expected string, got integer"],
    ]);
    expect(r.value).toEqual({ doNotTranslate: ["Pi"] });
  });

  it("turns a syntax error into one issue and an empty config", () => {
    const r = parseConfig('{ "a": \n');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: "syntax", line: 2 });
    expect(r.value).toEqual({});
  });

  it("uses the shipped schema file, which is draft-07 with additionalProperties: false", () => {
    const s = loadSchema() as { $schema?: string; additionalProperties?: boolean; properties?: Record<string, unknown> };
    expect(s.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties ?? {})).toEqual(["$schema", "sourceLang", "targets", "tone", "doNotTranslate", "preserve", "output", "review", "suggestions"]);
  });
});

describe("integration", () => {
  it("discover() surfaces config issues as warnings with file:line:col", async () => {
    const r = await makeRepo("repo-a");
    cleanup = r.cleanup;
    await writeFile(join(r.repo, "translation.config.json"), '{\n  "sourceLang": "en",\n  "tonee": "x"\n}\n', "utf8");
    const found = await discover(r.repo);
    expect(found.config?.value).toEqual({ sourceLang: "en" });
    expect(found.warnings.some((w) => /translation\.config\.json:3:3 \/tonee unknown key "tonee"/.test(w))).toBe(true);
  });

  it("/init-translate writes $schema first and the generated config validates", async () => {
    const t = await makeTempDir();
    cleanup = t.cleanup;
    await runInit({ cwd: t.dir, agentDir: join(t.dir, "agent"), configDirName: ".pi", defaultsDir: DEFAULTS, format: "csv", langs: ["zh-CN"], prompts: "project", force: false, trusted: true });
    const text = await readFile(join(t.dir, "translation.config.json"), "utf8");
    expect(text.split("\n")[1]).toBe(`  "$schema": "${SCHEMA_URL}",`);
    expect(parseConfig(text).issues).toEqual([]);
  });
});
