# pi-bestony-translate

A [pi](https://pi.dev) package that adds three slash commands:

| Command | What it does |
| --- | --- |
| `/translate <lang>[,<lang>…] [path]` | Translate a file or pasted text using the project glossary, config and style guide. One message per target language. |
| `/review-translate <lang> <translated-path>` | Review a translation against the same materials; `--fix` applies blocker/major findings with the `edit` tool. |
| `/init-translate` | Write a default for every file the plugin can load, so you edit instead of authoring from scratch. |

The plugin does not call a model itself. It assembles a prompt from files discovered around the current directory and sends it to the agent already running in your pi session; the agent reads, writes and edits files with its own tools.

## Install

```bash
pi install npm:pi-bestony-translate

# from git (SSH, then HTTPS once your SSH key is set up)
pi install git:git@github.com:bestony/pi-bestony-translate@v0.0.1
pi install git:github.com/bestony/pi-bestony-translate@v0.0.1

# try it for one run without touching settings
pi -e npm:pi-bestony-translate
```

Add `-l` to install into the project's `.pi/settings.json` instead of your user settings.

## Quick start

```text
/init-translate --langs zh-CN            # writes glossary.csv, translation.config.json, style-guide.md,
                                         # .pi/bestony-translate/translate.md and review.md
/translate zh-CN README.md               # → README.zh-CN.md
/translate zh-CN,ja,ko docs/intro.md     # three messages, one per language
/translate ja -- keep the headings in English
/review-translate zh-CN README.zh-CN.md  # source guessed as README.md
/review-translate zh-CN docs/a.zh-CN.md --source docs/en/a.md --fix
```

## Command grammar

```text
/translate         <lang>[,<lang>...] [path] [--to <out>] [--last] [--no-suggest] [--dry-run] [-- extra instructions]
/review-translate  <lang> <translated-path> [--source <path>] [--fix] [--json] [--dry-run] [-- extra instructions]
/translate-check   <source> <output> [--json]
/init-translate    [--format csv|json|md] [--langs zh-CN,ja] [--prompts project|user] [--force]
```

- `--dry-run` writes the assembled prompt to `.pi/bestony-translate/dry-run/<command>.<file>.<lang>.prompt.md` and sends nothing to the model; use it to inspect what the agent would receive.
- `--no-suggest` turns off glossary suggestions for one run (see below); `--json` switches the review report to a single JSON object (see CI).

- `lang` is a BCP 47 tag (`zh-CN`, `ja`, `pt-BR`); it is validated with `Intl.getCanonicalLocales`.
- Text source for `/translate`: `path` → `--last` (last assistant message) → paste into the editor.
- Files above 40 KB are not inlined; the agent is told to read them in segments.
- Anything after the recognised arguments (or after `--`) is passed to the agent verbatim as extra instructions.
- `/review-translate` finds the source via `--source`, then by stripping `.<lang>` from the translated name (`intro.zh-CN.md` → `intro.md`, configurable with `review.sourcePattern`), otherwise it reviews monolingually and says so.

## Files the plugin loads

Searched from the current directory upward to the git root (or the filesystem root outside a repo). The nearest directory wins per file; nothing is merged across levels. These names and the search rule are fixed.

| File | Purpose |
| --- | --- |
| `glossary.csv` / `glossary.json` / `glossary.md` | Terms per target language; `keep` marks terms that stay untranslated. Same source term twice → `A \| B (by context)`. |
| `translation.config.json` | `sourceLang`, `targets`, `tone`, `doNotTranslate`, `preserve`, `output.pattern`, `review.sourcePattern`, `suggestions`; validated against `schema/translation.config.schema.json`. |
| `style-guide.md` | Free-form style rules, injected whole (truncated above 32 KB). |
| `tm/` | Reserved for translation memory; detected but not loaded yet. |

Missing files produce a warning, never an error. Above 400 glossary entries only the terms that occur in the source text are sent.

### translation.config.json schema and validation

`schema/translation.config.schema.json` (JSON Schema draft-07, the dialect every mainstream editor validates) describes the file. `/init-translate` writes `"$schema": "https://raw.githubusercontent.com/bestony/pi-bestony-translate/main/schema/translation.config.schema.json"` as the first key so VS Code and friends offer completion and inline errors; a URL was chosen over a relative path because it needs no extra file in your project and follows the plugin's main branch. On every load the plugin validates the file itself with a small dependency-free validator that reads the same schema (type, properties, additionalProperties: false, items, enum — all the schema uses; a full engine such as ajv would be the package's only runtime dependency). Problems are reported as warnings with file, line, column and JSON pointer, e.g. `translation.config.json:3:3 /tonee unknown key "tonee"` or `translation.config.json:2:14 /targets expected array, got string`; unknown keys and wrongly typed values are dropped and the rest of the file is used.

