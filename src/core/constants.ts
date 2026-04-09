/**
 * Constants for clairvoy.
 *
 * Pricing tables, thresholds, scoring weights — all in one place.
 */

// ---------------------------------------------------------------------------
// Model pricing (per million tokens)
// ---------------------------------------------------------------------------

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

export const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": {
    inputPerMillion: 5.0,
    outputPerMillion: 25.0,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 6.25,
  },
  "claude-sonnet-4-6": {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  "claude-haiku-4-5": {
    inputPerMillion: 1.0,
    outputPerMillion: 5.0,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
  },
};

/**
 * Look up pricing for a model string. Falls back to Sonnet pricing.
 */
export function getPricing(model: string): ModelPricing {
  if (PRICING[model]) return PRICING[model];
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key) || model.includes(key.split("-").slice(0, -1).join("-"))) {
      return pricing;
    }
  }
  return PRICING["claude-sonnet-4-6"];
}

/**
 * Calculate dollar cost from token usage and pricing.
 */
export function calculateCost(
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
  },
  pricing: ModelPricing,
): number {
  const inputCost = (usage.totalInputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.totalOutputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost = (usage.totalCacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion;
  const cacheReadCost = (usage.totalCacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

// ---------------------------------------------------------------------------
// Scoring weights and thresholds
// ---------------------------------------------------------------------------

export const SCORING_WEIGHTS = {
  cacheEfficiency: 0.25,
  outputConciseness: 0.25,
  toolEfficiency: 0.20,
  compoundingControl: 0.15,
  patternCleanliness: 0.15,
} as const;

export const GRADE_THRESHOLDS = {
  S: 90,
  A: 80,
  B: 70,
  C: 60,
  D: 50,
  F: 0,
} as const;

// ---------------------------------------------------------------------------
// Waste detection thresholds
// ---------------------------------------------------------------------------

export const WASTE_THRESHOLDS = {
  sycophancyWarning: 100,
  sycophancyHigh: 500,
  suggestionWarning: 200,
  suggestionHigh: 1000,
  metaCommentaryWarning: 200,
  fileReReadWarning: 1000,
  fileReReadHigh: 5000,
} as const;

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Rough token estimate: ~4 characters per token for English text.
 * Used for content where we don't have exact counts from the API.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
