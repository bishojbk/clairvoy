/**
 * clairvoy score — Efficiency scoring for a session.
 */

import chalk from "chalk";
import type { Command } from "commander";
import type { EfficiencyGrade } from "../../core/types.js";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { scoreSession } from "../../core/analysis/scoring.js";
import { makeBar } from "../util/format.js";

export function registerScoreCommand(program: Command): void {
  program
    .command("score [session]")
    .description("Show efficiency score for a session (default: most recent)")
    .option("--json", "Output as JSON")
    .action((sessionArg: string | undefined, opts: { json?: boolean }) => {
      const sessionPath = resolveSessionPath(sessionArg);
      if (!sessionPath) {
        console.error("No session found. Run `clairvoy list` to see available sessions.");
        process.exit(1);
      }

      try {
        const parsed = parseSession(sessionPath);
        const breakdown = classifySession(parsed);
        const score = scoreSession(parsed, breakdown);

        if (opts.json) {
          console.log(JSON.stringify(score, null, 2));
        } else {
          console.log(renderScoreCard(score));
        }
      } catch (err) {
        console.error(`Error scoring session: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function resolveSessionPath(arg?: string): string | null {
  const sessions = listSessions(50);
  if (sessions.length === 0) return null;

  if (!arg) return sessions[0].path;

  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
    return sessions[idx - 1].path;
  }

  const match = sessions.find((s) => s.sessionId.startsWith(arg));
  if (match) return match.path;

  return arg;
}

function gradeColor(grade: EfficiencyGrade): (text: string) => string {
  if (grade === "S" || grade === "A") return chalk.green;
  if (grade === "B") return chalk.cyan;
  if (grade === "C") return chalk.yellow;
  return chalk.red;
}

function renderScoreCard(
  score: ReturnType<typeof scoreSession>,
): string {
  const lines: string[] = [];
  const color = gradeColor(score.overall);

  // Header
  lines.push("");
  lines.push(`${chalk.bold.cyan("  clairvoy")}${chalk.dim(" \u2014 efficiency score")}`);
  lines.push(chalk.dim("  " + "\u2500".repeat(54)));

  // Overall score
  lines.push("");
  lines.push(`         ${chalk.bold("YOUR SCORE:")}  ${color(chalk.bold(score.overall))}`);
  lines.push(`         ${color(makeBar(score.numericScore, 10))}  ${score.numericScore}/100`);

  // Breakdown
  lines.push("");
  lines.push(`  ${chalk.bold("Breakdown:")}`);
  lines.push(chalk.dim("  " + "\u2500".repeat(54)));

  for (const dim of score.dimensions) {
    const dColor = gradeColor(dim.grade);
    const label = `${dim.name}:`.padEnd(24);
    const gradeStr = dim.grade.padEnd(4);
    const pctStr = `${dim.score}%`.padStart(4);
    const bar = makeBar(dim.score, 24);
    const weightStr = `(${Math.round(dim.weight * 100)}%)`;
    lines.push(
      `  ${label}${dColor(gradeStr)}${pctStr}  ${dColor(bar)}  ${chalk.dim(weightStr)}`,
    );
  }

  // Achievements
  const unlocked = score.achievements.filter((a) => a.unlocked);
  if (unlocked.length > 0) {
    lines.push("");
    lines.push(`  ${chalk.bold("Achievements:")}`);
    lines.push(chalk.dim("  " + "\u2500".repeat(54)));
    for (const a of unlocked) {
      lines.push(`  ${chalk.green("*")} ${chalk.bold(a.name)} ${chalk.dim("\u2014 " + a.description)}`);
    }
  }

  lines.push("");
  lines.push(chalk.dim("  " + "\u2500".repeat(54)));
  lines.push("");

  return lines.join("\n");
}
