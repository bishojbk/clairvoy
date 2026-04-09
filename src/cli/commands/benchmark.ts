/**
 * clairvoy benchmark — A/B comparison of two sessions.
 */

import chalk from "chalk";
import type { Command } from "commander";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { scoreSession } from "../../core/analysis/scoring.js";

export function registerBenchmarkCommand(program: Command): void {
  program
    .command("benchmark <session1> <session2>")
    .description("A/B comparison of two sessions focused on efficiency")
    .action((session1: string, session2: string) => {
      const pathA = resolveSessionPath(session1);
      const pathB = resolveSessionPath(session2);

      if (!pathA) {
        console.error(chalk.red(`Could not resolve session: ${session1}`));
        process.exit(1);
      }
      if (!pathB) {
        console.error(chalk.red(`Could not resolve session: ${session2}`));
        process.exit(1);
      }

      try {
        const parsedA = parseSession(pathA);
        const breakdownA = classifySession(parsedA);
        const scoreA = scoreSession(parsedA, breakdownA);

        const parsedB = parseSession(pathB);
        const breakdownB = classifySession(parsedB);
        const scoreB = scoreSession(parsedB, breakdownB);

        console.log(renderBenchmark(parsedA, breakdownA, scoreA, parsedB, breakdownB, scoreB));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}

function resolveSessionPath(arg: string): string | null {
  const sessions = listSessions(50);
  if (sessions.length === 0) return null;

  // Numeric index (1-based)
  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
    return sessions[idx - 1].path;
  }

  // Prefix match on sessionId
  const match = sessions.find((s) => s.sessionId.startsWith(arg));
  if (match) return match.path;

  // Treat as direct path
  return arg;
}

function renderBenchmark(
  parsedA: ReturnType<typeof parseSession>,
  breakdownA: ReturnType<typeof classifySession>,
  scoreA: ReturnType<typeof scoreSession>,
  parsedB: ReturnType<typeof parseSession>,
  breakdownB: ReturnType<typeof classifySession>,
  scoreB: ReturnType<typeof scoreSession>,
): string {
  const lines: string[] = [];
  const rule = "\u2500".repeat(56);

  lines.push("");
  lines.push(`${chalk.bold.cyan("  clairvoy")}${chalk.dim(" \u2014 benchmark")}`);
  lines.push(chalk.dim(`  ${rule}`));

  lines.push(`  ${chalk.bold("A:")} session ${chalk.cyan(parsedA.sessionId.slice(0, 8))}  ${chalk.dim("(before)")}`);
  lines.push(`  ${chalk.bold("B:")} session ${chalk.cyan(parsedB.sessionId.slice(0, 8))}  ${chalk.dim("(after)")}`);
  lines.push("");

  // Header
  const label = "Metric".padEnd(18);
  const colA = "A".padStart(12);
  const colB = "B".padStart(12);
  const colD = "Delta".padStart(14);
  lines.push(`  ${chalk.bold(label)}${chalk.bold(colA)}${chalk.bold(colB)}${chalk.bold(colD)}`);
  lines.push(chalk.dim(`  ${rule}`));

  // Metrics
  const turnsA = parsedA.totalUsage.turnCount;
  const turnsB = parsedB.totalUsage.turnCount;
  lines.push(metricRow("Turns", turnsA, turnsB, "lower"));

  const toolsA = parsedA.totalUsage.toolCallCount;
  const toolsB = parsedB.totalUsage.toolCallCount;
  lines.push(metricRow("Tool calls", toolsA, toolsB, "lower"));

  lines.push(costRow("Total cost", breakdownA.totalCostDollars, breakdownB.totalCostDollars));

  const outputA = parsedA.totalUsage.totalOutputTokens;
  const outputB = parsedB.totalUsage.totalOutputTokens;
  lines.push(tokenRow("Output tokens", outputA, outputB));

  lines.push(scoreRow("Score", scoreA, scoreB));

  lines.push(wasteRow("Waste %", breakdownA.estimatedSavingsPercent, breakdownB.estimatedSavingsPercent));

  lines.push("");

  // Summary line
  const costDelta = breakdownB.totalCostDollars - breakdownA.totalCostDollars;
  const costPctChange = breakdownA.totalCostDollars > 0
    ? Math.round((costDelta / breakdownA.totalCostDollars) * 100)
    : 0;
  const scoreDelta = scoreB.numericScore - scoreA.numericScore;

  const parts: string[] = [];
  if (costPctChange !== 0) {
    const absCostPct = Math.abs(costPctChange);
    const costWord = costPctChange < 0 ? "reduction" : "increase";
    const costColor = costPctChange < 0 ? chalk.green : chalk.red;
    parts.push(costColor(`${absCostPct}% cost ${costWord}`));
  }
  if (scoreDelta !== 0) {
    const scoreWord = scoreDelta > 0 ? "improvement" : "decline";
    const scoreColor = scoreDelta > 0 ? chalk.green : chalk.red;
    parts.push(scoreColor(`${Math.abs(scoreDelta)}-point score ${scoreWord}`));
  }

  if (parts.length > 0) {
    lines.push(`  ${chalk.bold("Result:")} ${parts.join(" with ")}.`);
  } else {
    lines.push(`  ${chalk.bold("Result:")} No significant difference.`);
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Row formatters
// ---------------------------------------------------------------------------

function metricRow(label: string, a: number, b: number, betterDirection: "lower" | "higher"): string {
  const valA = String(a).padStart(12);
  const valB = String(b).padStart(12);
  const delta = b - a;
  const pct = a > 0 ? Math.round((delta / a) * 100) : 0;
  const sign = pct > 0 ? "+" : "";
  const deltaStr = `${sign}${pct}%`.padStart(14);

  const isImprovement = (betterDirection === "lower" && delta < 0) || (betterDirection === "higher" && delta > 0);
  const colorFn = delta === 0 ? chalk.dim : isImprovement ? chalk.green : chalk.red;

  return `  ${label.padEnd(18)}${valA}${valB}${colorFn(deltaStr)}`;
}

function costRow(label: string, a: number, b: number): string {
  const valA = ("$" + a.toFixed(2)).padStart(12);
  const valB = ("$" + b.toFixed(2)).padStart(12);
  const delta = b - a;
  const pct = a > 0 ? Math.round((delta / a) * 100) : 0;
  const sign = pct > 0 ? "+" : "";
  const deltaStr = `${sign}${pct}%`.padStart(14);

  const colorFn = delta === 0 ? chalk.dim : delta < 0 ? chalk.green : chalk.red;
  return `  ${label.padEnd(18)}${valA}${valB}${colorFn(deltaStr)}`;
}

function tokenRow(label: string, a: number, b: number): string {
  const fmt = (n: number): string => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
    return String(n);
  };
  const valA = fmt(a).padStart(12);
  const valB = fmt(b).padStart(12);
  const delta = b - a;
  const pct = a > 0 ? Math.round((delta / a) * 100) : 0;
  const sign = pct > 0 ? "+" : "";
  const deltaStr = `${sign}${pct}%`.padStart(14);

  const colorFn = delta === 0 ? chalk.dim : delta < 0 ? chalk.green : chalk.red;
  return `  ${label.padEnd(18)}${valA}${valB}${colorFn(deltaStr)}`;
}

function scoreRow(
  label: string,
  scoreA: ReturnType<typeof scoreSession>,
  scoreB: ReturnType<typeof scoreSession>,
): string {
  const valA = `${scoreA.overall} (${scoreA.numericScore})`.padStart(12);
  const valB = `${scoreB.overall} (${scoreB.numericScore})`.padStart(12);
  const delta = scoreB.numericScore - scoreA.numericScore;
  const sign = delta > 0 ? "+" : "";
  const deltaStr = `${sign}${delta}pts`.padStart(14);

  const colorFn = delta === 0 ? chalk.dim : delta > 0 ? chalk.green : chalk.red;
  return `  ${label.padEnd(18)}${valA}${valB}${colorFn(deltaStr)}`;
}

function wasteRow(label: string, a: number, b: number): string {
  const valA = `${a}%`.padStart(12);
  const valB = `${b}%`.padStart(12);
  const delta = b - a;
  const sign = delta > 0 ? "+" : "";
  const deltaStr = `${sign}${delta.toFixed(1)}pts`.padStart(14);

  const colorFn = delta === 0 ? chalk.dim : delta < 0 ? chalk.green : chalk.red;
  return `  ${label.padEnd(18)}${valA}${valB}${colorFn(deltaStr)}`;
}
