/**
 * clairvoy trends -- Historical cost analysis across sessions.
 */

import chalk from "chalk";
import type { Command } from "commander";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { scoreSession } from "../../core/analysis/scoring.js";
import { aggregateTrends } from "../../core/trends/aggregator.js";
import type { TrendReport, DailyUsage, ProjectUsage } from "../../core/trends/aggregator.js";
import { makeBar } from "../util/format.js";

export function registerTrendsCommand(program: Command): void {
  program
    .command("trends")
    .description("Show historical cost trends across sessions")
    .option("--days <number>", "How many days back to analyze", "14")
    .option("--json", "Output as JSON")
    .action((opts: { days?: string; json?: boolean }) => {
      const days = parseInt(opts.days || "14", 10);

      const sessions = listSessions(500);
      if (sessions.length === 0) {
        console.error("No sessions found. Use Claude Code first, then try again.");
        process.exit(1);
      }

      const analyzed: Array<{
        parsed: ReturnType<typeof parseSession>;
        breakdown: ReturnType<typeof classifySession>;
        score: ReturnType<typeof scoreSession>;
      }> = [];

      for (const s of sessions) {
        try {
          const parsed = parseSession(s.path);
          const breakdown = classifySession(parsed);
          const score = scoreSession(parsed, breakdown);
          analyzed.push({ parsed, breakdown, score });
        } catch {
          // Skip sessions that fail to parse
        }
      }

      if (analyzed.length === 0) {
        console.error("No sessions could be analyzed.");
        process.exit(1);
      }

      const report = aggregateTrends(analyzed, days);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(renderTrends(report, days));
      }
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTrends(report: TrendReport, days: number): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(
    `${chalk.bold.cyan("  clairvoy")}${chalk.dim(` \u2014 trends (last ${days} days)`)}`,
  );
  lines.push(chalk.dim("  " + "\u2500".repeat(54)));

  // Summary
  lines.push("");
  lines.push(
    `  ${chalk.bold("Total:")}    ${chalk.green("$" + report.totalCost.toFixed(2))} across ${report.totalSessions} sessions`,
  );
  lines.push(
    `  ${chalk.bold("Avg/day:")}  ${chalk.yellow("$" + report.avgCostPerDay.toFixed(2))}    ${chalk.bold("Avg/session:")} ${chalk.yellow("$" + report.avgCostPerSession.toFixed(2))}`,
  );

  // Daily spend
  if (report.daily.length > 0) {
    lines.push("");
    lines.push(`  ${chalk.bold("Daily spend:")}`);

    const maxDailyCost = Math.max(...report.daily.map((d) => d.totalCost));

    for (const day of report.daily) {
      lines.push(formatDailyRow(day, maxDailyCost));
    }
  }

  // By project
  if (report.byProject.length > 0) {
    lines.push("");
    lines.push(`  ${chalk.bold("By project:")}`);

    for (const proj of report.byProject) {
      lines.push(formatProjectRow(proj));
    }
  }

  lines.push("");
  lines.push(chalk.dim("  " + "\u2500".repeat(54)));
  lines.push("");

  return lines.join("\n");
}

function formatDailyRow(day: DailyUsage, maxCost: number): string {
  const dateLabel = formatShortDate(day.date);
  const barPercent = maxCost > 0 ? (day.totalCost / maxCost) * 100 : 0;
  const barWidth = 20;
  const filled = Math.max(1, Math.round((barPercent / 100) * barWidth));
  const bar = chalk.cyan("\u2588".repeat(filled));
  const cost = chalk.green("$" + day.totalCost.toFixed(2));
  const sessions = chalk.dim(`(${day.sessions} session${day.sessions !== 1 ? "s" : ""})`);

  return `  ${dateLabel}  ${bar} ${cost}    ${sessions}`;
}

function formatProjectRow(proj: ProjectUsage): string {
  const name = shortenPath(proj.project).padEnd(30);
  const cost = chalk.green("$" + proj.totalCost.toFixed(2)).padStart(10);
  const pct = chalk.dim(`(${proj.percentOfTotal}%)`).padStart(6);
  const bar = makeBar(proj.percentOfTotal, 20);

  return `  ${name} ${cost}  ${pct}  ${chalk.cyan(bar)}`;
}

function formatShortDate(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2);
  return `${month} ${day}`;
}

function shortenPath(projectPath: string): string {
  // Replace home directory with ~
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && projectPath.startsWith(home)) {
    return "~" + projectPath.slice(home.length);
  }
  return projectPath;
}
