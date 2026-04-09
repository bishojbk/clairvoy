/**
 * Model Routing Recommendations
 *
 * Analyzes turns in a session and identifies which ones were "simple" enough
 * to use a cheaper model (Sonnet or Haiku instead of Opus).
 *
 * A turn is considered "simple" if:
 * - It had <= 3 tool calls
 * - Output tokens were < 500
 * - No complex patterns (loops, reverts, spirals)
 *
 * RULE: Pure functions only. No CLI deps.
 */

import type { ParsedSession, Turn } from "../types.js";
import { getPricing, calculateCost } from "../constants.js";

export interface ModelRecommendation {
  turnIndex: number;
  currentModel: string;
  recommendedModel: string;
  currentCost: number;
  recommendedCost: number;
  savings: number;
  reason: string;
}

export interface ModelRoutingReport {
  totalTurns: number;
  simpleTurns: number;
  currentTotalCost: number;
  optimizedTotalCost: number;
  potentialSavings: number;
  savingsPercent: number;
  recommendations: ModelRecommendation[];
}

/**
 * Determine if a turn is "simple" — could have used a cheaper model.
 */
function isSimpleTurn(turn: Turn): boolean {
  // Few tool calls
  if (turn.toolCalls.length > 3) return false;

  // Low output
  if (turn.usage.output_tokens > 500) return false;

  // Only basic tools (Read, Grep, Glob, Bash with short commands)
  const complexTools = ["Edit", "Write", "NotebookEdit"];
  const hasComplexTool = turn.toolCalls.some((tc) => complexTools.includes(tc.name));
  if (hasComplexTool) return false;

  return true;
}

/**
 * Determine if a turn is "medium" — could have used Sonnet instead of Opus.
 */
function isMediumTurn(turn: Turn): boolean {
  // Moderate tool calls
  if (turn.toolCalls.length > 8) return false;

  // Moderate output
  if (turn.usage.output_tokens > 2000) return false;

  return true;
}

function turnCost(turn: Turn, model: string): number {
  const pricing = getPricing(model);
  return calculateCost(
    {
      totalInputTokens: turn.usage.input_tokens,
      totalOutputTokens: turn.usage.output_tokens,
      totalCacheCreationTokens: turn.usage.cache_creation_input_tokens || 0,
      totalCacheReadTokens: turn.usage.cache_read_input_tokens || 0,
    },
    pricing,
  );
}

/**
 * Analyze a session and recommend cheaper models for simple turns.
 */
export function analyzeModelRouting(session: ParsedSession): ModelRoutingReport {
  const recommendations: ModelRecommendation[] = [];
  let simpleTurns = 0;
  let currentTotalCost = 0;
  let optimizedTotalCost = 0;

  const isOpus = session.model.includes("opus");
  if (!isOpus) {
    // Already on a cheaper model — no recommendations
    return {
      totalTurns: session.turns.length,
      simpleTurns: 0,
      currentTotalCost: 0,
      optimizedTotalCost: 0,
      potentialSavings: 0,
      savingsPercent: 0,
      recommendations: [],
    };
  }

  for (const turn of session.turns) {
    const current = turnCost(turn, session.model);
    currentTotalCost += current;

    if (isSimpleTurn(turn)) {
      simpleTurns++;
      const haikuCost = turnCost(turn, "claude-haiku-4-5");
      optimizedTotalCost += haikuCost;

      if (current - haikuCost > 0.01) {
        recommendations.push({
          turnIndex: turn.index,
          currentModel: "opus",
          recommendedModel: "haiku",
          currentCost: Math.round(current * 100) / 100,
          recommendedCost: Math.round(haikuCost * 100) / 100,
          savings: Math.round((current - haikuCost) * 100) / 100,
          reason: turn.toolCalls.length === 0
            ? "Text-only response, no tool calls"
            : `Only ${turn.toolCalls.length} simple tool call${turn.toolCalls.length > 1 ? "s" : ""} (${turn.toolCalls.map((t) => t.name).join(", ")})`,
        });
      }
    } else if (isMediumTurn(turn)) {
      const sonnetCost = turnCost(turn, "claude-sonnet-4-6");
      optimizedTotalCost += sonnetCost;

      if (current - sonnetCost > 0.05) {
        recommendations.push({
          turnIndex: turn.index,
          currentModel: "opus",
          recommendedModel: "sonnet",
          currentCost: Math.round(current * 100) / 100,
          recommendedCost: Math.round(sonnetCost * 100) / 100,
          savings: Math.round((current - sonnetCost) * 100) / 100,
          reason: `${turn.toolCalls.length} tool calls, moderate complexity`,
        });
      }
    } else {
      // Complex turn — keep on Opus
      optimizedTotalCost += current;
    }
  }

  // Sort by savings descending, keep top 10
  recommendations.sort((a, b) => b.savings - a.savings);
  const topRecs = recommendations.slice(0, 10);

  const potentialSavings = Math.round((currentTotalCost - optimizedTotalCost) * 100) / 100;
  const savingsPercent = currentTotalCost > 0
    ? Math.round((potentialSavings / currentTotalCost) * 100)
    : 0;

  return {
    totalTurns: session.turns.length,
    simpleTurns,
    currentTotalCost: Math.round(currentTotalCost * 100) / 100,
    optimizedTotalCost: Math.round(optimizedTotalCost * 100) / 100,
    potentialSavings,
    savingsPercent,
    recommendations: topRecs,
  };
}
