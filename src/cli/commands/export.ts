/**
 * clairvoy export — Export session data as CSV, JSON, or HTML.
 */

import { writeFileSync } from "node:fs";
import chalk from "chalk";
import type { Command } from "commander";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { scoreSession } from "../../core/analysis/scoring.js";
import { sessionsToCSV } from "../../core/export/csv.js";
import { sessionsToJSON } from "../../core/export/json-export.js";
import { sessionsToHTML } from "../../core/export/html.js";

type ExportFormat = "csv" | "json" | "html";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export session data as CSV, JSON, or HTML")
    .option("--format <type>", "Output format: csv, json, or html", "csv")
    .option("-o, --output <path>", "Output file path (default: stdout for csv/json, clairvoy-report.html for html)")
    .option("-n, --limit <number>", "Number of sessions to export", "20")
    .action((opts: { format: string; output?: string; limit: string }) => {
      const format = opts.format.toLowerCase() as ExportFormat;
      if (!["csv", "json", "html"].includes(format)) {
        console.error(chalk.red(`Invalid format: ${opts.format}. Use csv, json, or html.`));
        process.exit(1);
      }

      const limit = parseInt(opts.limit, 10);
      const sessions = listSessions(limit);

      if (sessions.length === 0) {
        console.error(chalk.red("No sessions found."));
        process.exit(1);
      }

      // Parse, classify, and score each session
      const analyzed: Array<{
        parsed: ReturnType<typeof parseSession>;
        breakdown: ReturnType<typeof classifySession>;
        score: ReturnType<typeof scoreSession>;
      }> = [];

      let skipped = 0;
      for (const s of sessions) {
        try {
          const parsed = parseSession(s.path);
          const breakdown = classifySession(parsed);
          const score = scoreSession(parsed, breakdown);
          analyzed.push({ parsed, breakdown, score });
        } catch {
          skipped++;
        }
      }

      if (analyzed.length === 0) {
        console.error(chalk.red("No sessions could be parsed."));
        process.exit(1);
      }

      // Generate output
      let content: string;
      if (format === "csv") {
        content = sessionsToCSV(analyzed);
      } else if (format === "json") {
        content = sessionsToJSON(analyzed);
      } else {
        content = sessionsToHTML(analyzed);
      }

      // Determine output destination
      const outputPath = opts.output ?? (format === "html" ? "clairvoy-report.html" : undefined);

      if (outputPath) {
        writeFileSync(outputPath, content, "utf-8");
        console.log(
          chalk.green(`Exported ${analyzed.length} sessions to ${chalk.bold(outputPath)}`) +
            (skipped > 0 ? chalk.dim(` (${skipped} skipped)`) : ""),
        );
      } else {
        process.stdout.write(content);
      }
    });
}
