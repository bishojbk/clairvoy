/**
 * clairvoy coach -- Analyze your prompt quality and correlate with costs.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { analyzePrompts } from "../../core/analysis/prompt-analyzer.js";
import type { CoachingReport, PromptAnalysis } from "../../core/types.js";

export function registerCoachCommand(program: Command): void {
  program
    .command("coach [session]")
    .description("Analyze prompt quality and correlate with session costs")
    .option("--json", "Output as JSON")
    .action((sessionArg: string | undefined, opts: { json?: boolean }) => {
      const sessionPath = resolveSessionPath(sessionArg);
      if (!sessionPath) {
        console.error("No session found. Run `clairvoy list` to see available sessions.");
        process.exit(1);
      }

      try {
        const parsed = parseSession(sessionPath);
        const report = analyzePrompts(parsed);

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printCoachingReport(report);
        }
      } catch (err) {
        console.error(`Error analyzing session: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// Session resolution (same pattern as analyze)
// ---------------------------------------------------------------------------

function resolveSessionPath(arg?: string): string | null {
  const sessions = listSessions(50);
  if (sessions.length === 0) return null;

  if (!arg) return sessions[0].path;

  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
    return sessions[idx - 1].path;
  }

  const match = sessions.find((s) => s.sessionId.startsWith(arg));
  if (match) return match.path;

  return arg;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "\u2026";
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

function printCoachingReport(report: CoachingReport): void {
  const bar = "\u2500".repeat(56);

  console.log("");
  console.log(`  ${chalk.bold.cyan("clairvoy")} ${chalk.dim("\u2014 prompt coaching")}`);
  console.log(`  ${chalk.dim(bar)}`);

  const sid = report.sessionId.length > 8
    ? report.sessionId.slice(0, 8)
    : report.sessionId;
  console.log(
    `  Session: ${chalk.white(sid)}` +
    `    Turns: ${chalk.white(String(report.prompts.length))}` +
    `    Avg specificity: ${colorSpec(report.averageSpecificity)}/100`,
  );
  console.log("");

  // Sort prompts by cost (highest first)
  const sorted = [...report.prompts].sort(
    (a, b) => b.outcome.costDollars - a.outcome.costDollars,
  );

  if (sorted.length === 0) {
    console.log(chalk.dim("  No user prompts found in this session."));
    console.log("");
    return;
  }

  console.log(chalk.bold("  PROMPTS") + chalk.dim(" (sorted by cost, highest first)"));
  console.log(`  ${chalk.dim(bar)}`);

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    printPromptEntry(i + 1, p);
  }

  // Correlations
  if (report.correlations.length > 0) {
    console.log("");
    console.log(chalk.bold("  CORRELATIONS"));
    console.log(`  ${chalk.dim(bar)}`);

    for (const c of report.correlations) {
      const costWith = formatCost(c.avgCostWith);
      const costWithout = formatCost(c.avgCostWithout);
      const label = c.factor.padEnd(24);
      console.log(
        `  ${chalk.white(label)} ${chalk.green(costWith)} avg` +
        `  ${chalk.dim(`(vs ${costWithout} without)`)}  ${chalk.yellow(c.improvement)}`,
      );
    }
  }

  console.log("");
}

function printPromptEntry(rank: number, p: PromptAnalysis): void {
  const promptDisplay = truncate(p.promptText, 42);
  const specColor = colorSpec(p.specificity.overall);
  const searches = p.outcome.searchToolCalls;
  const searchNote = searches > 0 ? ` (${searches} searches)` : "";

  console.log(
    `  ${chalk.dim(`#${rank}`)}  ${chalk.white(`"${promptDisplay}"`)}` +
    `    Spec: ${specColor}/100`,
  );
  console.log(
    `      ${chalk.dim("\u2192")} ${p.outcome.toolCallsTriggered} tool calls${searchNote}, ${chalk.yellow(formatCost(p.outcome.costDollars))}`,
  );

  if (p.suggestion) {
    console.log(`      ${chalk.cyan("Tip:")} ${p.suggestion}`);
  }
  if (p.outcome.wasteDetected) {
    console.log(`      ${chalk.red("!")} Re-read detected: file was already read earlier in session`);
  }

  console.log("");
}

function colorSpec(score: number): string {
  if (score >= 70) return chalk.green(String(score));
  if (score >= 40) return chalk.yellow(String(score));
  return chalk.red(String(score));
}
