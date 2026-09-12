#!/usr/bin/env node
// Reads the output of `pi -p "/review-translate <lang> <file> --json"` from stdin (or a file
// argument), finds the review JSON object, prints a one-line summary and exits:
//   0  no blocker (and, with --fail-on major, no major)
//   1  at least one blocker (or major with --fail-on major)
//   2  no review JSON object found in the input
//
//   pi -a -p "/review-translate zh-CN docs/a.zh-CN.md --source docs/a.md --json" | node scripts/review-exit-code.mjs
//   node scripts/review-exit-code.mjs review-output.txt --fail-on major
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const failOnIdx = args.indexOf("--fail-on");
const failOn = failOnIdx >= 0 ? (args[failOnIdx + 1] ?? "blocker") : "blocker";
const fileArg = args.find((a, i) => !a.startsWith("--") && (failOnIdx < 0 || i !== failOnIdx + 1));

const input = fileArg ? readFileSync(fileArg, "utf8") : readFileSync(0, "utf8");
const { review, structure } = extractObjects(input);
if (!review) {
  console.error("review-exit-code: no JSON object with a \"findings\" array found in the input");
  process.exit(2);
}

const counts = { blocker: 0, major: 0, minor: 0 };
for (const f of review.findings) {
  if (f && typeof f === "object" && f.severity in counts) counts[f.severity]++;
}
// Deterministic structure-check results (emitted by the plugin after the agent settled) count as blockers.
const structureIssues = structure.flatMap((s) => s.structure);
const verdict = review.verdict ?? (counts.blocker ? "block" : counts.major ? "fix" : "ship");
console.log(`review: verdict=${verdict} blockers=${counts.blocker} major=${counts.major} minor=${counts.minor} terminology=${Array.isArray(review.terminology) ? review.terminology.length : 0} structure=${structureIssues.length}`);
if (review.summary) console.log(String(review.summary));
for (const s of structure) for (const i of s.structure) console.log(`structure ${s.file ?? ""} ${i.code} ${i.path ?? ""}: ${i.message}`);

const fail =
  counts.blocker > 0 ||
  structureIssues.length > 0 ||
  (failOn === "major" && counts.major > 0) ||
  (failOn === "minor" && (counts.major > 0 || counts.minor > 0));
process.exit(fail ? 1 : 0);

/**
 * Scan for balanced top-level JSON objects: the last one with a `findings` array is the review,
 * every one with a `structure` array is a structure-check result.
 */
export function extractObjects(text) {
  let review;
  const structure = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const end = matchBrace(text, i);
    if (end < 0) continue;
    try {
      const obj = JSON.parse(text.slice(i, end + 1));
      if (obj && Array.isArray(obj.findings)) {
        review = obj;
        i = end;
      } else if (obj && Array.isArray(obj.structure)) {
        structure.push(obj);
        i = end;
      }
    } catch {
      // not JSON; keep scanning
    }
  }
  return { review, structure };
}

function matchBrace(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
