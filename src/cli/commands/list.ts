/**
 * clairvoy list — List recent Claude Code sessions.
 */

import type { Command } from "commander";
import { listSessions } from "../../core/parser/session-discovery.js";
import { formatSessionList } from "../renderers/report-renderer.js";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description("List recent Claude Code sessions")
    .option("-n, --limit <number>", "Number of sessions to show", "15")
    .action((opts) => {
      const limit = parseInt(opts.limit, 10);
      const sessions = listSessions(limit);
      console.log(formatSessionList(sessions));
    });
}
