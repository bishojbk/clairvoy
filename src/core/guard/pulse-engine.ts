/**
 * Pulse Engine
 *
 * Performance-critical module that incrementally reads a session log
 * and checks thresholds. Must complete in <100ms.
 *
 * NO chalk, NO heavy imports.
 */

import { openSync, readSync, fstatSync, closeSync } from "node:fs";
import type { PulseState, PulseThresholds } from "../types.js";
import { getPricing, calculateCost } from "../constants.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PulseResult {
  warnings: string[];
  statusLine: string;
  state: PulseState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(sessionId: string): PulseState {
  return {
    sessionId,
    bytesRead: 0,
    remainder: "",
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    turnCount: 0,
    toolCallCount: 0,
    model: "",
    lastTimestamp: "",
    fileReadCounts: {},
    lastWarnings: {},
    warningCount: 0,
  };
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1_000)}K`;
}

// ---------------------------------------------------------------------------
// Main pulse function
// ---------------------------------------------------------------------------

export function runPulse(
  sessionFilePath: string,
  previousState: PulseState | null,
  thresholds: PulseThresholds,
): PulseResult {
  const state: PulseState = previousState
    ? { ...previousState, fileReadCounts: { ...previousState.fileReadCounts }, lastWarnings: { ...previousState.lastWarnings } }
    : freshState("");

  // Read new bytes from file
  const fd = openSync(sessionFilePath, "r");
  try {
    const fileSize = fstatSync(fd).size;
    if (fileSize <= state.bytesRead) {
      return { warnings: [], statusLine: "", state };
    }

    const bytesToRead = fileSize - state.bytesRead;
    const buffer = Buffer.alloc(bytesToRead);
    readSync(fd, buffer, 0, bytesToRead, state.bytesRead);
    state.bytesRead = fileSize;

    // Combine remainder with new data and split into lines
    const rawText = state.remainder + buffer.toString("utf-8");
    const lines = rawText.split("\n");

    // Last element is incomplete if the file doesn't end with newline
    state.remainder = lines.pop() ?? "";

    // Process each complete JSON line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const entryType = entry.type as string | undefined;
      const message = entry.message as Record<string, unknown> | undefined;
      if (!message) continue;

      if (entry.timestamp) {
        state.lastTimestamp = entry.timestamp as string;
      }

      if (entryType === "assistant") {
        // Extract model
        if (message.model) {
          state.model = message.model as string;
        }

        // Accumulate usage
        const usage = message.usage as Record<string, number> | undefined;
        if (usage) {
          state.totalInput += usage.input_tokens ?? 0;
          state.totalOutput += usage.output_tokens ?? 0;
          state.totalCacheRead += usage.cache_read_input_tokens ?? 0;
          state.totalCacheWrite += usage.cache_creation_input_tokens ?? 0;
        }

        // Count tool_use blocks and track file reads
        const content = message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_use") {
              state.toolCallCount++;
              const toolName = b.name as string | undefined;
              const input = b.input as Record<string, unknown> | undefined;
              if (input && (toolName === "Read" || toolName === "Bash")) {
                const filePath =
                  (input.file_path as string | undefined) ??
                  (input.path as string | undefined) ??
                  (input.command as string | undefined);
                if (filePath) {
                  state.fileReadCounts[filePath] = (state.fileReadCounts[filePath] ?? 0) + 1;
                }
              }
            }
          }
        }
      }

      if (entryType === "user") {
        // Count user turns — only real user messages, not just tool_result
        const content = message.content;
        if (typeof content === "string" && content.length > 0) {
          state.turnCount++;
        } else if (Array.isArray(content)) {
          const hasTextBlock = (content as Array<Record<string, unknown>>).some(
            (b) => b.type === "text" && typeof b.text === "string" && (b.text as string).length > 0,
          );
          if (hasTextBlock) {
            state.turnCount++;
          }
        }
      }
    }
  } finally {
    closeSync(fd);
  }

  // Check thresholds and build warnings
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const debounceMs = 60_000;

  function shouldEmit(key: string): boolean {
    const last = state.lastWarnings[key];
    if (!last) return true;
    return Date.now() - new Date(last).getTime() > debounceMs;
  }

  // Context size warning
  const contextSize = state.totalCacheRead + state.totalCacheWrite + state.totalInput;
  if (contextSize > thresholds.contextWarningTokens) {
    const key = "context_warning";
    if (shouldEmit(key)) {
      warnings.push(`[clairvoy] Context at ${formatTokenCount(contextSize)} tokens — consider /compact to reduce context`);
      state.lastWarnings[key] = now;
    }
  }

  // Cost warning
  const cost = calculateCost(
    {
      totalInputTokens: state.totalInput,
      totalOutputTokens: state.totalOutput,
      totalCacheCreationTokens: state.totalCacheWrite,
      totalCacheReadTokens: state.totalCacheRead,
    },
    getPricing(state.model),
  );
  if (cost > thresholds.costWarningDollars) {
    const key = "cost_warning";
    if (shouldEmit(key)) {
      warnings.push(`[clairvoy] Session cost: $${cost.toFixed(2)} at API pricing (${state.turnCount} turns)`);
      state.lastWarnings[key] = now;
    }
  }

  // File re-read warnings
  for (const [filePath, count] of Object.entries(state.fileReadCounts)) {
    if (count > thresholds.fileReReadThreshold) {
      const key = `reread:${filePath}`;
      if (shouldEmit(key)) {
        warnings.push(`[clairvoy] ${filePath} read ${count} times — re-reads waste tokens`);
        state.lastWarnings[key] = now;
      }
    }
  }

  // Turn count warning
  if (state.turnCount > thresholds.turnCountWarning) {
    const key = "turn_warning";
    if (shouldEmit(key)) {
      warnings.push(`[clairvoy] ${state.turnCount} turns in this session — consider starting a new session`);
      state.lastWarnings[key] = now;
    }
  }

  // Budget cap warning (always emits, no debounce — this is critical)
  if (thresholds.budgetDollars && cost > thresholds.budgetDollars) {
    const overBy = (cost - thresholds.budgetDollars).toFixed(2);
    warnings.push(`[clairvoy] BUDGET EXCEEDED — $${cost.toFixed(2)} spent (budget: $${thresholds.budgetDollars.toFixed(2)}, over by $${overBy}). Consider wrapping up or starting a new session.`);
  } else if (thresholds.budgetDollars && cost > thresholds.budgetDollars * 0.8) {
    const key = "budget_approaching";
    if (shouldEmit(key)) {
      const pct = Math.round((cost / thresholds.budgetDollars) * 100);
      warnings.push(`[clairvoy] Budget ${pct}% used — $${cost.toFixed(2)} of $${thresholds.budgetDollars.toFixed(2)} cap`);
      state.lastWarnings[key] = now;
    }
  }

  state.warningCount += warnings.length;

  // Build compact status line
  const reReadCount = Object.values(state.fileReadCounts).filter((c) => c > 1).length;
  const budgetPart = thresholds.budgetDollars
    ? ` | budget: ${Math.round((cost / thresholds.budgetDollars) * 100)}%`
    : "";
  const statusLine = `[clairvoy] $${cost.toFixed(2)} | ${state.turnCount} turns | ${formatTokenCount(contextSize)} ctx | ${reReadCount} re-reads${budgetPart}`;

  return { warnings, statusLine, state };
}
