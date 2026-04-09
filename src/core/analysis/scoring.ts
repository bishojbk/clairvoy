/**
 * Efficiency Scoring Engine
 *
 * Grades sessions S/A/B/C/D/F across five dimensions:
 *   1. Cache Efficiency (25%)
 *   2. Output Conciseness (25%)
 *   3. Tool Efficiency (20%)
 *   4. Compounding Control (15%)
 *   5. Pattern Cleanliness (15%)
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type {
  ParsedSession,
  TokenBreakdown,
  SessionScore,
  ScoreDimension,
  Achievement,
  EfficiencyGrade,
} from "../types.js";
import { SCORING_WEIGHTS, GRADE_THRESHOLDS } from "../constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a numeric score (0-100) to a letter grade.
 */
function toGrade(score: number): EfficiencyGrade {
  if (score >= GRADE_THRESHOLDS.S) return "S";
  if (score >= GRADE_THRESHOLDS.A) return "A";
  if (score >= GRADE_THRESHOLDS.B) return "B";
  if (score >= GRADE_THRESHOLDS.C) return "C";
  if (score >= GRADE_THRESHOLDS.D) return "D";
  return "F";
}

/**
 * Linear interpolation between min and max, clamped to 0-100.
 * Returns 0 when value <= min, 100 when value >= max.
 */
function linearScore(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 100;
  return Math.round(((value - min) / (max - min)) * 100);
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

/**
 * Dimension 1: Cache Efficiency (25%)
 *
 * cache_read_tokens / (cache_read + cache_write + input)
 * Score: 100 if >90%, 0 if <40%, linear between.
 */
function scoreCacheEfficiency(session: ParsedSession): number {
  const { totalCacheReadTokens, totalCacheCreationTokens, totalInputTokens } =
    session.totalUsage;

  const denominator =
    totalCacheReadTokens + totalCacheCreationTokens + totalInputTokens;

  if (denominator === 0) return 0;

  const ratio = totalCacheReadTokens / denominator;
  return linearScore(ratio, 0.4, 0.9);
}

/**
 * Dimension 2: Output Conciseness (25%)
 *
 * useful_output = (Code Output + Text Explanations) /
 *                 (Code Output + Text + Sycophancy + Suggestions + Meta-commentary)
 * Score: 100 if >95%, 0 if <50%, linear between.
 * If no waste categories exist, score is 100.
 */
function scoreOutputConciseness(breakdown: TokenBreakdown): number {
  const categoryTokens = (name: string): number => {
    const cat = breakdown.categories.find((c) => c.name === name);
    return cat ? cat.tokens : 0;
  };

  const codeOutput = categoryTokens("Code Output");
  const textExplanations = categoryTokens("Text Explanations");
  const sycophancy = categoryTokens("Sycophancy");
  const suggestions = categoryTokens("Unsolicited Suggestions");
  const metaCommentary = categoryTokens("Meta-commentary");

  const useful = codeOutput + textExplanations;
  const total = useful + sycophancy + suggestions + metaCommentary;

  // If there are no waste categories, score is 100
  if (sycophancy + suggestions + metaCommentary === 0) return 100;

  if (total === 0) return 100;

  const ratio = useful / total;
  return linearScore(ratio, 0.5, 0.95);
}

/**
 * Dimension 3: Tool Efficiency (20%)
 *
 * Track unique tool calls (name + file_path combo) vs total tool calls.
 * Score: 100 if >85% unique, 0 if <40%, linear between.
 */
function scoreToolEfficiency(session: ParsedSession): number {
  const allToolCalls: Array<{ name: string; key: string }> = [];

  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      const filePath =
        typeof tc.input.file_path === "string" ? tc.input.file_path : "";
      const key = `${tc.name}::${filePath}`;
      allToolCalls.push({ name: tc.name, key });
    }
  }

  if (allToolCalls.length === 0) return 100;

  const uniqueKeys = new Set(allToolCalls.map((t) => t.key));
  const uniqueRatio = uniqueKeys.size / allToolCalls.length;

  return linearScore(uniqueRatio, 0.4, 0.85);
}

/**
 * Dimension 4: Compounding Control (15%)
 *
 * Average context growth per turn.
 * context = cache_read + cache_write + input from turn.usage
 * Score: 100 if <500 tokens/turn growth, 0 if >5000, linear (inverted).
 */
function scoreCompoundingControl(session: ParsedSession): number {
  const turns = session.turns;

  if (turns.length <= 1) return 100;

  const turnContext = (t: (typeof turns)[number]): number => {
    const u = t.usage;
    return (
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      u.input_tokens
    );
  };

  const firstContext = turnContext(turns[0]);
  const lastContext = turnContext(turns[turns.length - 1]);

  const avgGrowth = (lastContext - firstContext) / turns.length;

  // Inverted: lower growth is better
  // 100 if avgGrowth <= 500, 0 if avgGrowth >= 5000
  if (avgGrowth <= 500) return 100;
  if (avgGrowth >= 5000) return 0;
  return Math.round(((5000 - avgGrowth) / (5000 - 500)) * 100);
}

/**
 * Dimension 5: Pattern Cleanliness (15%)
 *
 * Based on warnings count from TokenBreakdown.
 * 100 if 0 warnings, 80 if 1-2, 60 if 3-5, 40 if 6-10, 20 if >10.
 */
