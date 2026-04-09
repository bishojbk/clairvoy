/**
 * Prompt Analyzer
 *
 * Analyzes user prompts within a session and correlates prompt specificity
 * with cost and tool usage outcomes. Produces coaching suggestions.
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type {
  ParsedSession,
  CoachingReport,
  PromptAnalysis,
  SpecificityScore,
  PromptOutcome,
  PromptCorrelation,
  TokenUsage,
} from "../types.js";
import { getPricing, calculateCost } from "../constants.js";

// ---------------------------------------------------------------------------
// Regex patterns for specificity scoring
// ---------------------------------------------------------------------------

const FILE_PATH_RE = /(?:\.{0,2}\/)?[\w@.\/-]+\.[\w]{1,10}/;
const LINE_NUMBER_RE = /(?:line\s*|L|:)\d+/i;
const FUNCTION_NAME_RE = /(?:function|class|def|const|let|var|export)\s+\w+|`\w+`/;
const ERROR_MSG_RE = /error|exception|failed|TypeError|null|undefined|crash|bug/i;

const IMPERATIVE_VERBS = new Set([
  "fix", "add", "update", "remove", "change", "create", "implement",
  "refactor", "move", "rename", "delete", "run", "test", "check", "build",
]);

// ---------------------------------------------------------------------------
// Specificity scoring
// ---------------------------------------------------------------------------

function scoreSpecificity(text: string): SpecificityScore {
  const hasFilePaths = FILE_PATH_RE.test(text);
  const hasLineNumbers = LINE_NUMBER_RE.test(text);
  const hasFunctionNames = FUNCTION_NAME_RE.test(text);
  const hasErrorMessages = ERROR_MSG_RE.test(text);
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

  const firstWord = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const isImperative = IMPERATIVE_VERBS.has(firstWord);

  let overall = 0;
  if (hasFilePaths) overall += 25;
  if (hasLineNumbers) overall += 20;
  if (hasFunctionNames) overall += 15;
  if (hasErrorMessages) overall += 10;
  if (wordCount > 8) overall += 10;
  if (isImperative) overall += 10;

  // Extra points for long, detailed prompts
  if (wordCount > 20) overall += 10;

  overall = Math.min(overall, 100);

  return {
    overall,
    hasFilePaths,
    hasLineNumbers,
    hasFunctionNames,
    hasErrorMessages,
    wordCount,
    isImperative,
  };
}

// ---------------------------------------------------------------------------
// Outcome measurement
// ---------------------------------------------------------------------------

function measureOutcome(
  turn: ParsedSession["turns"][number],
  sessionFilesRead: Set<string>,
  pricing: ReturnType<typeof getPricing>,
): { outcome: PromptOutcome; newFilesRead: string[] } {
  const toolCallsTriggered = turn.toolCalls.length;
  const searchToolCalls = turn.toolCalls.filter(
    (tc) => tc.name === "Grep" || tc.name === "Glob",
  ).length;

  // turnsToComplete: use toolCalls.length + 1 as a proxy
  const turnsToComplete = toolCallsTriggered + 1;

  // Calculate cost from turn usage
  const usage = turn.usage;
  const costUsage = {
    totalInputTokens: usage.input_tokens,
    totalOutputTokens: usage.output_tokens,
    totalCacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    totalCacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
  const costDollars = calculateCost(costUsage, pricing);

  // Detect waste: any Read tool call where the file was already read in this session
  const newFilesRead: string[] = [];
  let wasteDetected = false;
  for (const tc of turn.toolCalls) {
    if (tc.name === "Read" && typeof tc.input.file_path === "string") {
      const fp = tc.input.file_path;
      if (sessionFilesRead.has(fp)) {
        wasteDetected = true;
      }
      newFilesRead.push(fp);
    }
  }

  return {
    outcome: {
      turnsToComplete,
      toolCallsTriggered,
      searchToolCalls,
      costDollars: Math.round(costDollars * 10000) / 10000,
      wasteDetected,
    },
    newFilesRead,
  };
}

// ---------------------------------------------------------------------------
// Suggestion generation
// ---------------------------------------------------------------------------

function generateSuggestion(
  specificity: SpecificityScore,
  outcome: PromptOutcome,
  avgCost: number,
  turn: ParsedSession["turns"][number],
): string | undefined {
  if (specificity.overall >= 30 || outcome.costDollars <= avgCost * 2) {
    return undefined;
  }

  // If no file paths in prompt but Read/Grep tools were used
  if (!specificity.hasFilePaths) {
    const readCalls = turn.toolCalls.filter(
      (tc) => tc.name === "Read" || tc.name === "Grep",
    );
    if (readCalls.length > 0) {
      const firstFile =
        typeof readCalls[0].input.file_path === "string"
          ? readCalls[0].input.file_path
          : typeof readCalls[0].input.path === "string"
            ? readCalls[0].input.path
            : null;
      if (firstFile) {
        const shortPath = firstFile.split("/").slice(-2).join("/");
        return `Include file path: mention ${shortPath} directly`;
      }
    }
  }

  if (specificity.wordCount < 5) {
    return "Be more specific -- include what to change and where";
  }

  return "Add more context: file paths, function names, or error messages";
}

// ---------------------------------------------------------------------------
// Correlation computation
// ---------------------------------------------------------------------------

function computeCorrelations(prompts: PromptAnalysis[]): PromptCorrelation[] {
  if (prompts.length < 2) return [];

  const correlations: PromptCorrelation[] = [];

  // File paths correlation
  const withPaths = prompts.filter((p) => p.specificity.hasFilePaths);
  const withoutPaths = prompts.filter((p) => !p.specificity.hasFilePaths);
  if (withPaths.length > 0 && withoutPaths.length > 0) {
    const avgWith = avg(withPaths.map((p) => p.outcome.costDollars));
    const avgWithout = avg(withoutPaths.map((p) => p.outcome.costDollars));
    const pctChange = avgWithout > 0 ? ((avgWithout - avgWith) / avgWithout) * 100 : 0;
    correlations.push({
      factor: "File paths in prompt",
      avgCostWith: round4(avgWith),
      avgCostWithout: round4(avgWithout),
      improvement: `${pctChange >= 0 ? "-" : "+"}${Math.abs(Math.round(pctChange))}%`,
    });
  }

  // Line numbers correlation
  const withLines = prompts.filter((p) => p.specificity.hasLineNumbers);
  const withoutLines = prompts.filter((p) => !p.specificity.hasLineNumbers);
  if (withLines.length > 0 && withoutLines.length > 0) {
    const avgWith = avg(withLines.map((p) => p.outcome.costDollars));
    const avgWithout = avg(withoutLines.map((p) => p.outcome.costDollars));
    const pctChange = avgWithout > 0 ? ((avgWithout - avgWith) / avgWithout) * 100 : 0;
    correlations.push({
      factor: "Line numbers in prompt",
      avgCostWith: round4(avgWith),
      avgCostWithout: round4(avgWithout),
      improvement: `${pctChange >= 0 ? "-" : "+"}${Math.abs(Math.round(pctChange))}%`,
    });
  }

  // Word count > 8 correlation
  const longPrompts = prompts.filter((p) => p.specificity.wordCount > 8);
  const shortPrompts = prompts.filter((p) => p.specificity.wordCount <= 8);
  if (longPrompts.length > 0 && shortPrompts.length > 0) {
    const avgWith = avg(longPrompts.map((p) => p.outcome.costDollars));
    const avgWithout = avg(shortPrompts.map((p) => p.outcome.costDollars));
    const pctChange = avgWithout > 0 ? ((avgWithout - avgWith) / avgWithout) * 100 : 0;
    correlations.push({
      factor: "10+ word prompts",
      avgCostWith: round4(avgWith),
      avgCostWithout: round4(avgWithout),
      improvement: `${pctChange >= 0 ? "-" : "+"}${Math.abs(Math.round(pctChange))}%`,
    });
  }

  // Imperative form correlation
  const imperative = prompts.filter((p) => p.specificity.isImperative);
  const nonImperative = prompts.filter((p) => !p.specificity.isImperative);
  if (imperative.length > 0 && nonImperative.length > 0) {
    const avgWith = avg(imperative.map((p) => p.outcome.costDollars));
    const avgWithout = avg(nonImperative.map((p) => p.outcome.costDollars));
    const pctChange = avgWithout > 0 ? ((avgWithout - avgWith) / avgWithout) * 100 : 0;
    correlations.push({
      factor: "Imperative form",
      avgCostWith: round4(avgWith),
      avgCostWithout: round4(avgWithout),
      improvement: `${pctChange >= 0 ? "-" : "+"}${Math.abs(Math.round(pctChange))}%`,
    });
  }

  return correlations;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Analyze all user prompts in a session and produce a coaching report.
 */
