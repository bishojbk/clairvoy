/**
 * clairvoy doctor — Diagnose token efficiency issues.
 */

import type { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { diagnoseAll } from "../../core/doctor/diagnostics.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose token efficiency issues across recent sessions")
    .option("-n, --limit <number>", "Number of sessions to scan", "20")
    .action((opts: { limit?: string }) => {
      const limit = parseInt(opts.limit || "20", 10);
      runDoctor(limit);
    });
}

function runDoctor(limit: number): void {
  const sessions = listSessions(limit);
  if (sessions.length === 0) {
    console.error("No sessions found.");
    process.exit(1);
  }

  console.log("");
  console.log(`${chalk.bold.cyan("  clairvoy doctor")}${chalk.dim(` \u2014 scanning ${sessions.length} sessions`)}`);
  console.log(chalk.dim("─".repeat(60)));
  console.log("");

  // Parse and classify all sessions
  const parsedSessions = [];
  const breakdowns = [];

  for (const s of sessions) {
    try {
      const parsed = parseSession(s.path);
      const breakdown = classifySession(parsed);
      parsedSessions.push(parsed);
      breakdowns.push(breakdown);
    } catch {
      // Skip unparseable
    }
  }

  // Check for CLAUDE.md in current directory
  const hasCLAUDEmd = existsSync(join(process.cwd(), "CLAUDE.md"));

  // Run diagnostics
  const diagnoses = diagnoseAll(parsedSessions, breakdowns, hasCLAUDEmd);

  if (diagnoses.length === 0) {
    console.log(chalk.green("  No issues found. Your token usage looks healthy."));
    console.log("");
    return;
  }

  // Render diagnoses
  const icons = { critical: chalk.red("!!"), warning: chalk.yellow(" !"), info: chalk.dim("  ") };

  let critCount = 0;
  let warnCount = 0;
  let infoCount = 0;

  for (const d of diagnoses) {
    if (d.severity === "critical") critCount++;
    else if (d.severity === "warning") warnCount++;
    else infoCount++;

    const icon = icons[d.severity];
    const titleColor = d.severity === "critical" ? chalk.red : d.severity === "warning" ? chalk.yellow : chalk.dim;

    console.log(`  ${icon} ${titleColor(d.title)}`);
    console.log(`     ${chalk.dim(d.detail)}`);
    console.log(`     ${chalk.cyan("Fix:")} ${d.prescription.action}`);
    if (d.prescription.claudeMdRule) {
      console.log(`     ${chalk.dim("Rule:")} ${d.prescription.claudeMdRule.split("\n")[0]}`);
    }
    console.log("");
  }

  // Summary
  console.log(chalk.dim("─".repeat(60)));
  const parts = [];
  if (critCount > 0) parts.push(chalk.red(`${critCount} critical`));
  if (warnCount > 0) parts.push(chalk.yellow(`${warnCount} warnings`));
  if (infoCount > 0) parts.push(chalk.dim(`${infoCount} info`));
  console.log(`  ${parts.join(", ")}`);
  console.log("");
  console.log(`  ${chalk.dim("Run")} ${chalk.cyan("clairvoy optimize")} ${chalk.dim("to auto-generate fixes")}`);
  console.log("");
}
