import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const DEFAULTS = fileURLToPath(new URL("../defaults/", import.meta.url));

/**
 * Copy a fixture repo into a fresh temp dir shaped like:
 *   <tmp>/outside/glossary.md      (must never be discovered)
 *   <tmp>/outside/repo/.git/       (git root)
 *   <tmp>/outside/repo/...fixture files
 */
export async function makeRepo(fixture: string): Promise<{ root: string; repo: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "bt-"));
  const outside = join(root, "outside");
  const repo = join(outside, "repo");
  await mkdir(repo, { recursive: true });
  await cp(join(FIXTURES, fixture), repo, { recursive: true });
  await mkdir(join(repo, ".git"), { recursive: true });
  await cp(join(FIXTURES, "outside-glossary.md"), join(outside, "glossary.md"));
  return { root, repo, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "bt-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function up(p: string): string {
  return dirname(p);
}
