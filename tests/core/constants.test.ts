import { describe, it, expect } from "vitest";
import { getPricing, calculateCost, estimateTokens, PRICING } from "../../src/core/constants.js";

describe("getPricing", () => {
  it("returns exact match pricing", () => {
    const pricing = getPricing("claude-sonnet-4-6");
    expect(pricing.inputPerMillion).toBe(3.0);
    expect(pricing.outputPerMillion).toBe(15.0);
  });

  it("returns Opus pricing", () => {
    const pricing = getPricing("claude-opus-4-6");
    expect(pricing.inputPerMillion).toBe(5.0);
  });

  it("falls back to Sonnet for unknown models", () => {
    const pricing = getPricing("unknown-model-xyz");
    expect(pricing).toEqual(PRICING["claude-sonnet-4-6"]);
  });
});

describe("calculateCost", () => {
  it("calculates cost correctly", () => {
    const usage = {
      totalInputTokens: 1_000_000,
      totalOutputTokens: 100_000,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
    };
    const pricing = getPricing("claude-sonnet-4-6");
    const cost = calculateCost(usage, pricing);
    // 1M input * $3/M + 100K output * $15/M = $3 + $1.50 = $4.50
    expect(cost).toBeCloseTo(4.5, 1);
  });

  it("includes cache costs", () => {
    const usage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 1_000_000,
      totalCacheReadTokens: 1_000_000,
    };
    const pricing = getPricing("claude-sonnet-4-6");
    const cost = calculateCost(usage, pricing);
    // 1M cache_write * $3.75/M + 1M cache_read * $0.30/M = $3.75 + $0.30 = $4.05
    expect(cost).toBeCloseTo(4.05, 1);
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 -> ceil -> 3
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
  });
});
