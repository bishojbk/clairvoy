/**
 * clairvoy compare -- Side-by-side comparison of two sessions.
 */

import chalk from "chalk";
import type { Command } from "commander";
import type { EfficiencyGrade } from "../../core/types.js";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { scoreSession } from "../../core/analysis/scoring.js";
import { getPricing, calculateCost } from "../../core/constants.js";
import { decodeProjectPath, getDuration } from "../util/format.js";

export function registerCompareCommand(program: Command): void {
  program
    .command("compare <session1> <session2>")
    .description("Compare two sessions side-by-side")
    .option("--json", "Output as JSON")
    .action(
      (
        session1: string,
        session2: string,
        opts: { json?: boolean },
      ) => {
        const pathA = resolveSessionPath(session1);
        const pathB = resolveSessionPath(session2);

        if (!pathA) {
          console.error(`Could not resolve session: ${session1}`);
          process.exit(1);
        }
        if (!pathB) {
          console.error(`Could not resolve session: ${session2}`);
          process.exit(1);
        }

        try {
          const parsedA = parseSession(pathA);
          const breakdownA = classifySession(parsedA);
          const scoreA = scoreSession(parsedA, breakdownA);

          const parsedB = parseSession(pathB);
          const breakdownB = classifySession(parsedB);
          const scoreB = scoreSession(parsedB, breakdownB);

          if (opts.json) {
            console.log(
              JSON.stringify(
                {
                  sessionA: { parsed: parsedA, breakdown: breakdownA, score: scoreA },
                  sessionB: { parsed: parsedB, breakdown: breakdownB, score: scoreB },
                },
                null,
                2,
              ),
            );
          } else {
            console.log(
              renderComparison(
                { parsed: parsedA, breakdown: breakdownA, score: scoreA },
                { parsed: parsedB, breakdown: breakdownB, score: scoreB },
              ),
            );
          }
        } catch (err) {
          console.error(`Error comparing sessions: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );
}

// ---------------------------------------------------------------------------
// Session resolution (same logic as analyze/score)
// ---------------------------------------------------------------------------

function resolveSessionPath(arg: string): string | null {
  const sessions = listSessions(50);
  if (sessions.length === 0) return null;

  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
    return sessions[idx - 1].path;
  }

  const match = sessions.find((s) => s.sessionId.startsWith(arg));
  if (match) return match.path;

  return arg;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface SessionAnalysis {
  parsed: ReturnType<typeof parseSession>;
  breakdown: ReturnType<typeof classifySession>;
  score: ReturnType<typeof scoreSession>;
}

function renderComparison(a: SessionAnalysis, b: SessionAnalysis): string {
  const lines: string[] = [];
  const sep = "\u2500".repeat(62);

  // Header
  lines.push("");
  lines.push(`${chalk.bold.cyan("  clairvoy")}${chalk.dim(" \u2014 compare")}`);
  lines.push(chalk.dim("  " + sep));

  // Column headers
  lines.push(
    `  ${"".padEnd(22)}${chalk.bold("session A".padEnd(18))}${chalk.bold("session B".padEnd(18))}`,
  );
  lines.push(chalk.dim("  " + sep));

  // Project
  const projA = shortenPath(decodeProjectPath(a.parsed.projectPath));
  const projB = shortenPath(decodeProjectPath(b.parsed.projectPath));
  lines.push(row("Project:", projA, projB));

  // Model
  lines.push(row("Model:", a.parsed.model, b.parsed.model));

  // Duration
  const durA = getDuration(a.parsed.startTime, a.parsed.endTime);
  const durB = getDuration(b.parsed.startTime, b.parsed.endTime);
  lines.push(row("Duration:", durA, durB));

  // Turns
  const turnsA = a.parsed.totalUsage.turnCount;
  const turnsB = b.parsed.totalUsage.turnCount;
  lines.push(numRow("Turns:", turnsA, turnsB));

  // Tool calls
  const toolsA = a.parsed.totalUsage.toolCallCount;
  const toolsB = b.parsed.totalUsage.toolCallCount;
  lines.push(numRow("Tool calls:", toolsA, toolsB));

  // Total tokens
  const tokensA = totalTokens(a);
  const tokensB = totalTokens(b);
  lines.push(numRow("Total tokens:", tokensA, tokensB, true));

  // Cost
  const costA = a.breakdown.totalCostDollars;
  const costB = b.breakdown.totalCostDollars;
  lines.push(costRow("Cost:", costA, costB));

  // Score
  lines.push(scoreRow("Score:", a.score, b.score));

  // Separator before cost breakdown
  lines.push("");

  // Cost breakdown by category
  const pricingA = getPricing(a.parsed.model);
  const pricingB = getPricing(b.parsed.model);

  const cacheReadCostA = (a.parsed.totalUsage.totalCacheReadTokens / 1_000_000) * pricingA.cacheReadPerMillion;
  const cacheReadCostB = (b.parsed.totalUsage.totalCacheReadTokens / 1_000_000) * pricingB.cacheReadPerMillion;
  lines.push(costRow("Cache read:", cacheReadCostA, cacheReadCostB));

  const cacheWriteCostA = (a.parsed.totalUsage.totalCacheCreationTokens / 1_000_000) * pricingA.cacheWritePerMillion;
  const cacheWriteCostB = (b.parsed.totalUsage.totalCacheCreationTokens / 1_000_000) * pricingB.cacheWritePerMillion;
  lines.push(costRow("Cache write:", cacheWriteCostA, cacheWriteCostB));

  const outputCostA = (a.parsed.totalUsage.totalOutputTokens / 1_000_000) * pricingA.outputPerMillion;
  const outputCostB = (b.parsed.totalUsage.totalOutputTokens / 1_000_000) * pricingB.outputPerMillion;
  lines.push(costRow("Output:", outputCostA, outputCostB));

  // Footer with verdict
  lines.push(chalk.dim("  " + sep));

  const costDelta = costA > 0 ? ((costB - costA) / costA) * 100 : 0;
  const scoreDelta = b.score.numericScore - a.score.numericScore;

  const verdict = buildVerdict(costDelta, scoreDelta);
  if (verdict) {
    lines.push(`  ${verdict}`);
  }

  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Row formatting helpers
// ---------------------------------------------------------------------------

function row(label: string, valA: string, valB: string): string {
  const lbl = chalk.dim(label.padEnd(22));
  return `  ${lbl}${valA.padEnd(18)}${valB.padEnd(18)}`;
}

function numRow(
  label: string,
  valA: number,
  valB: number,
  formatLarge = false,
): string {
  const fmtA = formatLarge ? formatTokenCount(valA) : valA.toLocaleString();
  const fmtB = formatLarge ? formatTokenCount(valB) : valB.toLocaleString();

  const delta = valA !== 0 ? ((valB - valA) / valA) * 100 : 0;
  const deltaStr = formatDelta(delta);

  const lbl = chalk.dim(label.padEnd(22));
  return `  ${lbl}${fmtA.padEnd(18)}${fmtB.padEnd(14)}${deltaStr}`;
}

function costRow(label: string, costA: number, costB: number): string {
  const fmtA = "$" + costA.toFixed(2);
  const fmtB = "$" + costB.toFixed(2);

  const delta = costA !== 0 ? ((costB - costA) / costA) * 100 : 0;
  const deltaStr = formatDelta(delta);

  const lbl = chalk.dim(label.padEnd(22));
  return `  ${lbl}${fmtA.padEnd(18)}${fmtB.padEnd(14)}${deltaStr}`;
}

function scoreRow(
  label: string,
  scoreA: ReturnType<typeof scoreSession>,
  scoreB: ReturnType<typeof scoreSession>,
): string {
  const fmtA = `${scoreA.overall} (${scoreA.numericScore})`;
  const fmtB = `${scoreB.overall} (${scoreB.numericScore})`;

  const diff = scoreB.numericScore - scoreA.numericScore;
  let deltaStr = "";
  if (diff !== 0) {
    const sign = diff > 0 ? "+" : "";
    const color = diff > 0 ? chalk.green : chalk.red;
    deltaStr = color(`${sign}${diff}pts`);
  }

  const lbl = chalk.dim(label.padEnd(22));
  return `  ${lbl}${fmtA.padEnd(18)}${fmtB.padEnd(14)}${deltaStr}`;
}

function formatDelta(percent: number): string {
  if (Math.abs(percent) < 1) return "";
  const sign = percent > 0 ? "+" : "";
  const rounded = Math.round(percent);
  // For costs/tokens, negative delta = improvement (cheaper)
  const color = percent < 0 ? chalk.green : chalk.red;
  return color(`${sign}${rounded}%`);
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000_000) return (tokens / 1_000_000_000).toFixed(1) + "B";
  if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + "M";
  if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + "K";
  return tokens.toLocaleString();
}

function totalTokens(s: SessionAnalysis): number {
  const u = s.parsed.totalUsage;
  return (
    u.totalInputTokens +
    u.totalOutputTokens +
    u.totalCacheCreationTokens +
    u.totalCacheReadTokens
  );
}

function shortenPath(projectPath: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && projectPath.startsWith(home)) {
    return "~" + projectPath.slice(home.length);
  }
  return projectPath;
}

function buildVerdict(costDelta: number, scoreDelta: number): string {
  const parts: string[] = [];

  if (Math.abs(costDelta) >= 1) {
    const cheaper = costDelta < 0;
    const pct = Math.abs(Math.round(costDelta));
    if (cheaper) {
      parts.push(`Session B was ${chalk.green(pct + "% cheaper")}`);
    } else {
      parts.push(`Session B was ${chalk.red(pct + "% more expensive")}`);
    }
  }

  if (Math.abs(scoreDelta) >= 1) {
    if (scoreDelta > 0) {
      parts.push(`with a ${chalk.green("higher score")}`);
    } else {
      parts.push(`with a ${chalk.red("lower score")}`);
    }
  }

  if (parts.length === 0) return "";
  return chalk.bold("Verdict: ") + parts.join(" ");
}
