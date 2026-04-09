/**
 * clairvoy tips — Quick personalized tips based on your worst habits.
 */

import type { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { diagnoseAll } from "../../core/doctor/diagnostics.js";

export function registerTipsCommand(program: Command): void {
  program
    .command("tips")
    .description("Show personalized tips to reduce token waste")
    .action(() => {
      runTips();
    });
}

function runTips(): void {
  const sessions = listSessions(15);
  if (sessions.length === 0) {
    console.error("No sessions found.");
    process.exit(1);
  }

  const parsedSessions = [];
  const breakdowns = [];

  for (const s of sessions) {
    try {
      const parsed = parseSession(s.path);
      const breakdown = classifySession(parsed);
      parsedSessions.push(parsed);
      breakdowns.push(breakdown);
    } catch {
      // Skip
    }
  }

  const hasCLAUDEmd = existsSync(join(process.cwd(), "CLAUDE.md"));
  const diagnoses = diagnoseAll(parsedSessions, breakdowns, hasCLAUDEmd);

  console.log("");
  console.log(`${chalk.bold.cyan("  clairvoy tips")}${chalk.dim(" \u2014 based on your last " + parsedSessions.length + " sessions")}`);
  console.log(chalk.dim("─".repeat(60)));
  console.log("");

  if (diagnoses.length === 0) {
    console.log(chalk.green("  Looking good! No major issues detected."));
    console.log("");
    return;
  }

  // Show top 5 most impactful tips
  const top = diagnoses.slice(0, 5);

  for (let i = 0; i < top.length; i++) {
    const d = top[i];
    const num = chalk.cyan(`${i + 1}.`);
    const sev = d.severity === "critical" ? chalk.red("[critical]")
      : d.severity === "warning" ? chalk.yellow("[warning]")
      : chalk.dim("[tip]");

    console.log(`  ${num} ${sev} ${d.prescription.action}`);
    console.log(`     ${chalk.dim(d.title)}`);
    console.log("");
  }

  console.log(chalk.dim("─".repeat(60)));
  console.log(`  ${chalk.dim("Run")} ${chalk.cyan("clairvoy doctor")} ${chalk.dim("for full diagnostics")}`);
  console.log(`  ${chalk.dim("Run")} ${chalk.cyan("clairvoy optimize")} ${chalk.dim("to auto-generate CLAUDE.md")}`);
  console.log("");
}
