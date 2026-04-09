/**
 * Report Renderer
 *
 * Formats token breakdown data into readable terminal output using chalk.
 * All costs shown are API-equivalent pricing from real token data.
 */

import chalk from "chalk";
import type { TokenBreakdown } from "../../core/types.js";
import type { SessionInfo } from "../../core/types.js";
import { getPricing } from "../../core/constants.js";
import { attributeSession, aggregateAttribution } from "../../core/analysis/attribution.js";
import { calculateCompounding, perTurnCost } from "../../core/analysis/compounding.js";
import { detectAllPatterns } from "../../core/analysis/patterns.js";
import { decodeProjectPath, padNum, getDuration, timeAgo, makeBar } from "../util/format.js";

// ---------------------------------------------------------------------------
// Main report (clairvoy analyze)
// ---------------------------------------------------------------------------

export function formatReport(breakdown: TokenBreakdown): string {
  const lines: string[] = [];
  const { session } = breakdown;
  const pricing = getPricing(session.model);

  // Header
  lines.push("");
  lines.push(`${chalk.bold.cyan("  clairvoy")}${chalk.dim(" \u2014 token usage analysis")}`);
  lines.push(chalk.dim("─".repeat(60)));

  // Session info
  const duration = getDuration(session.startTime, session.endTime);
  lines.push(`${chalk.dim("  Session:")}  ${session.sessionId.slice(0, 8)}...`);
  lines.push(`${chalk.dim("  Project:")}  ${decodeProjectPath(session.projectPath)}`);
  lines.push(`${chalk.dim("  Model:")}    ${session.model}`);
  lines.push(`${chalk.dim("  Duration:")} ${duration}`);
  lines.push(`${chalk.dim("  Turns:")}    ${session.totalUsage.turnCount} prompts, ${session.totalUsage.toolCallCount} tool calls`);
  lines.push("");

  // Cost breakdown — the main event
  const u = session.totalUsage;
  const inputCost = (u.totalInputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (u.totalOutputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (u.totalCacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  const cacheWriteCost = (u.totalCacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion;

  const totalTokens = u.totalInputTokens + u.totalOutputTokens + u.totalCacheCreationTokens + u.totalCacheReadTokens;

  lines.push(chalk.bold("  COST BREAKDOWN") + chalk.dim("  (API pricing)"));
  lines.push(chalk.dim(`  ${"─".repeat(56)}`));
  lines.push(`  ${chalk.bold("Total:")} ${chalk.green(`$${breakdown.totalCostDollars.toFixed(2)}`)}  ${chalk.dim(`(${totalTokens.toLocaleString()} tokens)`)}`);
  lines.push("");
  lines.push(`    ${fmtCostLine("Cache read", u.totalCacheReadTokens, cacheReadCost, pricing.cacheReadPerMillion, breakdown.totalCostDollars)}`);
  lines.push(`    ${fmtCostLine("Cache write", u.totalCacheCreationTokens, cacheWriteCost, pricing.cacheWritePerMillion, breakdown.totalCostDollars)}`);
  lines.push(`    ${fmtCostLine("Output", u.totalOutputTokens, outputCost, pricing.outputPerMillion, breakdown.totalCostDollars)}`);
  lines.push(`    ${fmtCostLine("Fresh input", u.totalInputTokens, inputCost, pricing.inputPerMillion, breakdown.totalCostDollars)}`);
  lines.push("");

  // Per-turn cost
  const avgCostPerTurn = u.turnCount > 0 ? breakdown.totalCostDollars / u.turnCount : 0;
  lines.push(`  ${chalk.dim("Avg cost/turn:")}  $${avgCostPerTurn.toFixed(2)}    ${chalk.dim(`Cost/tool call: $${u.toolCallCount > 0 ? (breakdown.totalCostDollars / u.toolCallCount).toFixed(3) : "0"}`)}`);
  lines.push("");

  // WHO CAUSED WHAT section
  if (session.turns.length > 0) {
    const attributedTurns = attributeSession(session);
    const totals = aggregateAttribution(attributedTurns);
    const grandTotalAttr =
      totals.userCausedTokens +
      totals.claudeCausedTokens +
      totals.systemOverheadTokens +
      totals.historyRetransmission;

    // Compute dollar costs for each source
    // User tokens are input-priced, Claude tokens are output-priced,
    // system overhead and history are cache-read-priced (cheap retransmission)
    const userCost = (totals.userCausedTokens / 1_000_000) * pricing.inputPerMillion;
    const claudeCost = (totals.claudeCausedTokens / 1_000_000) * pricing.outputPerMillion;
    const systemCostPerTurn = (totals.systemOverheadTokens / 1_000_000) * pricing.cacheReadPerMillion;
    const systemCostTotal = systemCostPerTurn * session.turns.length;
    const historyCost = (totals.historyRetransmission / 1_000_000) * pricing.cacheReadPerMillion;

    const historyPct =
      grandTotalAttr > 0
        ? Math.round((totals.historyRetransmission / grandTotalAttr) * 100)
        : 0;

    lines.push(chalk.bold("  WHO CAUSED WHAT"));
    lines.push(chalk.dim(`  ${"─".repeat(56)}`));
    lines.push(
      `  You typed:         ${padNum(totals.userCausedTokens)} tokens     $${userCost.toFixed(2)}`,
    );
    lines.push(
      `  Claude output:     ${padNum(totals.claudeCausedTokens)} tokens     $${claudeCost.toFixed(2)}`,
    );
    lines.push(
      `  System overhead:  ~${fmtK(totals.systemOverheadTokens)}/turn       $${systemCostTotal.toFixed(2)}`,
    );

    const historyAnnotation =
      historyPct >= 50
        ? chalk.yellow(` <- ${historyPct}% of cost`)
        : historyPct >= 30
          ? chalk.dim(` (${historyPct}%)`)
          : "";
    lines.push(
      `  History re-sent:   ${padNum(totals.historyRetransmission)} tokens     $${historyCost.toFixed(2)}${historyAnnotation}`,
    );
    lines.push("");

    // CONTEXT GROWTH section
    const turnCosts = perTurnCost(session);
    if (turnCosts.length > 0) {
      lines.push(chalk.bold("  CONTEXT GROWTH"));
      lines.push(chalk.dim(`  ${"─".repeat(56)}`));

      // Pick representative turns: first, middle, last
      const picks: Array<{ label: string; idx: number }> = [];
      picks.push({ label: `Turn 1`, idx: 0 });
      if (turnCosts.length > 2) {
        const mid = Math.floor(turnCosts.length / 2);
        picks.push({ label: `Turn ${mid + 1}`, idx: mid });
      }
      if (turnCosts.length > 1) {
        picks.push({
          label: `Turn ${turnCosts.length}`,
          idx: turnCosts.length - 1,
        });
      }

      for (const p of picks) {
        const tc = turnCosts[p.idx];
        lines.push(
          `  ${p.label.padEnd(12)} ${fmtK(tc.contextSize).padStart(6)} tokens    $${tc.costPerTurn.toFixed(2)}/turn`,
        );
      }

      lines.push(chalk.dim(`  ${"─".repeat(56)}`));

      // Show marginal cost of verbosity at turn 1
      if (turnCosts.length > 1) {
        const compoundingInfos = calculateCompounding(session);
        const firstMarginal = compoundingInfos[0]?.marginalCostOfVerbosity ?? 0;
        if (firstMarginal > 0) {
          lines.push(
            chalk.dim(
              `  Each extra output token at turn 1 costs $${firstMarginal.toFixed(6)} over session lifetime`,
            ),
          );
        }
      }
      lines.push("");
    }
  }

  // Category breakdown (what's in the output)
  lines.push(chalk.bold("  OUTPUT BREAKDOWN"));
  lines.push(chalk.dim(`  ${"─".repeat(56)}`));

  for (const cat of breakdown.categories) {
    const color = getCategoryColor(cat.name);
    const bar = makeBar(cat.percent, 20);
    const pctStr = `${cat.percent.toFixed(1)}%`.padStart(6);
    lines.push(`  ${color(bar)} ${pctStr}  ${color(cat.name)}`);
    lines.push(`  ${chalk.dim(`${" ".repeat(22)}${padNum(cat.tokens)} tokens \u2014 ${cat.description}`)}`);
  }
  lines.push("");

  // Warnings
  if (breakdown.warnings.length > 0) {
    lines.push(chalk.bold("  WASTE DETECTED"));
    lines.push(chalk.dim(`  ${"─".repeat(56)}`));

    for (const warning of breakdown.warnings) {
      const icon = getWarningIcon(warning.severity);
      const color = getWarningColor(warning.severity);
      lines.push(`  ${color(`${icon} ${warning.message}`)}`);
    }
    lines.push("");
  }

  // Behavioral patterns
  const detectedPatterns = detectAllPatterns(breakdown.session);
  if (detectedPatterns.length > 0) {
    lines.push(chalk.bold("  BEHAVIORAL PATTERNS"));
    lines.push(chalk.dim(`  ${"─".repeat(56)}`));

    for (const pattern of detectedPatterns) {
      const icon = getWarningIcon(pattern.severity);
      const color = getWarningColor(pattern.severity);
      const turnLabel =
        pattern.turnRange[0] === pattern.turnRange[1]
          ? `turn ${pattern.turnRange[0]}`
          : `turns ${pattern.turnRange[0]}-${pattern.turnRange[1]}`;
      const tokenStr = `~${pattern.tokensWasted.toLocaleString()} tokens`;
      const typeLabel = patternTypeLabel(pattern.type);
      lines.push(
        `  ${color(`${icon} ${typeLabel} (${turnLabel}): ${pattern.description} (${tokenStr})`)}`,
      );
    }
    lines.push("");
  }

  // Proven savings — only waste we can measure directly
  // Re-reads: exact duplicate file reads with known token counts
  // Output waste: pattern-matched text (sycophancy, meta-commentary, echoing)
  // Redundant tools: exact same tool+args called twice
  const provenWaste = breakdown.estimatedSavingsDollars;
  const provenReReadTokens = breakdown.warnings
    .filter((w) => w.message.includes("re-reads"))
    .reduce((sum, w) => sum + w.tokensWasted, 0);

  // Behavioral patterns are flagged but NOT counted as proven savings
  // They indicate problems but the exact dollar waste is an estimate
  const hasPatterns = detectedPatterns.length > 0;

  if (provenWaste > 0.01 || hasPatterns) {
    lines.push(chalk.bold("  SAVINGS OPPORTUNITY"));
    lines.push(chalk.dim(`  ${"─".repeat(56)}`));

    if (provenWaste > 0.001 || provenReReadTokens > 0) {
      // Re-reads have outsized impact: each re-read adds tokens that compound across all future turns
      const avgTurnsRemaining = Math.max(1, breakdown.session.turns.length / 2);
      const compoundedReReadCost = (provenReReadTokens / 1_000_000) * pricing.cacheReadPerMillion * avgTurnsRemaining;
      const totalProvenImpact = (provenWaste - (provenReReadTokens / 1_000_000) * pricing.cacheReadPerMillion) + compoundedReReadCost;

      lines.push(`  ${chalk.green("Proven waste:")} $${Math.max(provenWaste, totalProvenImpact).toFixed(2)} ${chalk.dim("(measured from actual token data)")}`);
      if (provenReReadTokens > 0) {
        lines.push(`  ${chalk.dim("  File re-reads:")} ${provenReReadTokens.toLocaleString()} tokens ${chalk.dim(`(compounds across ${Math.round(avgTurnsRemaining)} remaining turns)`)}`);
      }
      for (const w of breakdown.warnings.filter((w) => !w.message.includes("re-reads"))) {
        lines.push(`  ${chalk.dim("  " + w.message.split("~")[0].trim())}`);
      }
    }

    if (hasPatterns) {
      const patternCount = detectedPatterns.length;
      const highSev = detectedPatterns.filter((p) => p.severity === "high").length;
      lines.push("");
      lines.push(`  ${chalk.yellow("Behavioral issues:")} ${patternCount} patterns detected${highSev > 0 ? chalk.red(` (${highSev} critical)`) : ""}`);
      lines.push(chalk.dim("  These indicate inefficiency but exact savings depend on workflow changes."));
    }

    lines.push("");
    lines.push(`  ${chalk.dim("Run")} ${chalk.cyan("clairvoy optimize --install")} ${chalk.dim("to generate rules that prevent this waste")}`);
    lines.push("");
  }

  lines.push(chalk.dim("─".repeat(60)));
  lines.push("");

  return lines.join("\n");
}

/**
 * Format a single cost line with tokens, dollar cost, rate, and % of total.
 */
function fmtCostLine(
  label: string,
  tokens: number,
  cost: number,
  ratePerMillion: number,
  totalCost: number,
): string {
  const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
  const costStr = chalk.white(`$${cost.toFixed(2)}`);
  const tokenStr = chalk.dim(`${(tokens / 1_000_000).toFixed(1)}M`);
  const rateStr = chalk.dim(`@ $${ratePerMillion}/M`);
  const pctStr = pct >= 1 ? chalk.dim(`(${pct.toFixed(0)}%)`) : chalk.dim("(<1%)");
  return `${label.padEnd(14)} ${costStr.padStart(18)}  ${tokenStr.padStart(8)} ${rateStr}  ${pctStr}`;
}

// ---------------------------------------------------------------------------
// Compact JSON output (clairvoy analyze --json)
// ---------------------------------------------------------------------------

export function formatCompact(breakdown: TokenBreakdown): string {
  const { session } = breakdown;
  const pricing = getPricing(session.model);
  const u = session.totalUsage;

  const total = u.totalInputTokens + u.totalOutputTokens + u.totalCacheCreationTokens + u.totalCacheReadTokens;

  return JSON.stringify(
    {
      sessionId: session.sessionId,
      project: decodeProjectPath(session.projectPath),
      model: session.model,
      turns: u.turnCount,
      toolCalls: u.toolCallCount,
      tokens: {
        total,
        freshInput: u.totalInputTokens,
        cacheWrite: u.totalCacheCreationTokens,
        cacheRead: u.totalCacheReadTokens,
        output: u.totalOutputTokens,
      },
      cost: {
        total: breakdown.totalCostDollars,
        freshInput: +((u.totalInputTokens / 1e6) * pricing.inputPerMillion).toFixed(2),
        cacheWrite: +((u.totalCacheCreationTokens / 1e6) * pricing.cacheWritePerMillion).toFixed(2),
        cacheRead: +((u.totalCacheReadTokens / 1e6) * pricing.cacheReadPerMillion).toFixed(2),
        output: +((u.totalOutputTokens / 1e6) * pricing.outputPerMillion).toFixed(2),
      },
      waste: {
        percent: breakdown.estimatedSavingsPercent,
        dollars: breakdown.estimatedSavingsDollars,
        warnings: breakdown.warnings.length,
      },
      categories: breakdown.categories.map((c) => ({
        name: c.name,
        tokens: c.tokens,
        percent: c.percent,
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Session list (clairvoy list)
// ---------------------------------------------------------------------------

export function formatSessionList(sessions: SessionInfo[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${chalk.bold.cyan("  clairvoy")}${chalk.dim(" \u2014 recent sessions")}`);
  lines.push(chalk.dim("─".repeat(60)));
  lines.push("");

  if (sessions.length === 0) {
    lines.push(chalk.dim("  No Claude Code sessions found."));
    lines.push(chalk.dim("  Sessions are stored in ~/.claude/projects/"));
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    chalk.dim(`  ${"#".padEnd(4)} ${"Session".padEnd(12)} ${"Project".padEnd(30)} ${"Last Modified".padEnd(20)}`),
  );
  lines.push(chalk.dim(`  ${"─".repeat(56)}`));

  sessions.forEach((s, i) => {
    const num = `${i + 1}.`.padEnd(4);
    const sid = s.sessionId.slice(0, 10).padEnd(12);
    const project = decodeProjectPath(s.projectPath).slice(0, 28).padEnd(30);
    const modified = timeAgo(s.modifiedAt);
    lines.push(`  ${num} ${chalk.cyan(sid)} ${project} ${chalk.dim(modified)}`);
  });

  lines.push("");
  lines.push(`  ${chalk.dim("Run")} ${chalk.cyan("clairvoy analyze <number>")} ${chalk.dim("to analyze a session")}`);
  lines.push(`  ${chalk.dim("Run")} ${chalk.cyan("clairvoy analyze")} ${chalk.dim("to analyze the most recent session")}`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Summary (clairvoy summary)
// ---------------------------------------------------------------------------

export function formatSummary(
  results: Array<{ project: string; cost: number; waste: number; tokens: number; patternCount?: number }>,
  totals: { totalCost: number; totalWaste: number; totalTokens: number; totalTurns: number; totalPatterns?: number },
  dateRange?: { oldest: Date; newest: Date },
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`${chalk.bold.cyan("  clairvoy")}${chalk.dim(` \u2014 summary across ${results.length} sessions`)}`);
  if (dateRange) {
    const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const oldest = fmtDate(dateRange.oldest);
    const newest = fmtDate(dateRange.newest);
    lines.push(chalk.dim(`  ${oldest} → ${newest}`));
  }
  lines.push(chalk.dim("─".repeat(60)));
  lines.push("");
  lines.push(`  ${chalk.bold("Total tokens:")}  ${totals.totalTokens.toLocaleString()}`);
  lines.push(`  ${chalk.bold("Total turns:")}   ${totals.totalTurns}`);
  lines.push(`  ${chalk.bold("Total cost:")}    $${totals.totalCost.toFixed(2)}`);
  if (totals.totalWaste > 0.01) {
    lines.push(`  ${chalk.bold("Proven waste:")}  ${chalk.yellow(`$${totals.totalWaste.toFixed(2)}`)} ${chalk.dim("(measured: re-reads, sycophancy, meta, echoing)")}`);
  }
  if (totals.totalPatterns && totals.totalPatterns > 0) {
    lines.push(`  ${chalk.bold("Issues found:")}  ${chalk.yellow(`${totals.totalPatterns} behavioral patterns`)} ${chalk.dim("(reverts, retries, loops)")}`);
  }
  lines.push("");

  for (const r of results) {
    const costStr = `$${r.cost.toFixed(2)}`.padStart(8);
    const parts: string[] = [];
    if (r.waste > 0.01) parts.push(chalk.yellow(`-$${r.waste.toFixed(2)} waste`));
    if (r.patternCount && r.patternCount > 0) parts.push(chalk.dim(`${r.patternCount} issues`));
    const status = parts.length > 0 ? parts.join(", ") : chalk.green("clean");
    lines.push(`  ${costStr}  ${status}  ${chalk.dim(r.project)}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ChalkFn = (text: string) => string;

/**
 * Format a token count as a compact "K" string (e.g., 23000 → "23K").
 */
function fmtK(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return `${tokens}`;
}

function getCategoryColor(name: string): ChalkFn {
  if (name.includes("Cache Read")) return chalk.green;
  if (name.includes("Cache Write")) return chalk.blue;
  if (name.includes("Code Output")) return chalk.cyan;
  if (name.includes("Fresh Input")) return chalk.white;
  if (name.includes("Thinking")) return chalk.magenta;
  if (name.includes("Sycophancy") || name.includes("waste") || name.includes("Re-read")) return chalk.red;
  if (name.includes("Unsolicited") || name.includes("Meta")) return chalk.yellow;
  return chalk.white;
}

function getWarningIcon(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "!!";
  if (severity === "medium") return " !";
  return "  ";
}

function getWarningColor(severity: "high" | "medium" | "low"): ChalkFn {
  if (severity === "high") return chalk.red;
  if (severity === "medium") return chalk.yellow;
  return chalk.dim;
}

function patternTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    loop: "Loop detected",
    "dead-end": "Dead-end",
    "yak-shave": "Yak-shave",
    "search-spiral": "Search spiral",
    "over-read": "Over-read",
    "redundant-tool": "Redundant",
    "retry-storm": "Retry storm",
    "edit-revert": "Edit revert",
    "verbose-output": "Verbose output",
  };
  return labels[type] || type;
}
