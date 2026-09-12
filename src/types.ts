export type CommandKind = "translate" | "review";

export interface GlossaryEntry {
  /** Term in the source language. */
  source: string;
  /** Renderings keyed by BCP 47 language tag, e.g. { "zh-CN": "智能体" }. */
  targets: Record<string, string>;
  note?: string;
  /** true = do not translate; keep the source form. */
  keep?: boolean;
}

export type GlossaryFormat = "csv" | "json" | "md";

export interface TranslationConfig {
  /** Editor hint written by /init-translate; ignored by the plugin. */
  $schema?: string;
  sourceLang?: string;
  targets?: string[];
  tone?: string;
  doNotTranslate?: string[];
  preserve?: string[];
  output?: { pattern?: string };
  review?: { sourcePattern?: string };
  /** Let the agent append candidate terms to glossary.suggested.<ext> after translating. Default true. */
  suggestions?: boolean;
}

export interface DiscoveredGlossary {
  path: string;
  format: GlossaryFormat;
  entries: GlossaryEntry[];
}

export interface DiscoveredConfig {
  path: string;
  value: TranslationConfig;
}

export interface DiscoveredStyleGuide {
  path: string;
  body: string;
  truncated: boolean;
}

export interface DiscoveredContext {
  /** Directory where the upward search stopped (git root or filesystem root). */
  stopDir: string;
  glossary?: DiscoveredGlossary;
  config?: DiscoveredConfig;
  styleGuide?: DiscoveredStyleGuide;
  /** Present when a tm/ directory exists; v1 records it but never loads it. */
  tmDir?: string;
  warnings: string[];
}

export interface LangSpec {
  /** Canonical BCP 47 tag, e.g. "zh-CN". */
  tag: string;
  /** Human-readable English name, e.g. "Chinese (China)". */
  name: string;
}

export interface TextSource {
  /** Inline body, or a one-line instruction telling the agent to read the file in segments. */
  body: string;
  /** Absolute path, or a label such as "(pasted text)". */
  label: string;
  /** True when the body was NOT inlined because the file exceeded the inline limit. */
  deferred: boolean;
}
