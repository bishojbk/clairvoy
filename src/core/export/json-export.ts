/**
 * JSON export for clairvoy sessions.
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
 * Duplicated from cli/util/format.ts to avoid cross-layer import.
 */
function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

/**
 * Convert an array of analyzed sessions to a pretty-printed JSON string.
 */
export function sessionsToJSON(sessions: ExportableSession[]): string {
  const output = sessions.map(({ parsed, breakdown, score }) => {
    const pricing = getPricing(parsed.model);
    const usage = parsed.totalUsage;

    const durationMs =
      parsed.startTime && parsed.endTime
        ? new Date(parsed.endTime).getTime() - new Date(parsed.startTime).getTime()
        : 0;

    const totalTokens =
      usage.totalInputTokens +
      usage.totalOutputTokens +
      usage.totalCacheCreationTokens +
      usage.totalCacheReadTokens;

    const inputCost = (usage.totalInputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (usage.totalOutputTokens / 1_000_000) * pricing.outputPerMillion;
    const cacheReadCost = (usage.totalCacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
    const cacheWriteCost = (usage.totalCacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion;

    return {
      sessionId: parsed.sessionId,
      project: decodeProjectPath(parsed.projectPath),
      model: parsed.model,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      durationMinutes: Math.round((durationMs / 60_000) * 10) / 10,
      turns: usage.turnCount,
      toolCalls: usage.toolCallCount,
      totalTokens,
      inputTokens: usage.totalInputTokens,
      outputTokens: usage.totalOutputTokens,
      cacheReadTokens: usage.totalCacheReadTokens,
      cacheWriteTokens: usage.totalCacheCreationTokens,
      totalCost: breakdown.totalCostDollars,
      inputCost: Math.round(inputCost * 100) / 100,
      outputCost: Math.round(outputCost * 100) / 100,
      cacheReadCost: Math.round(cacheReadCost * 100) / 100,
      cacheWriteCost: Math.round(cacheWriteCost * 100) / 100,
      wastePercent: breakdown.estimatedSavingsPercent,
      wasteDollars: breakdown.estimatedSavingsDollars,
      score: score.numericScore,
      grade: score.overall,
      categories: breakdown.categories.map((c) => ({
        name: c.name,
        tokens: c.tokens,
        percent: c.percent,
      })),
      warnings: breakdown.warnings.map((w) => ({
        severity: w.severity,
        message: w.message,
        tokensWasted: w.tokensWasted,
      })),
    };
  });

  return JSON.stringify(output, null, 2) + "\n";
}
