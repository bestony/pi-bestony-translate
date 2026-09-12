import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ParsedConfig, formatConfigIssue, parseConfig } from "./config";
import { detectFormat, parseGlossary } from "./glossary";
import type { DiscoveredContext, DiscoveredGlossary, GlossaryEntry } from "./types";

/** Fixed file set. Not configurable by design. */
export const GLOSSARY_FILES = ["glossary.csv", "glossary.json", "glossary.md"] as const;
export const CONFIG_FILE = "translation.config.json";
export const STYLE_GUIDE_FILE = "style-guide.md";
export const TM_DIR = "tm";

export const GLOSSARY_MAX_BYTES = 256 * 1024;
export const STYLE_GUIDE_MAX_BYTES = 32 * 1024;

interface CacheEntry<T> {
  mtimeMs: number;
  size: number;
  value: T;
}

/** Session-scoped parse cache keyed by absolute path; invalidated by mtime/size. */
export class DiscoveryCache {
  private map = new Map<string, CacheEntry<unknown>>();

  async get<T>(path: string, mtimeMs: number, size: number, load: () => Promise<T>): Promise<T> {
    const hit = this.map.get(path);
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.value as T;
    const value = await load();
    this.map.set(path, { mtimeMs, size, value });
    return value;
  }

  clear(): void {
    this.map.clear();
  }
}

async function statOrNull(p: string) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

/** Walk up from `start` until a directory containing `.git` (returned) or the filesystem root. */
export async function findStopDir(start: string): Promise<string> {
  let dir = start;
  for (;;) {
    if (await statOrNull(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dir; // filesystem root
    dir = parent;
  }
}

/** Directories from cwd up to and including the stop directory. */
export async function searchChain(cwd: string): Promise<string[]> {
  const stop = await findStopDir(cwd);
  const chain: string[] = [];
  let dir = cwd;
  for (;;) {
    chain.push(dir);
    if (dir === stop) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}

/**
 * Discover glossary / config / style guide / tm from cwd upward.
 * Nearest directory wins per file; no merging across levels.
 * Missing files produce warnings, never errors.
 */
export async function discover(cwd: string, cache: DiscoveryCache = new DiscoveryCache()): Promise<DiscoveredContext> {
  const chain = await searchChain(cwd);
  const ctx: DiscoveredContext = { stopDir: chain[chain.length - 1], warnings: [] };

  for (const dir of chain) {
    if (!ctx.glossary) {
      for (const name of GLOSSARY_FILES) {
        const p = join(dir, name);
        const st = await statOrNull(p);
        if (!st || !st.isFile()) continue;
        if (st.size > GLOSSARY_MAX_BYTES) {
          ctx.warnings.push(`Glossary ${p} is ${Math.round(st.size / 1024)} KB, above the ${GLOSSARY_MAX_BYTES / 1024} KB limit; ignored`);
          break;
        }
        const format = detectFormat(p)!;
        try {
          const entries = await cache.get<GlossaryEntry[]>(p, st.mtimeMs, st.size, async () =>
            parseGlossary(await readFile(p, "utf8"), format),
          );
          ctx.glossary = { path: p, format, entries } satisfies DiscoveredGlossary;
        } catch (err) {
          ctx.warnings.push(`Could not parse glossary ${p}: ${(err as Error).message}`);
        }
        break; // first matching name in this directory wins, even if it failed to parse
      }
    }

    if (!ctx.config) {
      const p = join(dir, CONFIG_FILE);
      const st = await statOrNull(p);
      if (st?.isFile()) {
        const parsed = await cache.get<ParsedConfig>(p, st.mtimeMs, st.size, async () => parseConfig(await readFile(p, "utf8")));
        for (const issue of parsed.issues) ctx.warnings.push(formatConfigIssue(p, issue));
        if (!parsed.issues.some((i) => i.code === "syntax")) {
          ctx.config = { path: p, value: parsed.value };
        } else {
          ctx.warnings.push(`Could not parse ${p}; using defaults`);
        }
      }
    }

    if (!ctx.styleGuide) {
      const p = join(dir, STYLE_GUIDE_FILE);
      const st = await statOrNull(p);
      if (st?.isFile()) {
        const loaded = await cache.get<{ body: string; truncated: boolean }>(p, st.mtimeMs, st.size, async () =>
          truncateStyleGuide(await readFile(p, "utf8")),
        );
        ctx.styleGuide = { path: p, ...loaded };
        if (loaded.truncated) ctx.warnings.push(`Style guide ${p} exceeds ${STYLE_GUIDE_MAX_BYTES / 1024} KB and was truncated`);
      }
    }

    if (!ctx.tmDir) {
      const p = join(dir, TM_DIR);
      const st = await statOrNull(p);
      if (st?.isDirectory()) ctx.tmDir = p;
    }
  }

  if (!ctx.glossary) ctx.warnings.push("No glossary found (glossary.csv / .json / .md); translating without a glossary");
  if (ctx.tmDir) ctx.warnings.push(`Found ${ctx.tmDir}; translation memory is not loaded in this version`);

  return ctx;
}

/** Cut at the last blank line before the byte limit and append a marker. */
export function truncateStyleGuide(body: string): { body: string; truncated: boolean } {
  if (Buffer.byteLength(body, "utf8") <= STYLE_GUIDE_MAX_BYTES) return { body, truncated: false };
  let cut = body;
  while (Buffer.byteLength(cut, "utf8") > STYLE_GUIDE_MAX_BYTES) {
    const idx = cut.lastIndexOf("\n\n");
    if (idx <= 0) {
      cut = Buffer.from(cut, "utf8").subarray(0, STYLE_GUIDE_MAX_BYTES).toString("utf8");
      break;
    }
    cut = cut.slice(0, idx);
  }
  const chars = body.length;
  return { body: `${cut.trimEnd()}\n\n[... style guide truncated; full text is ${chars} characters]`, truncated: true };
}
