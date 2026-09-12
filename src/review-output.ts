/** The {{output_format}} block of review.md: Markdown report (default) or a single JSON object (--json). */
export function reviewOutputFormat(json: boolean): string {
  return json ? JSON_OUTPUT : MARKDOWN_OUTPUT;
}

export const MARKDOWN_OUTPUT = `### Summary
Two or three sentences: overall quality, whether it can ship as is, the single most common class of problem.

### Findings
Sorted by severity, one entry per finding:
- [blocker | major | minor] location (line number or section heading)
  - Source: …
  - Current: …
  - Suggested: …
  - Basis: glossary / project rule N / style guide / accuracy

### Terminology consistency
Only terms with problems, one per line: \`term → glossary rendering | renderings found in the text (count)\`.

### Changes
- Mode "report": do not modify any file; write "No files modified" here.
- Mode "fix": apply blocker and major findings one by one with the edit tool; leave minor findings alone; do not rewrite the whole file. Then list the changed locations here.`;

export const JSON_OUTPUT = `Reply with exactly one JSON object and nothing else: no prose before or after it, no Markdown code fence. Schema (all fields required; use empty arrays when there is nothing to report):
{
  "summary": "two or three sentences",
  "verdict": "ship" | "fix" | "block",
  "monolingual": true | false,
  "findings": [
    { "severity": "blocker" | "major" | "minor", "location": "line number or section heading", "source": "…", "current": "…", "suggested": "…", "basis": "glossary | project rule N | style guide | accuracy" }
  ],
  "terminology": [
    { "term": "…", "glossary": "rendering from the glossary", "found": [ { "rendering": "…", "count": 1 } ] }
  ],
  "changes": [ { "location": "…", "description": "…" } ]
}
Sort findings by severity (blocker, major, minor). "verdict" is "block" if any blocker exists, "fix" if any major exists, otherwise "ship".
Mode "report": do not modify any file and leave "changes" empty. Mode "fix": apply blocker and major findings with the edit tool before replying and list each edit in "changes"; do not rewrite the whole file.`;