export function analyzePrompts(session: ParsedSession): CoachingReport {
  const pricing = getPricing(session.model);
  const prompts: PromptAnalysis[] = [];
  const filesReadInSession = new Set<string>();

  // First pass: build all prompt analyses
  for (const turn of session.turns) {
    if (!turn.userMessage.trim()) continue;

    const specificity = scoreSpecificity(turn.userMessage);
    const { outcome, newFilesRead } = measureOutcome(
      turn,
      filesReadInSession,
      pricing,
    );

    // Track files read so far for waste detection in subsequent turns
    for (const f of newFilesRead) {
      filesReadInSession.add(f);
    }

    prompts.push({
      turnIndex: turn.index,
      promptText: turn.userMessage,
      specificity,
      outcome,
    });
  }

  // Compute average cost for suggestion thresholds
  const avgCost = prompts.length > 0
    ? avg(prompts.map((p) => p.outcome.costDollars))
    : 0;

  // Second pass: generate suggestions for low-specificity, high-cost prompts
  for (const pa of prompts) {
    const turn = session.turns.find((t) => t.index === pa.turnIndex);
    if (turn) {
      pa.suggestion = generateSuggestion(pa.specificity, pa.outcome, avgCost, turn);
    }
  }

  // Compute correlations
  const correlations = computeCorrelations(prompts);

  // Average specificity
  const averageSpecificity = prompts.length > 0
    ? Math.round(avg(prompts.map((p) => p.specificity.overall)))
    : 0;

  // Best prompt: highest specificity with lowest cost
  // Score: specificity / (1 + costDollars) -- higher is better
  let bestPrompt: PromptAnalysis | null = null;
  let bestScore = -1;
  for (const p of prompts) {
    const score = p.specificity.overall / (1 + p.outcome.costDollars);
    if (score > bestScore) {
      bestScore = score;
      bestPrompt = p;
    }
  }

  // Worst prompt: lowest specificity with highest cost
  // Score: costDollars / (1 + specificity) -- higher is worse
  let worstPrompt: PromptAnalysis | null = null;
  let worstScore = -1;
  for (const p of prompts) {
    const score = p.outcome.costDollars / (1 + p.specificity.overall);
    if (score > worstScore) {
      worstScore = score;
      worstPrompt = p;
    }
  }

  return {
    sessionId: session.sessionId,
    prompts,
    averageSpecificity,
    bestPrompt,
    worstPrompt,
    correlations,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
