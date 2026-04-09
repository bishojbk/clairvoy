/**
 * Token Classifier
 *
 * Takes a parsed session and classifies token usage into categories.
 * Identifies waste — sycophancy, re-reads, verbose explanations, etc.
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type {
  ParsedSession,
  TokenBreakdown,
  CategoryBreakdown,
  WasteWarning,
  TextBlock,
  ThinkingBlock,
  ToolCall,
} from "../types.js";
import {
  getPricing,
  calculateCost,
  estimateTokens,
  WASTE_THRESHOLDS,
  type ModelPricing,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Waste detection patterns
// ---------------------------------------------------------------------------

const SYCOPHANCY_PATTERNS = [
  /^(great|excellent|good|wonderful|fantastic|perfect|brilliant|awesome)\s+(question|point|idea|suggestion|thought|catch|observation|call)/i,
  /^that'?s?\s+(a\s+)?(great|excellent|good|wonderful|brilliant|smart|clever)\s/i,
  /^(absolutely|definitely|certainly|of course)[!.,]/i,
  /^I('d be| would be| am)\s+(happy|glad|delighted)\s+to\s+help/i,
  /^(sure|yes)[!,]\s+(I can|let me|I'll|I'd be)/i,
  /you'?re?\s+(absolutely\s+)?right/i,
  /that makes (perfect|total|complete) sense/i,
];

const SUGGESTION_PATTERNS = [
  /you (might|may|could) (also )?want to/i,
  /you (might|may|could) (also )?consider/i,
  /it('s| would be) (also )?worth (noting|mentioning|considering)/i,
  /as an? (additional|bonus|extra) (step|suggestion|tip)/i,
  /here are (some|a few) (additional|other) (suggestions|improvements|tips)/i,
  /while (we're|I'm|you're) (at it|here)/i,
  /one (more )?thing (to|you could)/i,
];

const META_PATTERNS = [
  /^let me (take a look|examine|check|review|analyze|look at|read|investigate|explore|dig into)/i,
  /^I('ll| will) (now )?(take a look|examine|check|review|analyze|read|look at|start by)/i,
  /^(looking|checking|examining|reviewing|analyzing|reading|exploring|investigating) (at |through |into )?/i,
  /^here'?s?\s+what I (found|see|notice|changed|did|discovered)/i,
  /^I('ve| have) (now )?(made|completed|finished|applied|implemented|updated) (the|all|your)/i,
  /^(to summarize|in summary|to sum up|to recap|here'?s?\s+a summary)/i,
  /^(first|next),?\s+(I('ll| will|'m going to)|let me)/i,
  /^I (can see|notice|observe|found) that/i,
  /^(perfect|done|alright|okay)[!.,]\s+(now |let me |I('ll| will))/i,
  /^I('ll| will) (now )?go ahead and/i,
];

const ECHOING_PATTERNS = [
  /^(here'?s?\s+the (updated|modified|new|full|complete) (file|code|version|content))/i,
  /^(the (updated|modified|new|complete) (file|code) (looks|is) (like|as follows))/i,
  /^(here'?s?\s+the (entire|whole|full) (file|content))/i,
];

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export function classifySession(session: ParsedSession): TokenBreakdown {
  const warnings: WasteWarning[] = [];

  // Classify output tokens by content type
  let thinkingTokens = 0;
  let codeOutputTokens = 0;
  let textOutputTokens = 0;
  let sycophancyTokens = 0;
  let suggestionTokens = 0;
  let metaCommentaryTokens = 0;
  let echoingTokens = 0;
  let toolCallInputTokens = 0;

  // Track file reads for duplicate detection
  const fileReads = new Map<string, { count: number; totalTokens: number }>();

  for (const turn of session.turns) {
    for (const block of turn.assistantBlocks) {
      if (block.type === "thinking") {
        const tb = block as ThinkingBlock;
        thinkingTokens += estimateTokens(tb.thinking || "");
      } else if (block.type === "text") {
        const tb = block as TextBlock;
        const text = tb.text;
        const tokens = estimateTokens(text);

        if (isSycophantic(text)) {
          sycophancyTokens += tokens;
        } else if (containsSuggestions(text)) {
          suggestionTokens += tokens;
        } else if (isMetaCommentary(text)) {
          metaCommentaryTokens += tokens;
        } else if (isEchoing(text)) {
          echoingTokens += tokens;
        } else if (isCodeBlock(text)) {
          codeOutputTokens += tokens;
        } else {
          textOutputTokens += tokens;
        }
      }
    }

    for (const tc of turn.toolCalls) {
      toolCallInputTokens += estimateTokens(JSON.stringify(tc.input));

      if (tc.name === "Read" || tc.name === "Bash") {
        const filePath = extractFilePath(tc);
        if (filePath) {
          const existing = fileReads.get(filePath) || { count: 0, totalTokens: 0 };
          existing.count++;
          existing.totalTokens += tc.resultTokenEstimate;
          fileReads.set(filePath, existing);
        }
      }
    }
  }

  // Calculate file re-read waste
  let reReadWasteTokens = 0;
  for (const [filePath, info] of fileReads) {
    if (info.count > 1) {
      const wastedReads = info.count - 1;
      const tokensPerRead = Math.floor(info.totalTokens / info.count);
      const wasted = wastedReads * tokensPerRead;
      reReadWasteTokens += wasted;

      if (wasted > WASTE_THRESHOLDS.fileReReadWarning) {
        warnings.push({
          severity: wasted > WASTE_THRESHOLDS.fileReReadHigh ? "high" : "medium",
          message: `${shortPath(filePath)} read ${info.count} times (~${wasted.toLocaleString()} tokens wasted on re-reads)`,
          tokensWasted: wasted,
        });
      }
    }
  }

  // Add warnings for sycophancy
  if (sycophancyTokens > WASTE_THRESHOLDS.sycophancyWarning) {
    warnings.push({
      severity: sycophancyTokens > WASTE_THRESHOLDS.sycophancyHigh ? "high" : "medium",
      message: `~${sycophancyTokens.toLocaleString()} tokens spent on sycophantic filler ("Great question!", "Absolutely!", etc.)`,
      tokensWasted: sycophancyTokens,
    });
  }

  // Add warnings for unsolicited suggestions
  if (suggestionTokens > WASTE_THRESHOLDS.suggestionWarning) {
    warnings.push({
      severity: suggestionTokens > WASTE_THRESHOLDS.suggestionHigh ? "high" : "medium",
      message: `~${suggestionTokens.toLocaleString()} tokens spent on unsolicited suggestions ("You might also want to...")`,
      tokensWasted: suggestionTokens,
    });
  }

  // Add warnings for meta-commentary
  if (metaCommentaryTokens > WASTE_THRESHOLDS.metaCommentaryWarning) {
    warnings.push({
      severity: "low",
      message: `~${metaCommentaryTokens.toLocaleString()} tokens spent on meta-commentary ("Let me take a look...", "Here's what I found...")`,
      tokensWasted: metaCommentaryTokens,
    });
  }

  // Calculate total tool result tokens
  let toolResultTokens = 0;
  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      toolResultTokens += tc.resultTokenEstimate;
    }
  }

  // Build categories from actual API usage data
  const totalInput =
    session.totalUsage.totalInputTokens +
    session.totalUsage.totalCacheCreationTokens +
    session.totalUsage.totalCacheReadTokens;
  const totalOutput = session.totalUsage.totalOutputTokens;
  const grandTotal = totalInput + totalOutput;

  const categories: CategoryBreakdown[] = [
    {
      name: "Cache Read (Input)",
      tokens: session.totalUsage.totalCacheReadTokens,
      percent: pct(session.totalUsage.totalCacheReadTokens, grandTotal),
      description: "Cached system prompt, tools, CLAUDE.md — cheap (90% discount)",
    },
    {
      name: "Cache Write (Input)",
      tokens: session.totalUsage.totalCacheCreationTokens,
      percent: pct(session.totalUsage.totalCacheCreationTokens, grandTotal),
      description: "New content written to cache (1.25x input price)",
    },
    {
      name: "Fresh Input",
      tokens: session.totalUsage.totalInputTokens,
      percent: pct(session.totalUsage.totalInputTokens, grandTotal),
      description: "Non-cached input tokens (conversation history, new content)",
    },
    {
      name: "Tool Results (est.)",
      tokens: toolResultTokens,
      percent: pct(toolResultTokens, grandTotal),
      description: "File contents, command output fed back as input",
    },
    {
      name: "Thinking",
      tokens: thinkingTokens,
      percent: pct(thinkingTokens, grandTotal),
      description: "Extended thinking / reasoning (output tokens)",
    },
    {
      name: "Code Output",
      tokens: codeOutputTokens,
      percent: pct(codeOutputTokens, grandTotal),
      description: "Actual code in responses — the useful stuff",
    },
    {
      name: "Text Explanations",
      tokens: textOutputTokens,
      percent: pct(textOutputTokens, grandTotal),
      description: "Explanatory text in responses",
    },
    {
      name: "Sycophancy",
      tokens: sycophancyTokens,
      percent: pct(sycophancyTokens, grandTotal),
      description: '"Great question!", "Absolutely!", praise filler',
    },
    {
      name: "Unsolicited Suggestions",
      tokens: suggestionTokens,
      percent: pct(suggestionTokens, grandTotal),
      description: '"You might also want to..." advice you didn\'t ask for',
    },
    {
      name: "Meta-commentary",
      tokens: metaCommentaryTokens,
      percent: pct(metaCommentaryTokens, grandTotal),
      description: '"Let me check...", "Here\'s what I found..." narration',
    },
    {
      name: "Code Echoing (waste)",
      tokens: echoingTokens,
      percent: pct(echoingTokens, grandTotal),
      description: "Echoing back full files or code blocks after editing",
    },
    {
      name: "File Re-reads (waste)",
      tokens: reReadWasteTokens,
      percent: pct(reReadWasteTokens, grandTotal),
      description: "Reading the same file multiple times",
    },
  ];

  // Sort by token count descending, filter out zeros
  categories.sort((a, b) => b.tokens - a.tokens);
  const nonZeroCategories = categories.filter((c) => c.tokens > 0);

  // Calculate cost
  const pricing = getPricing(session.model);
  const totalCostDollars = calculateCost(session.totalUsage, pricing);

  // Estimate savings from eliminating waste
  // Add warning for code echoing
  if (echoingTokens > WASTE_THRESHOLDS.metaCommentaryWarning) {
    warnings.push({
      severity: "medium",
      message: `~${echoingTokens.toLocaleString()} tokens spent echoing back code after edits`,
      tokensWasted: echoingTokens,
    });
  }

  const wasteTokens = sycophancyTokens + suggestionTokens + metaCommentaryTokens + echoingTokens + reReadWasteTokens;
  const estimatedSavingsPercent = grandTotal > 0 ? (wasteTokens / grandTotal) * 100 : 0;
  const estimatedSavingsDollars = (wasteTokens / 1_000_000) * pricing.outputPerMillion;

  // Sort warnings by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  warnings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    session,
    categories: nonZeroCategories,
    warnings,
    estimatedSavingsPercent: Math.round(estimatedSavingsPercent * 10) / 10,
    estimatedSavingsDollars: Math.round(estimatedSavingsDollars * 100) / 100,
    totalCostDollars: Math.round(totalCostDollars * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function isSycophantic(text: string): boolean {
  const firstLine = text.split("\n")[0].trim();
  return SYCOPHANCY_PATTERNS.some((p) => p.test(firstLine));
}

function containsSuggestions(text: string): boolean {
  return SUGGESTION_PATTERNS.some((p) => p.test(text));
}

function isMetaCommentary(text: string): boolean {
  const firstLine = text.split("\n")[0].trim();
  return META_PATTERNS.some((p) => p.test(firstLine));
}

function isEchoing(text: string): boolean {
  const firstLine = text.split("\n")[0].trim();
  if (ECHOING_PATTERNS.some((p) => p.test(firstLine))) return true;
  // Large code blocks (>50 lines) preceded by "here's the updated" type text
  const lines = text.split("\n");
  const codeBlockLines = lines.filter((l) => l.startsWith("```") || /^\s{4,}\S/.test(l)).length;
  return codeBlockLines > 50 && lines.length > 55;
}

function isCodeBlock(text: string): boolean {
  return text.includes("```") || /^\s{4,}\S/.test(text);
}

function extractFilePath(tc: ToolCall): string | null {
  if (tc.name === "Read" && typeof tc.input.file_path === "string") {
    return tc.input.file_path;
  }
  if (tc.name === "Bash" && typeof tc.input.command === "string") {
    const cmd = tc.input.command;
    const match = cmd.match(/(?:cat|head|tail)\s+["']?([^\s"'|>]+)/);
    return match ? match[1] : null;
  }
  return null;
}

function shortPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return ".../" + parts.slice(-2).join("/");
}
