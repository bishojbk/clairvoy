import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSessionFromString } from "../../src/core/parser/session-parser.js";
import { classifySession } from "../../src/core/analysis/classifier.js";

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("classifySession", () => {
  const content = loadFixture("minimal-session.jsonl");
  const session = parseSessionFromString(content, "test-session-001.jsonl");
  const breakdown = classifySession(session);

  it("returns a valid TokenBreakdown", () => {
    expect(breakdown.session).toBe(session);
    expect(breakdown.totalCostDollars).toBeGreaterThan(0);
    expect(breakdown.categories.length).toBeGreaterThan(0);
  });

  it("calculates total cost in dollars", () => {
    // Sonnet pricing: input=$3/M, output=$15/M, cache_read=$0.30/M, cache_write=$3.75/M
    expect(breakdown.totalCostDollars).toBeGreaterThan(0);
    expect(breakdown.totalCostDollars).toBeLessThan(10); // sanity check
  });

  it("detects sycophancy", () => {
    // Fixture has "Great question!" in assistant response
    const sycophancyCat = breakdown.categories.find((c) => c.name === "Sycophancy");
    expect(sycophancyCat).toBeDefined();
    expect(sycophancyCat!.tokens).toBeGreaterThan(0);
  });

  it("detects unsolicited suggestions", () => {
    // Fixture has "You might also want to consider..."
    const suggestionCat = breakdown.categories.find((c) => c.name === "Unsolicited Suggestions");
    expect(suggestionCat).toBeDefined();
    expect(suggestionCat!.tokens).toBeGreaterThan(0);
  });

  it("detects meta-commentary", () => {
    // Fixture has "Let me take a look at..."
    const metaCat = breakdown.categories.find((c) => c.name === "Meta-commentary");
    expect(metaCat).toBeDefined();
    expect(metaCat!.tokens).toBeGreaterThan(0);
  });

  it("categories are sorted by token count descending", () => {
    for (let i = 1; i < breakdown.categories.length; i++) {
      expect(breakdown.categories[i - 1].tokens).toBeGreaterThanOrEqual(
        breakdown.categories[i].tokens,
      );
    }
  });

  it("has no zero-token categories", () => {
    for (const cat of breakdown.categories) {
      expect(cat.tokens).toBeGreaterThan(0);
    }
  });

  it("calculates estimated savings", () => {
    expect(breakdown.estimatedSavingsPercent).toBeGreaterThanOrEqual(0);
    expect(breakdown.estimatedSavingsDollars).toBeGreaterThanOrEqual(0);
  });

  it("warnings are sorted by severity", () => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < breakdown.warnings.length; i++) {
      expect(severityOrder[breakdown.warnings[i - 1].severity]).toBeLessThanOrEqual(
        severityOrder[breakdown.warnings[i].severity],
      );
    }
  });
});
