import { fileURLToPath } from "node:url";

/** Sub-directory (under the pi config dir and the agent dir) that holds prompt overrides. */
export const OVERRIDE_DIR = "bestony-translate";

/**
 * Absolute path of the package's defaults/ directory.
 *
 * The extensions docs do not say whether `import.meta.url` is populated under pi's jiti loader.
 * Verified empirically with pi 0.85.1: `pi -e ./extensions/index.ts -p "/init-translate"` resolved
 * this URL and wrote the default files. If a future pi version breaks it, embed the defaults as
 * string constants instead.
 */
export function defaultsDir(): string {
  return fileURLToPath(new URL("../defaults/", import.meta.url));
}
