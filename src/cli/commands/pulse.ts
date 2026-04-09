/**
 * clairvoy pulse — Hook handler entry point.
 *
 * Called by Claude Code's PostToolUse hook. Hidden from --help.
 * Uses dynamic imports to keep cold start fast.
 */

import type { Command } from "commander";

export function registerPulseCommand(program: Command): void {
  program
    .command("pulse", { hidden: true })
    .description("Run pulse check (hook handler)")
    .action(async () => {
      try {
        const { loadConfig, loadPulseState, savePulseState } = await import(
          "../../store/config-store.js"
        );
        const { runPulse } = await import("../../core/guard/pulse-engine.js");
        const { listSessions } = await import(
          "../../core/parser/session-discovery.js"
        );

        // Find most recent session
        const sessions = listSessions(1);
        if (sessions.length === 0) {
          process.exit(0);
        }

        const session = sessions[0];
        const config = loadConfig();
        const thresholds = config.thresholds!;

        // Load previous state for this session
        const previousState = loadPulseState(session.sessionId);

        // Run pulse engine
        const result = runPulse(session.path, previousState, thresholds);

        // Save updated state
        savePulseState(session.sessionId, result.state);

        // Emit warnings to stdout (if any)
        for (const warning of result.warnings) {
          process.stdout.write(warning + "\n");
        }

        // Always emit status line (compact inline cost display)
        if (result.warnings.length === 0 && result.state.turnCount > 0) {
          process.stdout.write(result.statusLine + "\n");
        }

        process.exit(0);
      } catch {
        // Never fail — always exit 0
        process.exit(0);
      }
    });
}
