/**
 * Session JSONL Parser
 *
 * Reads Claude Code session log files and extracts structured data.
 * Each line is a JSON object representing an event in the conversation.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  RawLogEntry,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  ParsedSession,
  Turn,
  ToolCall,
  AggregatedUsage,
  TokenUsage,
  SessionMetadata,
} from "../types.js";
import { estimateTokens } from "../constants.js";

/**
 * Parse a JSONL session file into structured data.
 */
export function parseSession(filePath: string): ParsedSession {
  const raw = readFileSync(filePath, "utf-8");
  return parseSessionFromString(raw, filePath);
}

/**
 * Parse JSONL content string into structured data.
 * Web-reusable: no filesystem access needed.
 */
export function parseSessionFromString(content: string, source = "unknown"): ParsedSession {
  const lines = content.split("\n").filter((l) => l.trim());

  const entries: RawLogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as RawLogEntry);
    } catch {
      // Skip malformed lines
    }
  }

  // Extract user prompt entries (not tool results) and assistant messages
  const userEntries = entries.filter((e) => e.type === "user" && e.message && isUserPrompt(e));
  const assistantEntries = entries.filter((e) => e.type === "assistant" && e.message);

  // Group into turns: each user message followed by its assistant responses
  const turns: Turn[] = [];
  let model = "unknown";

  for (let i = 0; i < userEntries.length; i++) {
    const userEntry = userEntries[i];
    const userContent = extractUserText(userEntry);

    // Find all assistant responses between this user message and the next
    const nextUserUuid = i + 1 < userEntries.length ? (userEntries[i + 1].uuid ?? null) : null;
    const relevantAssistant = findAssistantResponses(
      assistantEntries,
      userEntry.uuid!,
      nextUserUuid,
      entries,
    );

    // Aggregate content blocks and usage across assistant messages in this turn
    const allBlocks: ContentBlock[] = [];
    const toolCalls: ToolCall[] = [];
    const turnUsage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    // Find turn duration from system entries
    let turnDurationMs: number | undefined;

    for (const aEntry of relevantAssistant) {
      const msg = aEntry.message!;
      if (msg.model) model = msg.model;

      // Accumulate usage
      if (msg.usage) {
        turnUsage.input_tokens += msg.usage.input_tokens || 0;
        turnUsage.output_tokens += msg.usage.output_tokens || 0;
        turnUsage.cache_creation_input_tokens! += msg.usage.cache_creation_input_tokens || 0;
        turnUsage.cache_read_input_tokens! += msg.usage.cache_read_input_tokens || 0;
      }

      // Collect content blocks
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          allBlocks.push(block as ContentBlock);

          // Track tool calls
          if (block.type === "tool_use") {
            const toolBlock = block as ToolUseBlock;
            const resultText = findToolResult(entries, toolBlock.id);
            toolCalls.push({
              id: toolBlock.id,
              name: toolBlock.name,
              input: toolBlock.input,
              resultText,
              resultTokenEstimate: estimateTokens(resultText),
            });
          }
        }
      }
    }

    // Look for turn_duration system entry after this turn
    for (const e of entries) {
      if (
        e.type === "system" &&
        e.subtype === "turn_duration" &&
        e.durationMs &&
        e.parentUuid === userEntry.uuid
      ) {
        turnDurationMs = e.durationMs;
        break;
      }
    }

    turns.push({
      index: i,
      timestamp: userEntry.timestamp || "",
      userMessage: userContent,
      assistantBlocks: allBlocks,
      toolCalls,
      usage: turnUsage,
      model,
      durationMs: turnDurationMs,
    });
  }

  // Build aggregated usage
  const totalUsage = aggregateUsage(turns);

  // Extract metadata
  const firstEntry = entries.find((e) => e.timestamp);
  const lastEntry = [...entries].reverse().find((e) => e.timestamp);
  const sessionId = entries.find((e) => e.sessionId)?.sessionId || basename(source, ".jsonl");
  const projectDir = basename(join(source, ".."));

  // Extract session metadata
  const metadata: SessionMetadata = {};
  for (const e of entries) {
    if (e.cwd && !metadata.cwd) metadata.cwd = e.cwd;
    if (e.version && !metadata.version) metadata.version = e.version;
    if (e.gitBranch && !metadata.gitBranch) metadata.gitBranch = e.gitBranch;
    if (e.entrypoint && !metadata.entrypoint) metadata.entrypoint = e.entrypoint;
    if (e.customTitle && !metadata.customTitle) metadata.customTitle = e.customTitle;
  }

  return {
    sessionId,
    projectPath: projectDir,
    startTime: firstEntry?.timestamp || "",
    endTime: lastEntry?.timestamp || "",
    model,
    turns,
    totalUsage,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Distinguish between user prompts (actual user input) and tool result messages.
 * Tool results have array content containing only tool_result blocks.
 */
function isUserPrompt(entry: RawLogEntry): boolean {
  const content = entry.message?.content;
  if (typeof content === "string") return true;
  if (Array.isArray(content)) {
    // If all blocks are tool_result, this is not a user prompt
    const hasText = content.some((b) => b.type === "text" && "text" in b);
    const hasToolResult = content.some((b) => b.type === "tool_result");
    if (hasToolResult && !hasText) return false;
    return true;
  }
  return false;
}

function extractUserText(entry: RawLogEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text" && "text" in b)
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
  }
  return "";
}

function findAssistantResponses(
  _assistantEntries: RawLogEntry[],
  userUuid: string,
  nextUserUuid: string | null,
  allEntries: RawLogEntry[],
): RawLogEntry[] {
  const userIndex = allEntries.findIndex((e) => e.uuid === userUuid);
  const nextUserIndex = nextUserUuid
    ? allEntries.findIndex((e) => e.uuid === nextUserUuid)
    : allEntries.length;

  return allEntries.filter(
    (e, idx) =>
      e.type === "assistant" && e.message && idx > userIndex && idx < nextUserIndex,
  );
}

function findToolResult(entries: RawLogEntry[], toolUseId: string): string {
  for (const entry of entries) {
    if (entry.type !== "user" || !entry.message) continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      const b = block as ToolResultBlock;
      if (b.type === "tool_result" && b.tool_use_id === toolUseId) {
        if (typeof b.content === "string") return b.content;
        if (Array.isArray(b.content)) {
          return b.content.map((c) => c.text || "").join("\n");
        }
      }
    }
  }
  return "";
}

function aggregateUsage(turns: Turn[]): AggregatedUsage {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let toolCallCount = 0;

  for (const turn of turns) {
    totalInputTokens += turn.usage.input_tokens;
    totalOutputTokens += turn.usage.output_tokens;
    totalCacheCreationTokens += turn.usage.cache_creation_input_tokens || 0;
    totalCacheReadTokens += turn.usage.cache_read_input_tokens || 0;
    toolCallCount += turn.toolCalls.length;
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    turnCount: turns.length,
    toolCallCount,
  };
}