function scorePatternCleanliness(breakdown: TokenBreakdown): number {
  const count = breakdown.warnings.length;

  if (count === 0) return 100;
  if (count <= 2) return 80;
  if (count <= 5) return 60;
  if (count <= 10) return 40;
  return 20;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

function checkAchievements(
  session: ParsedSession,
  breakdown: TokenBreakdown,
  toolUniqueRatio: number,
  totalToolCalls: number,
): Achievement[] {
  // Cache hit rate for cache_master
  const { totalCacheReadTokens, totalCacheCreationTokens, totalInputTokens } =
    session.totalUsage;
  const cacheDenom =
    totalCacheReadTokens + totalCacheCreationTokens + totalInputTokens;
  const cacheHitRate = cacheDenom > 0 ? totalCacheReadTokens / cacheDenom : 0;

  // Sycophancy and meta tokens for concise_claude
  const categoryTokens = (name: string): number => {
    const cat = breakdown.categories.find((c) => c.name === name);
    return cat ? cat.tokens : 0;
  };
  const sycophancyTokens = categoryTokens("Sycophancy");
  const metaTokens = categoryTokens("Meta-commentary");

  // Session duration for speed_demon
  const durationMs =
    session.startTime && session.endTime
      ? new Date(session.endTime).getTime() -
        new Date(session.startTime).getTime()
      : Infinity;
  const fiveMinutesMs = 5 * 60 * 1000;

  return [
    {
      id: "cache_master",
      name: "Cache Master",
      description: "95%+ cache hit rate",
      unlocked: cacheHitRate > 0.95,
      progress: Math.round(cacheHitRate * 100),
    },
    {
      id: "one_shot",
      name: "One Shot",
      description: "Session completed in a single turn",
      unlocked: session.turns.length === 1,
      progress: session.turns.length === 1 ? 100 : 0,
    },
    {
      id: "concise_claude",
      name: "Concise Claude",
      description: "Zero sycophancy and meta-commentary tokens",
      unlocked: sycophancyTokens === 0 && metaTokens === 0,
    },
    {
      id: "tool_ninja",
      name: "Tool Ninja",
      description: "85%+ unique tool calls in a session with 20+ tool calls",
      unlocked: totalToolCalls >= 20 && toolUniqueRatio > 0.85,
      progress:
        totalToolCalls >= 20 ? Math.round(toolUniqueRatio * 100) : undefined,
    },
    {
      id: "speed_demon",
      name: "Speed Demon",
      description: "Session completed in under 5 minutes",
      unlocked: durationMs < fiveMinutesMs && durationMs > 0,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export function scoreSession(
  session: ParsedSession,
  breakdown: TokenBreakdown,
): SessionScore {
  // Score each dimension
  const cacheScore = scoreCacheEfficiency(session);
  const concisenessScore = scoreOutputConciseness(breakdown);
  const toolScore = scoreToolEfficiency(session);
  const compoundingScore = scoreCompoundingControl(session);
  const cleanlinessScore = scorePatternCleanliness(breakdown);

  // Build dimension array
  const dimensions: ScoreDimension[] = [
    {
      name: "Cache efficiency",
      score: cacheScore,
      grade: toGrade(cacheScore),
      weight: SCORING_WEIGHTS.cacheEfficiency,
      description: "How well the session leveraged prompt caching",
    },
    {
      name: "Output conciseness",
      score: concisenessScore,
      grade: toGrade(concisenessScore),
      weight: SCORING_WEIGHTS.outputConciseness,
      description: "Ratio of useful output vs filler content",
    },
    {
      name: "Tool efficiency",
      score: toolScore,
      grade: toGrade(toolScore),
      weight: SCORING_WEIGHTS.toolEfficiency,
      description: "Unique tool calls vs redundant re-invocations",
    },
    {
      name: "Compounding control",
      score: compoundingScore,
      grade: toGrade(compoundingScore),
      weight: SCORING_WEIGHTS.compoundingControl,
      description: "How well context growth was controlled across turns",
    },
    {
      name: "Pattern cleanliness",
      score: cleanlinessScore,
      grade: toGrade(cleanlinessScore),
      weight: SCORING_WEIGHTS.patternCleanliness,
      description: "Absence of wasteful patterns and anti-patterns",
    },
  ];

  // Weighted overall score
  const numericScore = Math.round(
    cacheScore * SCORING_WEIGHTS.cacheEfficiency +
      concisenessScore * SCORING_WEIGHTS.outputConciseness +
      toolScore * SCORING_WEIGHTS.toolEfficiency +
      compoundingScore * SCORING_WEIGHTS.compoundingControl +
      cleanlinessScore * SCORING_WEIGHTS.patternCleanliness,
  );

  const overall = toGrade(numericScore);

  // Calculate tool unique ratio for achievements
  let totalToolCalls = 0;
  const toolKeys = new Set<string>();
  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      totalToolCalls++;
      const filePath =
        typeof tc.input.file_path === "string" ? tc.input.file_path : "";
      toolKeys.add(`${tc.name}::${filePath}`);
    }
  }
  const toolUniqueRatio =
    totalToolCalls > 0 ? toolKeys.size / totalToolCalls : 1;

  const achievements = checkAchievements(
    session,
    breakdown,
    toolUniqueRatio,
    totalToolCalls,
  );

  return {
    overall,
    numericScore,
    dimensions,
    achievements,
  };
}
