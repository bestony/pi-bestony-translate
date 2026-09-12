import type { GlossaryEntry, GlossaryFormat } from "./types";

/** Columns in CSV / Markdown glossaries that are not language tags. */
const META_COLUMNS = new Set(["source", "note", "keep"]);

export function detectFormat(path: string): GlossaryFormat | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "md";
  return undefined;
}

export function parseGlossary(body: string, format: GlossaryFormat): GlossaryEntry[] {
  switch (format) {
    case "csv":
      return rowsToEntries(parseCsv(body));
    case "md":
      return rowsToEntries(parseMarkdownTable(body));
    case "json":
      return parseJsonGlossary(body);
  }
}

// ---------- CSV ----------

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\r") {
      // ignore; \n handles the row
    } else if (ch === "\n") {
      pushField();
      pushRow();
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== "" || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

// ---------- Markdown table ----------

export function parseMarkdownTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  return rows;
}

// ---------- rows → entries ----------

function rowsToEntries(rows: string[][]): GlossaryEntry[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const sourceIdx = header.findIndex((h) => h.toLowerCase() === "source");
  if (sourceIdx < 0) throw new Error('glossary header must contain a "source" column');
  const noteIdx = header.findIndex((h) => h.toLowerCase() === "note");
  const keepIdx = header.findIndex((h) => h.toLowerCase() === "keep");
  const langCols = header
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) => h && !META_COLUMNS.has(h.toLowerCase()));

  const entries: GlossaryEntry[] = [];
  for (const row of rows.slice(1)) {
    const source = (row[sourceIdx] ?? "").trim();
    if (!source) continue;
    const targets: Record<string, string> = {};
    for (const { h, idx } of langCols) {
      const v = (row[idx] ?? "").trim();
      if (v) targets[h] = v;
    }
    const entry: GlossaryEntry = { source, targets };
    const note = noteIdx >= 0 ? (row[noteIdx] ?? "").trim() : "";
    if (note) entry.note = note;
    const keep = keepIdx >= 0 ? (row[keepIdx] ?? "").trim().toLowerCase() : "";
    if (keep === "true" || keep === "yes" || keep === "1" || keep === "x") entry.keep = true;
    entries.push(entry);
  }
  return entries;
}

function parseJsonGlossary(body: string): GlossaryEntry[] {
  const data = JSON.parse(body) as unknown;
  if (!Array.isArray(data)) throw new Error("JSON glossary must be an array of entries");
  const entries: GlossaryEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const source = typeof o.source === "string" ? o.source.trim() : "";
    if (!source) continue;
    const targets: Record<string, string> = {};
    if (o.targets && typeof o.targets === "object") {
      for (const [k, v] of Object.entries(o.targets as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) targets[k] = v.trim();
      }
    }
    const entry: GlossaryEntry = { source, targets };
    if (typeof o.note === "string" && o.note.trim()) entry.note = o.note.trim();
    if (o.keep === true) entry.keep = true;
    entries.push(entry);
  }
  return entries;
}

// ---------- serialisation (used by /init-translate) ----------

export function serializeGlossary(entries: GlossaryEntry[], format: GlossaryFormat, langs: string[]): string {
  if (format === "json") {
    const out = entries.map((e) => {
      const targets: Record<string, string> = {};
      for (const l of langs) if (e.targets[l]) targets[l] = e.targets[l];
      const o: Record<string, unknown> = { source: e.source, targets };
      if (e.note) o.note = e.note;
      if (e.keep) o.keep = true;
      return o;
    });
    return JSON.stringify(out, null, 2) + "\n";
  }
  const header = ["source", ...langs, "note", "keep"];
  const rows = entries.map((e) => [e.source, ...langs.map((l) => e.targets[l] ?? ""), e.note ?? "", e.keep ? "true" : ""]);
  if (format === "csv") {
    return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  }
  const md = ["# Glossary", "", `| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of rows) md.push(`| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`);
  return md.join("\n") + "\n";
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---------- rendering for the prompt ----------

export interface RenderOptions {
  /** Above this many entries, keep only terms that occur in the source text. Default 400. */
  maxEntries?: number;
}

export interface RenderedGlossary {
  markdown: string;
  /** Entries actually rendered. */
  count: number;
  /** True when occurrence filtering or truncation was applied. */
  filtered: boolean;
  /** True when entries had to be dropped even after occurrence filtering. */
  truncated: boolean;
}

export const NO_GLOSSARY_TEXT = "(no glossary provided for this project)";

/**
 * Render the glossary column for one target language.
 * - Same source term with several renderings → "A | B (by context)"
 * - "keep" terms are listed in their own section
 * - Only entries with a rendering for `lang` (or keep=true) are included
 */
export function renderGlossary(
  entries: GlossaryEntry[] | undefined,
  lang: string,
  sourceText: string,
  opts: RenderOptions = {},
): RenderedGlossary {
  const maxEntries = opts.maxEntries ?? 400;
  if (!entries || entries.length === 0) {
    return { markdown: NO_GLOSSARY_TEXT, count: 0, filtered: false, truncated: false };
  }

  // group by source term (case-sensitive: "Agent" and "agent" may legitimately differ)
  const groups = new Map<string, { renderings: string[]; notes: string[]; keep: boolean }>();
  for (const e of entries) {
    const g = groups.get(e.source) ?? { renderings: [], notes: [], keep: false };
    const r = e.targets[lang];
    if (r && !g.renderings.includes(r)) g.renderings.push(r);
    if (e.note && !g.notes.includes(e.note)) g.notes.push(e.note);
    if (e.keep) g.keep = true;
    groups.set(e.source, g);
  }

  let terms = [...groups.entries()].filter(([, g]) => g.keep || g.renderings.length > 0);

  let filtered = false;
  let truncated = false;
  if (terms.length > maxEntries) {
    filtered = true;
    const lower = sourceText.toLowerCase();
    terms = terms.filter(([source]) => occursIn(source, sourceText, lower));
    if (terms.length > maxEntries) {
      truncated = true;
      terms.sort((a, b) => b[0].length - a[0].length);
      terms = terms.slice(0, maxEntries);
    }
  }

  const translate = terms.filter(([, g]) => !g.keep);
  const keep = terms.filter(([, g]) => g.keep);

  const lines: string[] = [];
  if (translate.length > 0) {
    lines.push("| Term | Rendering | Note |", "| --- | --- | --- |");
    for (const [source, g] of translate) {
      const rendering = g.renderings.length > 1 ? `${g.renderings.join(" | ")} (by context)` : g.renderings[0];
      lines.push(`| ${esc(source)} | ${esc(rendering)} | ${esc(g.notes.join("; "))} |`);
    }
  }
  if (keep.length > 0) {
    if (lines.length) lines.push("");
    lines.push("Do not translate (keep the source form):");
    for (const [source, g] of keep) {
      lines.push(`- ${source}${g.notes.length ? ` — ${g.notes.join("; ")}` : ""}`);
    }
  }
  if (lines.length === 0) {
    return { markdown: `(the glossary has no entries for ${lang})`, count: 0, filtered, truncated };
  }
  return { markdown: lines.join("\n"), count: terms.length, filtered, truncated };
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function occursIn(term: string, text: string, lowerText: string): boolean {
  if (/^[\x00-\x7F]+$/.test(term)) {
    // Latin-only term: word boundaries, case-insensitive
    const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(term)}(?=$|[^A-Za-z0-9_])`, "i");
    return re.test(text);
  }
  return lowerText.includes(term.toLowerCase());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
