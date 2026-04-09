/**
 * clairvoy optimize -- Generate an optimized CLAUDE.md from your waste patterns.
 *
 * Flags:
 *   --install   Write CLAUDE.md and record installation timestamp
 *   --adapt     Compare before/after sessions and refine rules
 *   --write     (with --adapt) Actually overwrite the CLAUDE.md
 */

import type { Command } from "commander";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { scoreSession } from "../../core/analysis/scoring.js";
import { generateOptimization } from "../../core/optimizer/rule-engine.js";
import { generateAdaptation } from "../../core/optimizer/adapt-engine.js";
import { estimateTokens } from "../../core/constants.js";
import type { ClairvoyConfig } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getConfigPath(): string {
  return join(homedir(), ".clairvoy", "config.json");
}

function loadConfig(): ClairvoyConfig {
  const cfgPath = getConfigPath();
  if (!existsSync(cfgPath)) return {};
  try {
    return JSON.parse(readFileSync(cfgPath, "utf-8")) as ClairvoyConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: ClairvoyConfig): void {
  const cfgPath = getConfigPath();
  const dir = dirname(cfgPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(cfgPath, JSON.stringify(config, null, 2));
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerOptimizeCommand(program: Command): void {
  program
    .command("optimize")
    .description("Generate a CLAUDE.md optimized for your waste patterns")
    .option("-n, --limit <number>", "Number of sessions to analyze", "15")
    .option("--dry-run", "Show the CLAUDE.md without writing it")
    .option("-o, --output <path>", "Output path (default: ./CLAUDE.md)")
    .option("--install", "Write CLAUDE.md and record installation for tracking")
    .option("--adapt", "Compare before/after sessions and refine rules")
    .option("--write", "With --adapt, actually overwrite the CLAUDE.md")
    .action((opts: {
      limit?: string;
      dryRun?: boolean;
      output?: string;
      install?: boolean;
      adapt?: boolean;
      write?: boolean;
    }) => {
      if (opts.adapt) {
        runAdapt(!!opts.write, opts.output);
        return;
      }

      const limit = parseInt(opts.limit || "15", 10);
      runOptimize(limit, !!opts.dryRun, !!opts.install, opts.output);
    });
}

// ---------------------------------------------------------------------------
// optimize (original + --install)
// ---------------------------------------------------------------------------

function runOptimize(limit: number, dryRun: boolean, install: boolean, outputPath?: string): void {
  const sessions = listSessions(limit);
  if (sessions.length === 0) {
    console.error("No sessions found.");
    process.exit(1);
  }

  console.log("");
  console.log(`${chalk.bold.cyan("  clairvoy optimize")}${chalk.dim(` \u2014 analyzing ${sessions.length} sessions`)}`);
  console.log(chalk.dim("\u2500".repeat(60)));
  console.log("");

  // Parse and classify
  const breakdowns = [];
  for (const s of sessions) {
    try {
      const parsed = parseSession(s.path);
      const breakdown = classifySession(parsed);
      breakdowns.push(breakdown);
    } catch {
      // Skip
    }
  }

  if (breakdowns.length === 0) {
    console.error("  Could not parse any sessions.");
    process.exit(1);
  }

  // Generate optimization
  const report = generateOptimization(breakdowns, []);

  if (report.rules.length === 0) {
    console.log(chalk.green("  No optimization rules needed. Your sessions are already efficient."));
    console.log("");
    return;
  }

  // Show detected patterns -> rules
  console.log(chalk.bold("  Detected waste patterns:"));
  for (const rule of report.rules) {
    const conf = rule.confidence === "high" ? chalk.green("high") : rule.confidence === "medium" ? chalk.yellow("med") : chalk.dim("low");
    console.log(`  ${chalk.cyan("+")} ${rule.name} ${chalk.dim(`(~${rule.estimatedSavingsPercent}% savings, ${conf} confidence)`)}`);
  }
  console.log("");

  // Show the generated CLAUDE.md
  console.log(chalk.bold("  Generated CLAUDE.md") + chalk.dim(` (${report.claudeMdTokenCost} tokens/turn cost)`));
  console.log(chalk.dim(`  ${"─".repeat(56)}`));
  for (const line of report.claudeMdContent.split("\n")) {
    console.log(`  ${chalk.white(line)}`);
  }
  console.log(chalk.dim(`  ${"─".repeat(56)}`));
  console.log("");

  // Break-even info
  const avgTurns = Math.round(
    breakdowns.reduce((sum, b) => sum + b.session.totalUsage.turnCount, 0) / breakdowns.length,
  );
  const costPerSession = report.claudeMdTokenCost * avgTurns;
  console.log(chalk.dim(`  Rule cost: ~${report.claudeMdTokenCost} tokens/turn x ${avgTurns} avg turns = ~${costPerSession.toLocaleString()} tokens/session`));
  console.log(chalk.green(`  Estimated savings: ~${report.totalEstimatedSavings}% token reduction`));
  console.log(`  ${chalk.dim("Based on")} ${report.dataPoints} ${chalk.dim("analyzed sessions")}`);
  console.log("");

  if (dryRun) {
    console.log(chalk.dim("  --dry-run: not writing file"));
    console.log("");
    return;
  }

  // Write the file
  const target = outputPath || join(process.cwd(), "CLAUDE.md");
  const exists = existsSync(target);

  if (install) {
    // --install: write the file and record installation
    writeFileSync(target, report.claudeMdContent);
    console.log(chalk.green(`  Written to ${target}`));

    const config = loadConfig();
    config.claudeMdInstalledAt = new Date().toISOString();
    config.claudeMdPath = target;
    config.claudeMdHash = simpleHash(report.claudeMdContent);
    saveConfig(config);

    console.log(chalk.dim(`  Installation recorded at ${config.claudeMdInstalledAt}`));
    console.log("");
    console.log(chalk.cyan("  Run `clairvoy optimize --adapt` after a few sessions to see results."));
  } else if (exists) {
    console.log(chalk.yellow(`  ${target} already exists. Use --output to specify a different path.`));
    console.log(chalk.dim(`  Or copy the rules above into your existing CLAUDE.md.`));
    console.log(chalk.dim(`  Or use --install to overwrite and track changes.`));
  } else {
    writeFileSync(target, report.claudeMdContent);
    console.log(chalk.green(`  Written to ${target}`));
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// --adapt
// ---------------------------------------------------------------------------

function runAdapt(write: boolean, outputPath?: string): void {
  const config = loadConfig();

  if (!config.claudeMdInstalledAt) {
    console.error("No CLAUDE.md installation recorded. Run `clairvoy optimize --install` first.");
    process.exit(1);
  }

  const installedAt = config.claudeMdInstalledAt;
  const installedDate = new Date(installedAt);
  const bar = "\u2500".repeat(56);

  console.log("");
  console.log(`${chalk.bold.cyan("  clairvoy optimize --adapt")}${chalk.dim(" \u2014 measuring CLAUDE.md impact")}`);
  console.log(chalk.dim(`  ${bar}`));
  console.log(chalk.dim(`  Installed at: ${installedAt}`));
  console.log("");

  // Gather all sessions and split by timestamp
  const allSessions = listSessions(100);
  if (allSessions.length === 0) {
    console.error("  No sessions found.");
    process.exit(1);
  }

  const beforeSessions: Array<{ parsed: ReturnType<typeof parseSession>; breakdown: ReturnType<typeof classifySession>; score: ReturnType<typeof scoreSession> }> = [];
  const afterSessions: Array<{ parsed: ReturnType<typeof parseSession>; breakdown: ReturnType<typeof classifySession>; score: ReturnType<typeof scoreSession> }> = [];

  for (const s of allSessions) {
    try {
      const parsed = parseSession(s.path);
      const breakdown = classifySession(parsed);
      const score = scoreSession(parsed, breakdown);

      const sessionDate = parsed.startTime ? new Date(parsed.startTime) : s.modifiedAt;

      if (sessionDate < installedDate) {
        beforeSessions.push({ parsed, breakdown, score });
      } else {
        afterSessions.push({ parsed, breakdown, score });
      }
    } catch {
      // Skip
    }
  }

  if (beforeSessions.length === 0) {
    console.error("  No sessions found before CLAUDE.md installation.");
    process.exit(1);
  }

  if (afterSessions.length === 0) {
    console.error("  No sessions found after CLAUDE.md installation. Use Claude Code for a few sessions first.");
    process.exit(1);
  }

  console.log(chalk.dim(`  Found ${beforeSessions.length} sessions before, ${afterSessions.length} after installation`));
  console.log("");

  // Generate adaptation report
  const report = generateAdaptation(installedAt, beforeSessions, afterSessions);

  // Display proof
  console.log(chalk.bold("  BEFORE / AFTER COMPARISON"));
  console.log(`  ${chalk.dim(bar)}`);

  for (const p of report.proof) {
    const icon = p.improved ? chalk.green("\u2713") : chalk.red("\u2717");
    const label = p.metric.padEnd(20);
    const beforeStr = formatMetricValue(p.metric, p.before);
    const afterStr = formatMetricValue(p.metric, p.after);
    console.log(
      `  ${icon} ${chalk.white(label)} ${chalk.dim(beforeStr)} \u2192 ${chalk.white(afterStr)}  ${chalk.dim(p.change)}`,
    );
  }
  console.log("");

  // Rules kept
  if (report.rulesKept.length > 0) {
    console.log(chalk.bold("  RULES KEPT") + chalk.dim(" (working)"));
    for (const name of report.rulesKept) {
      console.log(`  ${chalk.green("+")} ${name}`);
    }
    console.log("");
  }

  // Rules removed
  if (report.rulesRemoved.length > 0) {
    console.log(chalk.bold("  RULES REMOVED") + chalk.dim(" (not helping)"));
    for (const r of report.rulesRemoved) {
      console.log(`  ${chalk.red("-")} ${r.name} ${chalk.dim(`(${r.reason})`)}`);
    }
    console.log("");
  }

  // Rules added
  if (report.rulesAdded.length > 0) {
    console.log(chalk.bold("  NEW RULES ADDED") + chalk.dim(" (new waste detected)"));
    for (const name of report.rulesAdded) {
      console.log(`  ${chalk.cyan("+")} ${name}`);
    }
    console.log("");
  }

  // Show updated CLAUDE.md
  console.log(chalk.bold("  UPDATED CLAUDE.md"));
  console.log(`  ${chalk.dim(bar)}`);
  for (const line of report.updatedClaudeMdContent.split("\n")) {
    console.log(`  ${chalk.white(line)}`);
  }
  console.log(`  ${chalk.dim(bar)}`);
  console.log("");

  if (write) {
    const target = outputPath || config.claudeMdPath || join(process.cwd(), "CLAUDE.md");
    writeFileSync(target, report.updatedClaudeMdContent);
    console.log(chalk.green(`  Updated CLAUDE.md written to ${target}`));

    // Update config
    config.claudeMdInstalledAt = new Date().toISOString();
    config.claudeMdHash = simpleHash(report.updatedClaudeMdContent);
    config.claudeMdPath = target;
    saveConfig(config);

    console.log(chalk.dim(`  Installation timestamp updated.`));
  } else {
    console.log(chalk.dim("  Use --write to apply the updated CLAUDE.md"));
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMetricValue(metric: string, value: number): string {
  if (metric.includes("cost")) return `$${value.toFixed(2)}`;
  if (metric.includes("%")) return `${value.toFixed(1)}%`;
  if (metric.includes("Score")) return `${value}`;
  return `${value.toFixed(1)}`;
}
