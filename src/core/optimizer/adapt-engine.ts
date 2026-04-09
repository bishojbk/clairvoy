/**
 * Adaptation Engine
 *
 * Compares sessions before and after CLAUDE.md installation to measure
 * which rules are working, which are not, and generates an updated ruleset.
 *
 * Features:
 * - Per-rule effectiveness scoring with confidence levels
 * - Automatic rule promotion/demotion based on measured impact
 * - New waste pattern detection for emerging issues
 * - Tracks diminishing returns to avoid over-optimization
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type {
  ParsedSession,
  TokenBreakdown,
  SessionScore,
  AdaptationReport,
  AdaptMetrics,
  AdaptProof,
} from "../types.js";
import { estimateTokens } from "../constants.js";
import { RULE_CATALOG } from "./rule-catalog.js";

// ---------------------------------------------------------------------------
// Types for the session data passed in
// ---------------------------------------------------------------------------

interface SessionData {
  parsed: ParsedSession;
  breakdown: TokenBreakdown;
  score: SessionScore;
}

interface RuleEffectiveness {
  ruleId: string;
  ruleName: string;
  wasteCategory: string;
  beforeAvg: number;
  afterAvg: number;
  reductionPercent: number;
  confidence: "high" | "medium" | "low";
  verdict: "effective" | "ineffective" | "inconclusive" | "counterproductive";
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

function computeMetrics(sessions: SessionData[]): AdaptMetrics {
  if (sessions.length === 0) {
    return { avgCostPerSession: 0, avgWastePercent: 0, avgScore: 0, avgTurns: 0 };
  }

  const totalCost = sessions.reduce((s, d) => s + d.breakdown.totalCostDollars, 0);
  const totalWaste = sessions.reduce((s, d) => s + d.breakdown.estimatedSavingsPercent, 0);
  const totalScore = sessions.reduce((s, d) => s + d.score.numericScore, 0);
  const totalTurns = sessions.reduce((s, d) => s + d.parsed.totalUsage.turnCount, 0);
  const n = sessions.length;

  return {
    avgCostPerSession: round2(totalCost / n),
    avgWastePercent: round2(totalWaste / n),
    avgScore: round2(totalScore / n),
    avgTurns: round2(totalTurns / n),
  };
}

// ---------------------------------------------------------------------------
// Waste category extraction (expanded)
// ---------------------------------------------------------------------------

interface WasteProfile {
  sycophancy: number;
  metaCommentary: number;
  suggestions: number;
  fileReReads: number;
  verboseOutput: number;
  codeEchoing: number;
}

function getWasteProfile(sessions: SessionData[]): WasteProfile {
  const profile: WasteProfile = {
    sycophancy: 0,
    metaCommentary: 0,
    suggestions: 0,
    fileReReads: 0,
    verboseOutput: 0,
    codeEchoing: 0,
  };

  if (sessions.length === 0) return profile;

  for (const s of sessions) {
    for (const cat of s.breakdown.categories) {
      if (cat.name === "Sycophancy") profile.sycophancy += cat.tokens;
      if (cat.name === "Meta-commentary") profile.metaCommentary += cat.tokens;
      if (cat.name === "Unsolicited Suggestions") profile.suggestions += cat.tokens;
      if (cat.name === "File Re-reads (waste)") profile.fileReReads += cat.tokens;
      if (cat.name === "Text Explanations") profile.verboseOutput += cat.tokens;
      if (cat.name === "Code Echoing (waste)") profile.codeEchoing += cat.tokens;
    }
  }

  // Normalize per session
  const n = sessions.length;
  profile.sycophancy = round2(profile.sycophancy / n);
  profile.metaCommentary = round2(profile.metaCommentary / n);
  profile.suggestions = round2(profile.suggestions / n);
  profile.fileReReads = round2(profile.fileReReads / n);
  profile.verboseOutput = round2(profile.verboseOutput / n);
  profile.codeEchoing = round2(profile.codeEchoing / n);

  return profile;
}

// ---------------------------------------------------------------------------
// Per-rule effectiveness scoring
// ---------------------------------------------------------------------------

function scoreRuleEffectiveness(
  beforeProfile: WasteProfile,
  afterProfile: WasteProfile,
  sessionCountBefore: number,
  sessionCountAfter: number,
): RuleEffectiveness[] {
  const results: RuleEffectiveness[] = [];

  const wasteToRule: Array<{ waste: keyof WasteProfile; ruleId: string; ruleName: string }> = [
    { waste: "sycophancy", ruleId: "no-sycophancy", ruleName: "No sycophantic openers" },
    { waste: "metaCommentary", ruleId: "no-meta-commentary", ruleName: "No meta-commentary" },
    { waste: "suggestions", ruleId: "no-unsolicited-suggestions", ruleName: "No unsolicited suggestions" },
    { waste: "fileReReads", ruleId: "track-file-reads", ruleName: "Track file reads" },
    { waste: "verboseOutput", ruleId: "concise-output", ruleName: "Prefer code over explanation" },
    { waste: "codeEchoing", ruleId: "no-echoing-code", ruleName: "Don't echo back code" },
  ];

  for (const mapping of wasteToRule) {
    const before = beforeProfile[mapping.waste];
    const after = afterProfile[mapping.waste];

    if (before === 0 && after === 0) continue;

    const reductionPercent = before > 0 ? round2(((before - after) / before) * 100) : 0;

    // Determine confidence based on sample size
    const minSessions = Math.min(sessionCountBefore, sessionCountAfter);
    const confidence: "high" | "medium" | "low" =
      minSessions >= 10 ? "high" :
      minSessions >= 5 ? "medium" : "low";

    // Determine verdict
    let verdict: "effective" | "ineffective" | "inconclusive" | "counterproductive";
    if (before === 0 && after > 0) {
      verdict = "counterproductive"; // New waste appeared
    } else if (reductionPercent >= 30) {
      verdict = "effective";
    } else if (reductionPercent <= -10) {
      verdict = "counterproductive"; // Waste actually increased
    } else if (reductionPercent >= 10) {
      verdict = confidence === "low" ? "inconclusive" : "effective";
    } else {
      verdict = "ineffective";
    }

    results.push({
      ruleId: mapping.ruleId,
      ruleName: mapping.ruleName,
      wasteCategory: mapping.waste,
      beforeAvg: before,
      afterAvg: after,
      reductionPercent,
      confidence,
      verdict,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Rule decisions based on effectiveness
// ---------------------------------------------------------------------------

interface RuleDecision {
  kept: string[];
  removed: Array<{ name: string; reason: string }>;
  added: string[];
}

function evaluateRules(
  effectiveness: RuleEffectiveness[],
  beforeProfile: WasteProfile,
  afterProfile: WasteProfile,
): RuleDecision {
  const kept: string[] = [];
  const removed: Array<{ name: string; reason: string }> = [];
  const added: string[] = [];

  for (const eff of effectiveness) {
    switch (eff.verdict) {
      case "effective":
        kept.push(eff.ruleName);
        break;
      case "ineffective":
        removed.push({
          name: eff.ruleName,
          reason: `${eff.wasteCategory} reduced only ${eff.reductionPercent}% (before: ${eff.beforeAvg}, after: ${eff.afterAvg})`,
        });
        break;
      case "counterproductive":
        removed.push({
          name: eff.ruleName,
          reason: `${eff.wasteCategory} waste ${eff.beforeAvg === 0 ? "appeared after install" : `increased by ${Math.abs(eff.reductionPercent)}%`}`,
        });
        break;
      case "inconclusive":
        // Keep inconclusive rules — give them more time
        kept.push(eff.ruleName);
        break;
    }
  }

  // Check for new waste patterns not covered by existing rules
  const newWasteThreshold = 100; // tokens per session average
  const coveredCategories = new Set(effectiveness.map((e) => e.wasteCategory));

  if (!coveredCategories.has("codeEchoing") && afterProfile.codeEchoing > newWasteThreshold) {
    added.push("Don't echo back code");
  }
  if (!coveredCategories.has("verboseOutput") && afterProfile.verboseOutput > newWasteThreshold * 5) {
    // Check if any verbose-output rules are in the catalog but not active
    const verboseRules = RULE_CATALOG.filter(
      (r) => r.targetPattern === "verbose-output" && !kept.includes(r.name) && !added.includes(r.name),
    );
    for (const rule of verboseRules.slice(0, 2)) {
      added.push(rule.name);
    }
  }

  return { kept, removed, added };
}

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

function generateUpdatedClaudeMd(
  keptNames: string[],
  addedNames: string[],
): string {
  const allNames = new Set([...keptNames, ...addedNames]);
  const rules = RULE_CATALOG.filter((r) => allNames.has(r.name));

  if (rules.length === 0) {
    return "# Rules\n\n<!-- Generated by clairvoy -- no optimization rules needed -->\n\nYour sessions are already efficient.\n";
  }

  const lines: string[] = [];
  lines.push("# Rules");
  lines.push("");
  lines.push("<!-- Generated by clairvoy based on your actual session data (adapted) -->");
  lines.push(`<!-- Last adapted: ${new Date().toISOString().split("T")[0]} -->`);
  lines.push("");

  // Group: kept rules first, then newly added
  const keptRules = rules.filter((r) => keptNames.includes(r.name));
  const addedRules = rules.filter((r) => addedNames.includes(r.name));

  for (const rule of keptRules) {
    lines.push(rule.claudeMdSnippet);
  }

  if (addedRules.length > 0) {
    lines.push("");
    lines.push("<!-- New rules added based on emerging waste patterns -->");
    for (const rule of addedRules) {
      lines.push(rule.claudeMdSnippet);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Analyze sessions before and after CLAUDE.md installation and produce
 * an adaptation report with proof of what worked and an updated ruleset.
 */
