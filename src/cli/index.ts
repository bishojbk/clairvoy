#!/usr/bin/env node

/**
 * clairvoy CLI
 *
 * AI coding cost optimizer — cut Claude Code spending 20-40% with data-driven CLAUDE.md rules.
 */

import { Command } from "commander";
import { registerListCommand } from "./commands/list.js";
import { registerAnalyzeCommand } from "./commands/analyze.js";
import { registerScoreCommand } from "./commands/score.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerOptimizeCommand } from "./commands/optimize.js";
import { registerTipsCommand } from "./commands/tips.js";
import { registerLiveCommand } from "./commands/live.js";
import { registerTrendsCommand } from "./commands/trends.js";
import { registerCompareCommand } from "./commands/compare.js";
import { registerExportCommand } from "./commands/export.js";
import { registerBenchmarkCommand } from "./commands/benchmark.js";
import { registerGuardCommand } from "./commands/guard.js";
import { registerPulseCommand } from "./commands/pulse.js";
import { registerReplayCommand } from "./commands/replay.js";
import { registerCoachCommand } from "./commands/coach.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerQuickfixCommand } from "./commands/quickfix.js";
import { runQuickScan } from "./commands/quickscan.js";

const program = new Command();

program
  .name("clairvoy")
  .description("AI coding cost optimizer — cut Claude Code spending 20-40% with data-driven CLAUDE.md rules")
  .version("0.1.0");

// Register commands
registerListCommand(program);
registerAnalyzeCommand(program);
registerScoreCommand(program);
registerDoctorCommand(program);
registerOptimizeCommand(program);
registerTipsCommand(program);
registerLiveCommand(program);
registerTrendsCommand(program);
registerCompareCommand(program);
registerExportCommand(program);
registerBenchmarkCommand(program);
registerGuardCommand(program);
registerPulseCommand(program);
registerReplayCommand(program);
registerCoachCommand(program);
registerDemoCommand(program);
registerQuickfixCommand(program);

// Default action: quick scan when no command given
const args = process.argv.slice(2);
const hasCommand = args.length > 0 && !args[0].startsWith("-");
const hasHelpOrVersion = args.includes("--help") || args.includes("-h") || args.includes("--version") || args.includes("-V");

if (args.length === 0 || (!hasCommand && !hasHelpOrVersion)) {
  runQuickScan();
} else {
  program.parse();
}
