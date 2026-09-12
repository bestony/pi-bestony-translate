import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { assistantText, isMessageEntry, lastAssistantText } from "../src/session";
import { FIXTURES } from "./helpers";

// Produced by scripts/make-session-fixture.mjs through pi's own SessionManager (session format v3).
const FIXTURE = join(FIXTURES, "session", "last-assistant.jsonl");

async function entriesFromJsonl(): Promise<SessionEntry[]> {
  const lines = (await readFile(FIXTURE, "utf8")).split("\n").filter(Boolean);
  const raw = lines.map((l) => JSON.parse(l) as { type: string });
  return raw.filter((e) => e.type !== "session") as unknown as SessionEntry[]; // first line is the SessionHeader
}

describe("lastAssistantText", () => {
  it("returns the text blocks of the most recent assistant message, skipping the trailing user message", async () => {
    const entries = await entriesFromJsonl();
    expect(entries.map((e) => e.type)).toEqual(["message", "message", "message", "message", "message"]);
    expect(lastAssistantText(entries)).toBe("The README starts with a heading.\nNothing else to report.");
  });

  it("skips thinking and toolCall blocks", async () => {
    const entries = await entriesFromJsonl();
    const first = entries.find((e) => isMessageEntry(e) && e.message.role === "assistant");
    expect(first && isMessageEntry(first) && first.message.role === "assistant" ? assistantText(first.message) : "").toBe(
      "Hello from the assistant.",
    );
  });

  it("matches what SessionManager.getBranch() returns for the same file", async () => {
    const sm = SessionManager.open(FIXTURE);
    const branch = sm.getBranch();
    expect(branch.length).toBe(5);
    expect(lastAssistantText(branch)).toBe("The README starts with a heading.\nNothing else to report.");
  });

  it("returns undefined when there is no assistant text", () => {
    expect(lastAssistantText([])).toBeUndefined();
    const onlyUser: SessionEntry[] = [
      { type: "message", id: "a", parentId: null, timestamp: "t", message: { role: "user", content: "hi", timestamp: 0 } },
    ];
    expect(lastAssistantText(onlyUser)).toBeUndefined();
  });
});