**Commit them.** `glossary.*`, `translation.config.json`, `style-guide.md` and `.pi/bestony-translate/` are project configuration and belong in version control; `/init-translate` never touches `.gitignore` and reminds you of this in its final report.

### Glossary suggestions

After each translation the agent appends candidate terms (source terms that occur at least twice, are not in the glossary, and needed a deliberate rendering choice) to `glossary.suggested.<ext>` next to the glossary, in the glossary's own format with the rendering it used and a note. It never edits `glossary.*` itself. Merge by hand: open `glossary.suggested.csv`, move the rows you agree with into `glossary.csv`, delete the rest, commit. Turn it off per project with `"suggestions": false` in `translation.config.json`, or per run with `/translate … --no-suggest`.

### Glossary formats

```csv
source,zh-CN,ja,note,keep
Agent,智能体,エージェント,Product docs use 智能体,
pre-commit,,,Tool name,true
```

JSON: `[{ "source": "Agent", "targets": { "zh-CN": "智能体" }, "note": "...", "keep": false }]`. Markdown: a table with the same columns as the CSV.

## Prompts you can override

Two templates, looked up in this order:

1. `<project>/.pi/bestony-translate/translate.md` and `review.md` (only when the project is trusted)
2. `~/.pi/agent/bestony-translate/translate.md` and `review.md`
3. the package defaults in `defaults/`

Your file replaces the prompt body entirely. Placeholders: `{{source_lang}}`, `{{target_lang}}`, `{{target_lang_name}}`, `{{target_langs}}`, `{{source_text}}`, `{{source_path}}`, `{{translated_text}}`, `{{translated_path}}`, `{{output_path}}`, `{{glossary}}`, `{{rules}}`, `{{style_guide}}`, `{{format_rules}}`, `{{extra}}`, `{{mode}}`. If a template omits `{{glossary}}`, `{{rules}}`, `{{style_guide}}`, `{{format_rules}}` or the body placeholder, the plugin appends that block at the end, so the glossary is always injected. Unknown placeholders are left as-is with a warning.

## Structure check after writing

When a `/translate` (or `/review-translate --fix`) run has written a file, the plugin reads it back and compares it with the source. This is deterministic and read-only: it never rewrites anything, it only reports.

- JSON: output parses; same key set, key order and nesting; non-string values identical; placeholders inside strings (`{name}`, `{{var}}`, `%s`, `%2$d`, `$1`, `<b>`) preserved; trailing newline.
- Markdown (with or without frontmatter): same frontmatter keys in the same order; values outside the translatable allowlist byte-identical; same heading count and levels; fenced code blocks byte-identical; link and image targets preserved.
- Plain text: nothing to compare.

