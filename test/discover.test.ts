import { utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryCache, discover, findStopDir, truncateStyleGuide } from "../src/discover";
import { makeRepo } from "./helpers";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("discover", () => {
  it("stops at the git root and never reads the glossary above it", async () => {
    const r = await makeRepo("repo-a");
    cleanup = r.cleanup;
    expect(await findStopDir(join(r.repo, "docs"))).toBe(r.repo);
    const found = await discover(join(r.repo, "docs"));
    expect(found.stopDir).toBe(r.repo);
    expect(found.glossary?.path).toBe(join(r.repo, "glossary.csv"));
    expect(found.glossary?.entries.find((e) => e.source === "Agent")?.targets["zh-CN"]).toBe("智能体");
  });

  it("nearest directory wins per file, without merging", async () => {
    const r = await makeRepo("repo-a");
    cleanup = r.cleanup;
    const found = await discover(join(r.repo, "docs", "nested"));
    expect(found.glossary?.path).toBe(join(r.repo, "docs", "nested", "glossary.json"));
    expect(found.glossary?.entries).toHaveLength(1);
    // config and style guide still come from the repo root
    expect(found.config?.path).toBe(join(r.repo, "translation.config.json"));
    expect(found.styleGuide?.path).toBe(join(r.repo, "style-guide.md"));
    expect(found.warnings).toEqual([]);
  });

  it("warns but continues when there is no glossary", async () => {
    const r = await makeRepo("repo-b");
    cleanup = r.cleanup;
    const found = await discover(r.repo);
    expect(found.glossary).toBeUndefined();
    expect(found.config).toBeUndefined();
    expect(found.styleGuide?.body).toContain("No glossary in this project");
    expect(found.warnings.some((w) => /No glossary found/.test(w))).toBe(true);
  });

  it("re-parses when the glossary mtime changes", async () => {
    const r = await makeRepo("repo-a");
    cleanup = r.cleanup;
    const cache = new DiscoveryCache();
    const first = await discover(r.repo, cache);
    expect(first.glossary?.entries).toHaveLength(5);

    const p = join(r.repo, "glossary.csv");
    await writeFile(p, "source,zh-CN\nAgent,新译法\n", "utf8");
    const later = new Date(Date.now() + 5000);
    await utimes(p, later, later);

    const second = await discover(r.repo, cache);
    expect(second.glossary?.entries).toHaveLength(1);
    expect(second.glossary?.entries[0].targets["zh-CN"]).toBe("新译法");
  });

  it("reports a tm/ directory without loading it", async () => {
    const r = await makeRepo("repo-a");
    cleanup = r.cleanup;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(r.repo, "tm"));
    const found = await discover(r.repo);
    expect(found.tmDir).toBe(join(r.repo, "tm"));
    expect(found.warnings.some((w) => /translation memory is not loaded/.test(w))).toBe(true);
  });

  it("warns on an unparsable config instead of throwing", async () => {
    const r = await makeRepo("repo-a");
    cleanup = r.cleanup;
    await writeFile(join(r.repo, "translation.config.json"), "{ not json", "utf8");
    const found = await discover(r.repo);
    expect(found.config).toBeUndefined();
    expect(found.warnings.some((w) => /Could not parse/.test(w))).toBe(true);
  });
});

describe("truncateStyleGuide", () => {
  it("leaves short guides alone", () => {
    expect(truncateStyleGuide("short")).toEqual({ body: "short", truncated: false });
  });
  it("cuts at a blank line and appends a marker", () => {
    const para = "x".repeat(1000);
    const long = Array.from({ length: 40 }, () => para).join("\n\n");
    const r = truncateStyleGuide(long);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.body)).toBeLessThan(33 * 1024);
    expect(r.body).toMatch(/\[\.\.\. style guide truncated; full text is \d+ characters\]$/);
  });
});
