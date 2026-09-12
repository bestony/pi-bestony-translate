import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

/**
 * Shapes taken from pi's exported types (node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts
 * and the "Message Types" section of https://pi.dev/docs/latest/session-format):
 *   SessionMessageEntry = { type: "message"; message: AgentMessage; id; parentId; timestamp }
 *   AssistantMessage    = { role: "assistant"; content: (TextContent | ThinkingContent | ToolCall)[]; ... }
 *   TextContent         = { type: "text"; text: string }
 */
export type AssistantEntryMessage = Extract<SessionMessageEntry["message"], { role: "assistant" }>;

export function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === "message";
}

/** Concatenated text blocks of an assistant message (thinking and tool calls are skipped). */
export function assistantText(message: AssistantEntryMessage): string {
  return message.content
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/**
 * Text of the most recent assistant message on the given branch (what `--last` translates).
 * Returns undefined when the branch has no assistant message with text content.
 */
export function lastAssistantText(branch: readonly SessionEntry[]): string | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (!isMessageEntry(entry) || entry.message.role !== "assistant") continue;
    const text = assistantText(entry.message);
    if (text) return text;
  }
  return undefined;
}
