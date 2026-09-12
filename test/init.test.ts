import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discover } from "../src/discover";
import { parseGlossary } from "../src/glossary";
import { formatInitLine, runInit } from "../src/init";
import { loadTemplate } from "../src/prompts";
import { DEFAULTS, makeTempDir } from "./helpers";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const base = (cwd: string, agentDir: string) => ({
  cwd,
  agentDir,
  configDirName: ".pi",
  defaultsDir: DEFAULTS,
  format: "csv" as const,
  langs: ["zh-CN"],
  prompts: "project" as const,
  force: false,
  trusted: true,
});

describe("runInit", () => {
  it("writes all five defaults and they load back", async () => {
    const t = await makeTempDir();
    cleanup = t.cleanup;
    const agentDir = join(t.dir, "agent");
    const r = await runInit(base(t.dir, agentDir));
    expect(r.error).toBeUndefined();
    expect(r.results.map((x) => [x.file, x.status])).toEqual([
      ["glossary.csv", "written"],
      ["translation.config.json", "written"],
      ["style-guide.md", "written"],
      [join(".pi", "bestony-translate", "translate.md"), "written"],
      [join(".pi", "bestony-translate", "review.md"), "written"],
    ]);

    const found = await discover(t.dir);
    expect(found.glossary?.entries.map((e) => e.source)).toEqual(["Agent", "pre-commit", "code review", "extension", "prompt", "glossary"]);
    expect(found.config?.value.targets).toEqual(["zh-CN"]);
    expect(found.config?.value.output?.pattern).toBe("{dir}/{name}.{lang}{ext}");
    expect(found.styleGuide?.body).toContain("# Style guide");

    const tpl = await loadTemplate("translate", {
      project: join(t.dir, ".pi", "bestony-translate", "translate.md"),
      user: join(agentDir, "bestony-translate", "translate.md"),
      packaged: join(DEFAULTS, "translate.md"),
    });
    expect(tpl.source).toBe("project");
    expect(tpl.body).toBe((await readFile(join(DEFAULTS, "translate.md"), "utf8")).replace(/^---[\s\S]*?---\n/, ""));
  });

  it("writes json / md glossaries with the requested language columns", async () => {
    const t = await makeTempDir();
    cleanup = t.cleanup;
    const r = await runInit({ ...base(t.dir, join(t.dir, "agent")), format: "json", langs: ["zh-CN", "ja"] });
    expect(r.results[0].file).toBe("glossary.json");
    const entries = parseGlossary(await readFile(join(t.dir, "glossary.json"), "utf8"), "json");
    expect(entries[0].targets).toEqual({ "zh-CN": "智能体" });
    const config = JSON.parse(await readFile(join(t.dir, "translation.config.json"), "utf8"));
    expect(config.targets).toEqual(["zh-CN", "ja"]);

    const t2 = await makeTempDir();
    const r2 = await runInit({ ...base(t2.dir, join(t2.dir, "agent")), format: "md", langs: ["ja"] });
    expect(r2.results[0].file).toBe("glossary.md");
    const md = await readFile(join(t2.dir, "glossary.md"), "utf8");
    expect(md.split("\n")[2]).toBe("| source | ja | note | keep |");
    await t2.cleanup();
  });

  it("skips existing files one by one and reports them; --force overwrites", async () => {
    const t = await makeTempDir();
    cleanup = t.cleanup;
    await writeFile(join(t.dir, "style-guide.md"), "mine\n", "utf8");
    const r = await runInit(base(t.dir, join(t.dir, "agent")));
    const byFile = Object.fromEntries(r.results.map((x) => [x.file, x.status]));
    expect(byFile["style-guide.md"]).toBe("skipped");
    expect(byFile["glossary.csv"]).toBe("written");
    expect(await readFile(join(t.dir, "style-guide.md"), "utf8")).toBe("mine\n");
    expect(formatInitLine(r.results.find((x) => x.file === "style-guide.md")!)).toBe("skipped style-guide.md (exists; use --force to overwrite)");

    const forced = await runInit({ ...base(t.dir, join(t.dir, "agent")), force: true });
    expect(forced.results.every((x) => x.status === "written")).toBe(true);
    expect(await readFile(join(t.dir, "style-guide.md"), "utf8")).toContain("# Style guide");
  });

  it("writes prompts under the agent dir with --prompts user", async () => {
    const t = await makeTempDir();
    cleanup = t.cleanup;
    const agentDir = join(t.dir, "agent");
    const r = await runInit({ ...base(t.dir, agentDir), prompts: "user" });
    const promptResults = r.results.slice(3);
    expect(promptResults.map((x) => x.absPath)).toEqual([
      join(agentDir, "bestony-translate", "translate.md"),
      join(agentDir, "bestony-translate", "review.md"),
    ]);
    expect((await stat(join(agentDir, "bestony-translate", "review.md"))).isFile()).toBe(true);
  });

  it("writes nothing when the project is not trusted", async () => {
    const t = await makeTempDir();
    cleanup = t.cleanup;
    const r = await runInit({ ...base(t.dir, join(t.dir, "agent")), trusted: false });
    expect(r.error).toMatch(/not trusted/);
    expect(r.results).toEqual([]);
    await expect(stat(join(t.dir, "glossary.csv"))).rejects.toThrow();
  });
});
