import { readFileSync } from "node:fs";
import type { TranslationConfig } from "./types";

/**
 * translation.config.json parsing and validation.
 *
 * The validator is dependency-free on purpose: the config is ~10 keys, pi installs runtime
 * dependencies at `pi install` time, and a full JSON Schema engine (ajv is ~1 MB with codegen)
 * would be the package's only runtime dependency. The subset implemented here — type,
 * properties, additionalProperties:false, items, enum — is exactly what
 * schema/translation.config.schema.json uses, and the schema file stays the single source of
 * truth: the validator reads it at runtime.
 */

export const SCHEMA_URL = "https://raw.githubusercontent.com/bestony/pi-bestony-translate/main/schema/translation.config.schema.json";

export interface Position {
  line: number;
  column: number;
}

export interface ConfigIssue {
  /** JSON pointer to the offending value or key, e.g. "/output/pattern". */
  pointer: string;
  line: number;
  column: number;
  code: "unknown-key" | "wrong-type" | "invalid-enum" | "syntax";
  message: string;
}

export interface ParsedConfig {
  /** The config with unknown keys and wrongly typed values removed. */
  value: TranslationConfig;
  issues: ConfigIssue[];
}

export interface Located {
  value: unknown;
  /** Position of the value's first character. */
  pos: Position;
  /** For objects: key → member (key position is the member's `keyPos`). */
  members?: Map<string, Located & { keyPos: Position }>;
  /** For arrays: element nodes. */
  items?: Located[];
}

/** JSON parser that records line/column for every value and key (for diagnostics). */
export function parseJsonWithPositions(text: string): Located {
  let i = 0;
  let line = 1;
  let col = 1;

  const pos = (): Position => ({ line, column: col });
  const fail = (msg: string): never => {
    throw new SyntaxError(`${msg} at ${line}:${col}`);
  };
  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (text[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };
  const ws = () => {
    while (i < text.length && /[ \t\r\n]/.test(text[i])) advance();
  };
  const parseString = (): string => {
    if (text[i] !== '"') fail("expected string");
    const start = i;
    advance();
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") advance();
      advance();
    }
    if (i >= text.length) fail("unterminated string");
    advance();
    return JSON.parse(text.slice(start, i)) as string;
  };
  const parseValue = (): Located => {
    ws();
    const p = pos();
    const ch = text[i];
    if (ch === "{") {
      advance();
      const members = new Map<string, Located & { keyPos: Position }>();
      ws();
      if (text[i] === "}") {
        advance();
        return { value: {}, pos: p, members };
      }
      for (;;) {
        ws();
        const keyPos = pos();
        const key = parseString();
        ws();
        if (text[i] !== ":") fail("expected ':'");
        advance();
        const v = parseValue();
        members.set(key, { ...v, keyPos });
        ws();
        if (text[i] === ",") {
          advance();
          continue;
        }
        if (text[i] === "}") {
          advance();
          break;
        }
        fail("expected ',' or '}'");
      }
      const obj: Record<string, unknown> = {};
      for (const [k, v] of members) obj[k] = v.value;
      return { value: obj, pos: p, members };
    }
    if (ch === "[") {
      advance();
      const items: Located[] = [];
      ws();
      if (text[i] === "]") {
        advance();
        return { value: [], pos: p, items };
      }
      for (;;) {
        items.push(parseValue());
        ws();
        if (text[i] === ",") {
          advance();
          continue;
        }
        if (text[i] === "]") {
          advance();
          break;
        }
        fail("expected ',' or ']'");
      }
      return { value: items.map((x) => x.value), pos: p, items };
    }
    if (ch === '"') return { value: parseString(), pos: p };
    const lit = /^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!lit) return fail(`unexpected character '${ch ?? "EOF"}'`);
    advance(lit[0].length);
    return { value: JSON.parse(lit[0]), pos: p };
  };

  const root = parseValue();
  ws();
  if (i < text.length) fail("unexpected trailing content");
  return root;
}

// ---------- schema subset ----------

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean;
  items?: SchemaNode;
  enum?: unknown[];
}

let cachedSchema: SchemaNode | undefined;

export function loadSchema(): SchemaNode {
  if (!cachedSchema) {
    cachedSchema = JSON.parse(readFileSync(new URL("../schema/translation.config.schema.json", import.meta.url), "utf8")) as SchemaNode;
  }
  return cachedSchema;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === "number" && actual === "integer");
}

/** Validate a located JSON value against the schema subset; removes offending members from `node.value` in place. */
export function validateAgainst(node: Located, schema: SchemaNode, pointer: string, issues: ConfigIssue[]): void {
  const actual = typeOf(node.value);
  if (schema.type && !typeMatches(schema.type, actual)) {
    issues.push({ pointer: pointer || "/", line: node.pos.line, column: node.pos.column, code: "wrong-type", message: `expected ${schema.type}, got ${actual}` });
    return;
  }
  if (schema.enum && !schema.enum.some((e) => e === node.value)) {
    issues.push({ pointer: pointer || "/", line: node.pos.line, column: node.pos.column, code: "invalid-enum", message: `expected one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });
    return;
  }
  if (actual === "object" && node.members) {
    const obj = node.value as Record<string, unknown>;
    for (const [key, member] of node.members) {
      const sub = schema.properties?.[key];
      const childPointer = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (!sub) {
        if (schema.additionalProperties === false) {
          issues.push({ pointer: childPointer, line: member.keyPos.line, column: member.keyPos.column, code: "unknown-key", message: `unknown key "${key}"` });
          delete obj[key];
        }
        continue;
      }
      const before = issues.length;
      validateAgainst(member, sub, childPointer, issues);
      // drop a member whose own type/enum is wrong so callers never see a bad value
      if (issues.length > before && issues[before].pointer === childPointer && issues[before].code !== "unknown-key") delete obj[key];
    }
  }
  if (actual === "array" && node.items && schema.items) {
    const arr = node.value as unknown[];
    const keep: unknown[] = [];
    node.items.forEach((item, idx) => {
      const before = issues.length;
      validateAgainst(item, schema.items!, `${pointer}/${idx}`, issues);
      if (issues.length === before) keep.push(item.value);
    });
    arr.length = 0;
    arr.push(...keep);
  }
}

/** Parse + validate translation.config.json text. Syntax errors yield an empty config and one issue. */
export function parseConfig(text: string): ParsedConfig {
  const issues: ConfigIssue[] = [];
  let root: Located;
  try {
    root = parseJsonWithPositions(text);
  } catch (err) {
    const m = /at (\d+):(\d+)$/.exec((err as Error).message);
    issues.push({ pointer: "", line: m ? Number(m[1]) : 1, column: m ? Number(m[2]) : 1, code: "syntax", message: (err as Error).message });
    return { value: {}, issues };
  }
  validateAgainst(root, loadSchema(), "", issues);
  if (typeOf(root.value) !== "object") return { value: {}, issues };
  return { value: root.value as TranslationConfig, issues };
}

export function formatConfigIssue(file: string, i: ConfigIssue): string {
  return `${file}:${i.line}:${i.column} ${i.pointer || "/"} ${i.message}`;
}
