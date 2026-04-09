/**
 * clairvoy guard / unguard — Install or remove guard hooks.
 *
 * Manages the PostToolUse hook in Claude Code's settings.json
 * that triggers clairvoy pulse on every tool call.
 */

import type { Command } from "commander";
import chalk from "chalk";

export function registerGuardCommand(program: Command): void {
  // ---------- clairvoy guard ----------
  program
    .command("guard")
    .description("Install clairvoy guard hooks into Claude Code")
    .option("--dry-run", "Show what would be written without writing")
    .option("--budget <dollars>", "Set session budget cap in dollars (e.g. --budget 10)")
    .action(async (opts) => {
      const {
        readClaudeSettings,
        writeClaudeSettings,
        backupSettings,
        installGuardHooks,
        isGuardInstalled,
      } = await import("../../core/guard/hooks-manager.js");
      const { loadConfig, saveConfig } = await import(
        "../../store/config-store.js"
      );

      const settings = readClaudeSettings();

      if (isGuardInstalled(settings)) {
        console.log(
          chalk.yellow("⚠ Guard hooks are already installed."),
        );
        return;
      }

      const updated = installGuardHooks(settings);

      if (opts.dryRun) {
        console.log(chalk.blue("Dry run — would write to settings.json:"));
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      // Backup, then write
      const backupPath = backupSettings();
      writeClaudeSettings(updated);

      // Update clairvoy config
      const config = loadConfig();
      config.guardInstalled = true;
      config.guardInstalledAt = new Date().toISOString();
      config.settingsBackupPath = backupPath;

      // Set budget if provided
      if (opts.budget) {
        const budget = parseFloat(opts.budget);
        if (!isNaN(budget) && budget > 0) {
          config.budgetDollars = budget;
          config.thresholds = config.thresholds || {} as any;
          config.thresholds!.budgetDollars = budget;
        }
      }

      saveConfig(config);

      console.log(chalk.green("✓ Guard hooks installed successfully."));
      console.log();
      console.log(
        `  ${chalk.bold("PostToolUse hook")} added: ${chalk.cyan("clairvoy pulse")}`,
      );
      console.log(
        `  Settings backed up to: ${chalk.dim(backupPath)}`,
      );
      if (config.budgetDollars) {
        console.log(
          `  ${chalk.bold("Budget cap:")} ${chalk.yellow("$" + config.budgetDollars.toFixed(2))} per session`,
        );
      }
      console.log();
      console.log(
        chalk.dim("clairvoy will now monitor context size, cost, and file re-reads."),
      );
    });

  // ---------- clairvoy unguard ----------
  program
    .command("unguard")
    .description("Remove clairvoy guard hooks from Claude Code")
    .action(async () => {
      const {
        readClaudeSettings,
        writeClaudeSettings,
        removeGuardHooks,
        isGuardInstalled,
      } = await import("../../core/guard/hooks-manager.js");
      const { loadConfig, saveConfig } = await import(
        "../../store/config-store.js"
      );

      const settings = readClaudeSettings();

      if (!isGuardInstalled(settings)) {
        console.log(chalk.yellow("⚠ Guard hooks are not currently installed."));
        return;
      }

      const updated = removeGuardHooks(settings);
      writeClaudeSettings(updated);

      // Update clairvoy config
      const config = loadConfig();
      config.guardInstalled = false;
      saveConfig(config);

      console.log(chalk.green("✓ Guard hooks removed successfully."));
      console.log(
        chalk.dim("clairvoy will no longer monitor sessions automatically."),
      );
    });
}