Hook: pi's `agent_settled` event ("fires after an agent run has fully settled and no automatic retry, compaction, or queued continuation will run" — extensions doc, *agent_start / agent_end / agent_settled*), so a multi-language batch is checked once all queued messages are done. Results appear as a transcript entry (green tick or a list of issues) and as notifications; nothing is sent to the model. In print mode (`-p`) the plugin's messages go to **stderr** (pi keeps stdout for the model's final answer and silently drops `ctx.ui.notify` there, so the plugin mirrors every notification to stderr); with `/review-translate --json --fix` the check additionally writes one JSON line `{"structure":[…],"file":…}` to stdout, which `translate-review-exit-code` merges and treats as blocking.

Run it by hand any time: `/translate-check docs/intro.md docs/intro.zh-CN.md`.

## Terminology drift in long files

Rule 7 of the default translate prompt makes the agent scan a file delivered by path before translating, write down every recurring source term that is not in the glossary together with the rendering it will use, and apply that list in every segment. The review prompt checks the same thing (drift between segments is a *major* finding), and the list is what ends up in `glossary.suggested.<ext>`.

## Output naming

Translations are written next to the source as `<name>.<lang>.<ext>`: `README.md` → `README.zh-CN.md`, `notes.txt` → `notes.ja.txt`. Change it with `output.pattern` (`{dir}`, `{name}`, `{ext}`, `{lang}`) or `--to` for a single language. Pasted text is answered in the session.

## Supported input formats

- `.md`, `.txt`: translated as text; structure (headings, lists, tables, code, links) is preserved.
- `.md` with YAML frontmatter: detected from the leading `---` block. Only the string values of `title`, `subtitle`, `description`, `summary`, `excerpt`, `tagline`, `seo_title`, `seo_description` are translated; keys, order, `date`, `slug`, `permalink`, `draft`, `layout`, `lang`, author/id fields, booleans, numbers and lists such as `tags`/`categories` (taxonomy, not prose) stay untouched. `/review-translate` treats a changed non-allowlisted value as a blocker.
- `.json`: keys, nesting, order, non-string values and placeholders (`{name}`, `%s`, `<b>`) stay untouched; only human-readable string values are translated; output keeps the original indentation and must be valid JSON. `/review-translate` checks validity and key parity.
- Anything else is treated as plain text with a warning. More formats later.

## Headless usage

Both headless paths dispatch the extension commands (verified with pi 0.85.1):

```bash
# print mode: -a trusts the project for this run; each call is one pi process
pi -a -e ./extensions/index.ts -p "/init-translate --langs zh-CN"
for f in docs/*.md; do pi -a -p "/translate zh-CN $f"; done   # after pi install
```

```js
// SDK: a caller-supplied DefaultResourceLoader must be loaded explicitly
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";

const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: ["/path/to/extensions/index.ts"] });
await loader.reload(); // without this the extension list is empty and "/translate ..." goes to the model as plain text
const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) });
await session.prompt("/translate zh-CN docs/intro.md"); // extension command runs; no model call for /init-translate
```

### CI: machine-readable review

`/review-translate … --json` makes the agent reply with one JSON object (`summary`, `verdict`, `monolingual`, `findings[]` with `severity/location/source/current/suggested/basis`, `terminology[]`, `changes[]`) and no prose. `scripts/review-exit-code.mjs` (also installed as the `translate-review-exit-code` bin) reads that output, prints a one-line summary and exits 1 on any blocker (`--fail-on major` to be stricter, 2 if no JSON was found):

```bash
pi -a -p "/review-translate zh-CN docs/a.zh-CN.md --source docs/a.md --json" | npx -y -p pi-bestony-translate translate-review-exit-code
```

`.github/workflows/translate-review.example.yml` shows a pull-request job that runs this for every changed `docs/**/*.zh-CN.md`. It is an example (the `.example.yml` suffix keeps GitHub from running it); copy it to `translate-review.yml` in the repository that holds your translations and set the model secret to enable it.

When you script `pi -p` from a process whose stdin is a pipe or socket that never closes (CI runners, agent harnesses, `subprocess` without `stdin=DEVNULL`), redirect stdin — `pi -p "…" < /dev/null` — otherwise pi waits for piped prompt input and appears to hang after the command has run. This is pi's print-mode behaviour, not something the plugin controls.

`scripts/sdk-init.mjs` is a runnable version of the SDK check. Non-interactive runs never show a trust prompt, so set `defaultProjectTrust: "always"` in the agent dir's `settings.json` (or pass `-a` to the CLI) or the project-level prompt overrides and `/init-translate` are refused.

The pure logic is also importable without pi: `import { discover, renderGlossary, assemble, runInit } from "pi-bestony-translate"` (see `src/index.ts`).

## Development

```bash
npm install
npm test            # vitest: args, glossary, discovery, prompt assembly, init, session parsing
npm run typecheck

pi install ./       # local path install; or, for one run:
pi -e ./extensions/index.ts
```

Reloading: pi does not watch extension files. After editing, run `/reload` in the interactive session (or any extension command that calls `ctx.reload()`); extensions loaded with `-e`, with `pi install <local path>` and from auto-discovered directories are all re-read from disk on reload, including helper modules under `src/`. Verified with pi 0.85.1 in RPC mode: a changed command description was invisible until reload and present right after.

`src/` has no runtime dependency on pi, so the tests run without a pi installation. `--last` relies on pi's exported `SessionEntry` / `SessionMessageEntry` types and is tested against a session file written by pi's own `SessionManager` (`scripts/make-session-fixture.mjs`).

## License

MIT
