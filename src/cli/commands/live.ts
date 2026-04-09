/**
 * clairvoy live -- Real-time session monitoring dashboard.
 *
 * Watches the most recent JSONL session file and displays
 * a continuously updated cost/token dashboard.
 */

import type { Command } from "commander";
import { watch, type FSWatcher } from "node:fs";
import chalk from "chalk";
import { IncrementalParser } from "../../core/parser/incremental-parser.js";
import { listSessions } from "../../core/parser/session-discovery.js";
import { getPricing, calculateCost } from "../../core/constants.js";
import { decodeProjectPath, makeBar } from "../util/format.js";

export function registerLiveCommand(program: Command): void {
  program
    .command("live")
    .description("Monitor the current Claude Code session in real time")
    .action(() => {
      runLive();
    });
}

function runLive(): void {
  const sessions = listSessions(1);
  if (sessions.length === 0) {
    console.error(chalk.red("No Claude Code sessions found."));
    process.exit(1);
  }

  const session = sessions[0];
  const parser = new IncrementalParser(session.path);

  // Initial read
  parser.update();
  render(parser, session.sessionId, session.projectPath);

  // Watch for file changes
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(session.path, () => {
      if (parser.update()) {
        render(parser, session.sessionId, session.projectPath);
      }
    });
  } catch {
    // fs.watch may not work on all platforms; fall back to polling only
  }

  // Fallback polling interval in case fs.watch misses events
  const interval = setInterval(() => {
    if (parser.update()) {
      render(parser, session.sessionId, session.projectPath);
    }
  }, 2000);

  // Graceful shutdown
  const cleanup = (): void => {
    clearInterval(interval);
    if (watcher) {
      watcher.close();
    }
    // Show cursor and move below the dashboard
    process.stdout.write("\x1b[?25h\n");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Hide cursor while dashboard is active
  process.stdout.write("\x1b[?25l");
}

function render(
  parser: IncrementalParser,
  sessionId: string,
  projectPathEncoded: string,
): void {
  const pricing = getPricing(parser.model);

  const usage = {
    totalInputTokens: parser.totalInput,
    totalOutputTokens: parser.totalOutput,
    totalCacheCreationTokens: parser.totalCacheWrite,
    totalCacheReadTokens: parser.totalCacheRead,
  };

  const totalCost = calculateCost(usage, pricing);
  const totalTokens =
    parser.totalInput +
    parser.totalOutput +
    parser.totalCacheRead +
    parser.totalCacheWrite;

  // Cost breakdown per category
  const inputCost = (parser.totalInput / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (parser.totalOutput / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (parser.totalCacheRead / 1_000_000) * pricing.cacheReadPerMillion;
  const cacheWriteCost = (parser.totalCacheWrite / 1_000_000) * pricing.cacheWritePerMillion;

  const pct = (v: number): number => (totalCost > 0 ? (v / totalCost) * 100 : 0);

  const cacheReadPct = pct(cacheReadCost);
  const cacheWritePct = pct(cacheWriteCost);
  const outputPct = pct(outputCost);
  const inputPct = pct(inputCost);

  const barWidth = 20;
  const avgPerTurn = parser.turnCount > 0 ? totalCost / parser.turnCount : 0;

  const contextTokens = parser.totalInput + parser.totalCacheRead + parser.totalCacheWrite;
  const contextK = (contextTokens / 1000).toFixed(0);

  const projectPath = decodeProjectPath(projectPathEncoded);
  const shortSession = sessionId.length > 12 ? sessionId.slice(0, 12) + "..." : sessionId;

  const line = chalk.dim("\u2500".repeat(56));

  const lines = [
    "",
    `  ${chalk.bold.cyan("clairvoy")} ${chalk.dim("\u2014")} ${chalk.bold("LIVE")}`,
    `  ${line}`,
    `  ${chalk.dim("Session:")}  ${shortSession}`,
    `  ${chalk.dim("Project:")}  ${projectPath}`,
    `  ${chalk.dim("Model:")}    ${chalk.yellow(parser.model)}`,
    "",
    `  ${chalk.dim("Cost:")}     ${chalk.bold.green("$" + totalCost.toFixed(2))}        ${chalk.dim("Tokens:")} ${totalTokens.toLocaleString()}`,
    `  ${chalk.dim("Turns:")}    ${String(parser.turnCount).padEnd(14)}${chalk.dim("Tool calls:")} ${parser.toolCallCount}`,
    "",
    `  ${chalk.dim("Cache read:")}   ${fmtCost(cacheReadCost)}  ${fmtPct(cacheReadPct)}   ${chalk.green(makeBar(cacheReadPct, barWidth))}`,
    `  ${chalk.dim("Cache write:")}  ${fmtCost(cacheWriteCost)}  ${fmtPct(cacheWritePct)}   ${chalk.yellow(makeBar(cacheWritePct, barWidth))}`,
    `  ${chalk.dim("Output:")}       ${fmtCost(outputCost)}  ${fmtPct(outputPct)}   ${chalk.magenta(makeBar(outputPct, barWidth))}`,
    `  ${chalk.dim("Input:")}        ${fmtCost(inputCost)}  ${fmtPct(inputPct)}   ${chalk.blue(makeBar(inputPct, barWidth))}`,
    "",
    `  ${chalk.dim("Context:")}  ${contextK}K tokens   ${chalk.dim("Avg $/turn:")} $${avgPerTurn.toFixed(2)}`,
    `  ${line}`,
    `  ${chalk.dim("Watching... (Ctrl+C to stop)")}`,
    "",
  ];

  // Clear screen and move cursor home, then write the dashboard
  process.stdout.write("\x1b[H\x1b[2J" + lines.join("\n"));
}

/** Format a dollar amount right-aligned to 7 chars */
function fmtCost(cost: number): string {
  return ("$" + cost.toFixed(2)).padStart(7);
}

/** Format a percentage right-aligned in parens */
function fmtPct(pct: number): string {
  return `(${pct.toFixed(0).padStart(2)}%)`;
}
