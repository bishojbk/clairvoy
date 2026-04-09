/**
 * clairvoy analyze — Analyze token usage for a session.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { analyzeModelRouting } from "../../core/analysis/model-router.js";
import { formatReport, formatCompact, formatSummary } from "../renderers/report-renderer.js";
import { decodeProjectPath } from "../util/format.js";

export function registerAnalyzeCommand(program: Command): void {
  program
    .command("analyze [session]")
    .description("Analyze token usage for a session (default: most recent)")
    .option("--json", "Output as JSON")
    .option("-a, --all", "Analyze all recent sessions and show summary")
    .action((sessionArg: string | undefined, opts: { json?: boolean; all?: boolean }) => {
      if (opts.all) {
        analyzeAll(!!opts.json);
        return;
      }

      const sessionPath = resolveSessionPath(sessionArg);
      if (!sessionPath) {
        console.error("No session found. Run `clairvoy list` to see available sessions.");
        process.exit(1);
      }

      try {
        const parsed = parseSession(sessionPath);
        const breakdown = classifySession(parsed);

        if (opts.json) {
          console.log(formatCompact(breakdown));
        } else {
          console.log(formatReport(breakdown));

          // Model routing recommendations
          const routing = analyzeModelRouting(parsed);
          if (routing.recommendations.length > 0 && routing.potentialSavings > 0.10) {
            console.log(`  ${chalk.cyan.bold("MODEL ROUTING SUGGESTION")}`);
            console.log(`  ${chalk.dim("─".repeat(52))}`);
            console.log(`  ${chalk.dim(`${routing.simpleTurns} of ${routing.totalTurns} turns were simple enough for a cheaper model`)}`);
            console.log("");
            for (const rec of routing.recommendations.slice(0, 5)) {
              console.log(`  ${chalk.dim("Turn " + rec.turnIndex + ":")} Use ${chalk.cyan(rec.recommendedModel)} instead of ${chalk.dim(rec.currentModel)} ${chalk.green("(-$" + rec.savings.toFixed(2) + ")")} ${chalk.dim(rec.reason)}`);
            }
            if (routing.recommendations.length > 5) {
              console.log(chalk.dim(`  ...and ${routing.recommendations.length - 5} more`));
            }
            console.log("");
            console.log(`  ${chalk.bold("Potential savings:")} ${chalk.green("$" + routing.potentialSavings.toFixed(2))} ${chalk.dim(`(${routing.savingsPercent}% of session cost)`)}`);
            console.log(`  ${chalk.dim("With model routing: $" + routing.optimizedTotalCost.toFixed(2) + " instead of $" + routing.currentTotalCost.toFixed(2))}`);
            console.log("");
            console.log(chalk.dim("─".repeat(60)));
          }
        }
      } catch (err) {
        console.error(`Error analyzing session: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command("summary")
    .description("Show aggregate stats across recent sessions")
    .option("-n, --limit <number>", "Number of sessions to include", "10")
    .action((opts: { limit?: string }) => {
      analyzeAll(false, parseInt(opts.limit || "10", 10));
    });
}

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

function analyzeAll(json: boolean, limit = 10): void {
  const sessions = listSessions(limit);
  if (sessions.length === 0) {
    console.error("No sessions found.");
    process.exit(1);
  }

  let totalCost = 0;
  let totalWaste = 0;
  let totalTokens = 0;
  let totalTurns = 0;
  const results: Array<{ project: string; cost: number; waste: number; tokens: number }> = [];

  for (const s of sessions) {
    try {
      const parsed = parseSession(s.path);
      const breakdown = classifySession(parsed);
      const tokens =
        parsed.totalUsage.totalInputTokens +
        parsed.totalUsage.totalOutputTokens +
        parsed.totalUsage.totalCacheCreationTokens +
        parsed.totalUsage.totalCacheReadTokens;

      totalCost += breakdown.totalCostDollars;
      totalWaste += breakdown.estimatedSavingsDollars;
      totalTokens += tokens;
      totalTurns += parsed.totalUsage.turnCount;

      results.push({
        project: decodeProjectPath(s.projectPath),
        cost: breakdown.totalCostDollars,
        waste: breakdown.estimatedSavingsDollars,
        tokens,
      });
    } catch {
      // Skip sessions that fail to parse
    }
  }

  if (json) {
    console.log(
      JSON.stringify({ sessions: results, totalCost, totalWaste, totalTokens, totalTurns }, null, 2),
    );
    return;
  }

  console.log(formatSummary(results, { totalCost, totalWaste, totalTokens, totalTurns }));
}
