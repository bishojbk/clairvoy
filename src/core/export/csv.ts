/**
 * CSV export for clairvoy sessions.
 *
 * RULE: Pure module — no chalk, no process.exit, no CLI deps.
 */

import type { ParsedSession, TokenBreakdown, SessionScore } from "../types.js";
import { getPricing } from "../constants.js";

export interface ExportableSession {
  parsed: ParsedSession;
  breakdown: TokenBreakdown;
  score: SessionScore;
}

/**
 * Decode Claude Code's project path encoding.
 * -Users-foo-bar -> /Users/foo/bar
 * Duplicated from cli/util/format.ts to avoid cross-layer import.
 */
function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

/**
 * Escape a value for CSV (RFC 4180).
 */
function csvEscape(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const COLUMNS = [
  "sessionId",
  "project",
  "model",
  "startTime",
  "endTime",
  "durationMinutes",
  "turns",
  "toolCalls",
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "totalCost",
  "inputCost",
  "outputCost",
  "cacheReadCost",
  "cacheWriteCost",
  "wastePercent",
  "wasteDollars",
  "score",
  "grade",
] as const;

/**
 * Convert an array of analyzed sessions to a CSV string.
 */
export function sessionsToCSV(sessions: ExportableSession[]): string {
  const rows: string[] = [COLUMNS.join(",")];

  for (const { parsed, breakdown, score } of sessions) {
    const pricing = getPricing(parsed.model);
    const usage = parsed.totalUsage;

    const durationMs =
      parsed.startTime && parsed.endTime
        ? new Date(parsed.endTime).getTime() - new Date(parsed.startTime).getTime()
        : 0;
    const durationMinutes = Math.round((durationMs / 60_000) * 10) / 10;

    const totalTokens =
      usage.totalInputTokens +
      usage.totalOutputTokens +
      usage.totalCacheCreationTokens +
      usage.totalCacheReadTokens;

    const inputCost = (usage.totalInputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (usage.totalOutputTokens / 1_000_000) * pricing.outputPerMillion;
    const cacheReadCost = (usage.totalCacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
    const cacheWriteCost = (usage.totalCacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion;

    const values: (string | number)[] = [
      parsed.sessionId,
      decodeProjectPath(parsed.projectPath),
      parsed.model,
      parsed.startTime,
      parsed.endTime,
      durationMinutes,
      usage.turnCount,
      usage.toolCallCount,
      totalTokens,
      usage.totalInputTokens,
      usage.totalOutputTokens,
      usage.totalCacheReadTokens,
      usage.totalCacheCreationTokens,
      breakdown.totalCostDollars,
      Math.round(inputCost * 100) / 100,
      Math.round(outputCost * 100) / 100,
      Math.round(cacheReadCost * 100) / 100,
      Math.round(cacheWriteCost * 100) / 100,
      breakdown.estimatedSavingsPercent,
      breakdown.estimatedSavingsDollars,
      score.numericScore,
      score.overall,
    ];

    rows.push(values.map(csvEscape).join(","));
  }

  return rows.join("\n") + "\n";
}