export function generateAdaptation(
  installedAt: string,
  beforeSessions: SessionData[],
  afterSessions: SessionData[],
): AdaptationReport {
  const beforeMetrics = computeMetrics(beforeSessions);
  const afterMetrics = computeMetrics(afterSessions);

  // Build proof array
  const proof: AdaptProof[] = [];

  const addProof = (metric: string, before: number, after: number, unit: string) => {
    const diff = after - before;
    const pctChange = before !== 0 ? (diff / before) * 100 : 0;
    const sign = diff >= 0 ? "+" : "";
    proof.push({
      metric,
      before: round2(before),
      after: round2(after),
      change: `${sign}${round2(diff)} ${unit} (${sign}${Math.round(pctChange)}%)`,
      improved: metric === "Score"
        ? after > before
        : after < before, // For cost/waste/turns, lower is better
    });
  };

  addProof("Avg cost/session", beforeMetrics.avgCostPerSession, afterMetrics.avgCostPerSession, "$");
  addProof("Avg waste %", beforeMetrics.avgWastePercent, afterMetrics.avgWastePercent, "%");
  addProof("Score", beforeMetrics.avgScore, afterMetrics.avgScore, "pts");
  addProof("Avg turns", beforeMetrics.avgTurns, afterMetrics.avgTurns, "turns");

  // Score individual rule effectiveness
  const beforeProfile = getWasteProfile(beforeSessions);
  const afterProfile = getWasteProfile(afterSessions);
  const effectiveness = scoreRuleEffectiveness(
    beforeProfile,
    afterProfile,
    beforeSessions.length,
    afterSessions.length,
  );

  // Make rule decisions based on effectiveness scores
  const decisions = evaluateRules(effectiveness, beforeProfile, afterProfile);

  // Generate updated CLAUDE.md
  const updatedClaudeMdContent = generateUpdatedClaudeMd(decisions.kept, decisions.added);

  return {
    installedAt,
    sessionsBeforeCount: beforeSessions.length,
    sessionsAfterCount: afterSessions.length,
    beforeMetrics,
    afterMetrics,
    rulesKept: decisions.kept,
    rulesRemoved: decisions.removed,
    rulesAdded: decisions.added,
    updatedClaudeMdContent,
    proof,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
