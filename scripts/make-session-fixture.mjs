#!/usr/bin/env node
// Writes a real pi session file through pi's own SessionManager (no model call needed) and
// prints its path. Used once to produce test/fixtures/session/last-assistant.jsonl.
//
//   node scripts/make-session-fixture.mjs [outDir]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const cwd = process.argv[2] ?? mkdtempSync(join(tmpdir(), "bt-session-"));
const sessionDir = join(cwd, "sessions");
const sm = SessionManager.create(cwd, sessionDir);

sm.appendMessage({ role: "user", content: "Say hi and then call a tool.", timestamp: Date.now() });
sm.appendMessage({
  role: "assistant",
  content: [
    { type: "thinking", thinking: "The user wants a greeting." },
    { type: "text", text: "Hello from the assistant." },
    { type: "toolCall", id: "call_1", name: "read", arguments: { path: "README.md" } },
  ],
  api: "anthropic-messages",
  provider: "example",
  model: "example-model",
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "toolUse",
  timestamp: Date.now(),
});
sm.appendMessage({
  role: "toolResult",
  toolCallId: "call_1",
  toolName: "read",
  content: [{ type: "text", text: "# README" }],
  isError: false,
  timestamp: Date.now(),
});
sm.appendMessage({
  role: "assistant",
  content: [
    { type: "text", text: "The README starts with a heading." },
    { type: "text", text: "Nothing else to report." },
  ],
  api: "anthropic-messages",
  provider: "example",
  model: "example-model",
  usage: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 28, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: Date.now(),
});
sm.appendMessage({ role: "user", content: [{ type: "text", text: "Thanks." }], timestamp: Date.now() });

console.log(sm.getSessionFile());
