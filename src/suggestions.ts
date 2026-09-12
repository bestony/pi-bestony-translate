import { dirname, join } from "node:path";
import type { DiscoveredGlossary, GlossaryFormat } from "./types";

export const SUGGESTIONS_DISABLED_TEXT = "(glossary suggestions are disabled for this run)";

export interface SuggestionInput {
  enabled: boolean;
  glossary?: DiscoveredGlossary;
  cwd: string;
  lang: string;
}

/** Where the agent may append candidate terms: next to the glossary, same format; never the glossary itself. */
export function suggestionsPath(glossary: DiscoveredGlossary | undefined, cwd: string): { path: string; format: GlossaryFormat } {
  if (glossary) {
    return { path: join(dirname(glossary.path), `glossary.suggested.${glossary.format}`), format: glossary.format };
  }
  return { path: join(cwd, "glossary.suggested.csv"), format: "csv" };
}

function headerHint(format: GlossaryFormat, lang: string, glossary: DiscoveredGlossary | undefined): string {
  switch (format) {
    case "csv":
      return glossary
        ? "the same header line as the glossary; fill only the `source`, the `" + lang + "` and the `note` columns, leave other language columns and `keep` empty"
        : "the header line `source," + lang + ",note,keep`";
    case "md":
      return glossary
        ? "the same table header as the glossary; fill only the source, `" + lang + "` and note columns"
        : "a table with the columns `source | " + lang + " | note | keep`";
    case "json":
      return 'a JSON array of `{ "source": string, "targets": { "' + lang + '": string }, "note": string }` objects (read the file, add to the array, write it back)';
  }
}

/** The {{suggestions}} block of translate.md. */
export function suggestionInstructions(input: SuggestionInput): string {
  if (!input.enabled) return SUGGESTIONS_DISABLED_TEXT;
  const { path, format } = suggestionsPath(input.glossary, input.cwd);
  const glossaryName = input.glossary ? input.glossary.path : "the project glossary";
  return [
    "After the translation is written, collect candidate glossary terms: source-language terms that occur at least twice in the source text, are not in the glossary, and for which you made a deliberate rendering choice (product names, UI labels, recurring technical nouns). This is the same list you built under hard rule 7 before translating.",
    `Append them to ${path} (if the file does not exist, create it with ${headerHint(format, input.lang, input.glossary)}), one entry per term: the source term, the rendering you used in ${input.lang}, and a short note on why. Never write to ${glossaryName} itself; a human reviews the suggestions file and merges rows into the glossary by hand.`,
    "If there are no candidates, do not create the file. In your reply mention only the number of suggested terms.",
  ].join("\n");
}
