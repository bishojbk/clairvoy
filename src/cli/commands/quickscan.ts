/**
 * Quick Scan — default action when clairvoy is run with no command.
 *
 * Shows a fast overview: total spend, top waste, and a suggestion.
 * Goal: immediately useful, no flags needed, under 2 seconds.
 */

import chalk from "chalk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listSessions, getProjectsDir } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { scoreSession } from "../../core/analysis/scoring.js";
import { diagnoseAll } from "../../core/doctor/diagnostics.js";
import { decodeProjectPath } from "../util/format.js";

export function runQuickScan(): void {
  const projectsDir = getProjectsDir();
  if (!existsSync(projectsDir)) {
    console.log("");
    console.log(chalk.bold.cyan("  clairvoy") + chalk.dim(" — AI coding cost optimizer"));
    console.log("");
    console.log(chalk.yellow("  No Claude Code sessions found."));
    console.log(chalk.dim("  Use Claude Code first, then run clairvoy to analyze your spending."));
    console.log(chalk.dim("  Sessions are stored at ~/.claude/projects/"));
    console.log("");
    console.log(chalk.dim("  Run ") + chalk.cyan("clairvoy --help") + chalk.dim(" for all commands."));
    console.log("");
    return;
  }

  const sessions = listSessions(10);
  if (sessions.length === 0) {
    console.log("");
    console.log(chalk.bold.cyan("  clairvoy") + chalk.dim(" — AI coding cost optimizer"));
    console.log("");
    console.log(chalk.yellow("  No session logs found."));
    console.log(chalk.dim("  Start a Claude Code session, then run clairvoy."));
    console.log("");
    return;
  }

  // Parse and classify recent sessions
  const parsed = [];
  const breakdowns = [];
  let totalCost = 0;
  let totalWaste = 0;
  let totalSessions = 0;

  for (const s of sessions) {
    try {
      const p = parseSession(s.path);
      const b = classifySession(p);
      parsed.push(p);
      breakdowns.push(b);
      totalCost += b.totalCostDollars;
      totalWaste += b.estimatedSavingsPercent;
      totalSessions++;
    } catch {
      // Skip unparseable
    }
  }

  if (totalSessions === 0) {
    console.log("");
    console.log(chalk.bold.cyan("  clairvoy") + chalk.dim(" — AI coding cost optimizer"));
    console.log(chalk.yellow("  Could not parse any sessions."));
    console.log("");
    return;
  }

  const avgWaste = Math.round(totalWaste / totalSessions * 10) / 10;
  const avgCost = Math.round(totalCost / totalSessions * 100) / 100;
  const hasCLAUDEmd = existsSync(join(process.cwd(), "CLAUDE.md"));

  // Run diagnostics for top issue
  const diagnoses = diagnoseAll(parsed, breakdowns, hasCLAUDEmd);
  const topIssue = diagnoses[0];

  // Score the most recent session
  let recentGrade = "";
  if (parsed.length > 0) {
    try {
      const score = scoreSession(parsed[0], breakdowns[0]);
      recentGrade = score.overall;
    } catch {
      // Skip
    }
  }

  // Find top spending project
  const projectCosts = new Map<string, number>();
  for (let i = 0; i < parsed.length; i++) {
    const proj = decodeProjectPath(sessions[i].projectPath);
    const cost = breakdowns[i].totalCostDollars;
    projectCosts.set(proj, (projectCosts.get(proj) || 0) + cost);
  }
  const topProject = [...projectCosts.entries()].sort((a, b) => b[1] - a[1])[0];

  // Render
  console.log("");
  console.log(chalk.bold.cyan("  clairvoy") + chalk.dim(" — quick scan"));
  console.log(chalk.dim("─".repeat(60)));
  console.log("");

  // Stats row
  console.log(`  ${chalk.bold("Last " + totalSessions + " sessions")}${chalk.dim(":")}`);
  console.log(`    Total spend     ${chalk.bold.white("$" + totalCost.toFixed(2))}`);
  console.log(`    Avg per session ${chalk.white("$" + avgCost.toFixed(2))}`);
  console.log(`    Avg waste       ${avgWaste > 5 ? chalk.red(avgWaste + "%") : chalk.green(avgWaste + "%")}`);
  if (recentGrade) {
    const gradeColor = recentGrade === "S" || recentGrade === "A" ? chalk.green
      : recentGrade === "B" || recentGrade === "C" ? chalk.yellow
      : chalk.red;
    console.log(`    Latest grade    ${gradeColor(recentGrade)}`);
  }
  if (topProject) {
    console.log(`    Top spender     ${chalk.dim(topProject[0])} ${chalk.white("$" + topProject[1].toFixed(2))}`);
  }
  console.log("");

  // Top issue
  if (topIssue) {
    const icon = topIssue.severity === "critical" ? chalk.red("!!") : chalk.yellow(" !");
    console.log(`  ${icon} ${chalk.bold("Top issue:")} ${topIssue.title}`);
    console.log(`     ${chalk.cyan("Fix:")} ${topIssue.prescription.action}`);
    console.log("");
  }

  // Suggestion
  console.log(chalk.dim("─".repeat(60)));
  if (!hasCLAUDEmd) {
    console.log(`  ${chalk.cyan(">")} Run ${chalk.bold.cyan("clairvoy optimize --install")} to generate a CLAUDE.md`);
    console.log(chalk.dim("    Could save ~" + Math.min(avgWaste * 2, 40).toFixed(0) + "% on future sessions"));
  } else if (avgWaste > 5) {
    console.log(`  ${chalk.cyan(">")} Run ${chalk.bold.cyan("clairvoy optimize --adapt")} to refine your rules`);
    console.log(chalk.dim("    Measures what's working and tunes your CLAUDE.md"));
  } else {
    console.log(`  ${chalk.green(">")} Your sessions look efficient. Run ${chalk.cyan("clairvoy doctor")} for a deeper check.`);
  }
  console.log("");
  console.log(chalk.dim("  Run ") + chalk.cyan("clairvoy --help") + chalk.dim(" for all commands."));
  console.log("");
}
