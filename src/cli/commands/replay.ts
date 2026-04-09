/**
 * clairvoy replay — Session replay timeline.
 *
 * Shows a chronological view of what happened in a session,
 * with cost tracking, context growth, and hotspot detection.
 */

import type { Command } from "commander";
import chalk from "chalk";
import type { SessionTimeline, TimelineEvent } from "../../core/types.js";
import { listSessions } from "../../core/parser/session-discovery.js";
import { parseSession } from "../../core/parser/session-parser.js";
import { classifySession } from "../../core/analysis/classifier.js";
import { buildTimeline } from "../../core/analysis/timeline.js";
import { decodeProjectPath, getDuration } from "../util/format.js";

export function registerReplayCommand(program: Command): void {
  program
    .command("replay [session]")
    .description("Replay a session as a timeline (default: most recent)")
    .option("--json", "Output raw SessionTimeline as JSON")
    .action((sessionArg: string | undefined, opts: { json?: boolean }) => {
      const sessionPath = resolveSessionPath(sessionArg);
      if (!sessionPath) {
        console.error(
          "No session found. Run `clairvoy list` to see available sessions.",
        );
        process.exit(1);
      }

      try {
        const parsed = parseSession(sessionPath);
        const breakdown = classifySession(parsed);
        const timeline = buildTimeline(parsed, breakdown);

        if (opts.json) {
          console.log(JSON.stringify(timeline, null, 2));
        } else {
          console.log(renderTimeline(timeline));
        }
      } catch (err) {
        console.error(`Error replaying session: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// Session resolution (same pattern as analyze / score)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Text renderer
// ---------------------------------------------------------------------------

function renderTimeline(tl: SessionTimeline): string {
  const lines: string[] = [];
  const sep = "\u2500".repeat(54);

  // Header
  lines.push("");
  lines.push(
    `  ${chalk.bold.cyan("clairvoy")}${chalk.dim(" \u2014 session replay")}`,
  );
  lines.push(chalk.dim(`  ${sep}`));

  const shortId = tl.sessionId.slice(0, 8);
  const project = decodeProjectPath(tl.projectPath);
  const duration = getDuration(tl.startTime, tl.endTime);
  const cost = `$${tl.totalCostDollars.toFixed(2)}`;

  lines.push(
    `  Session: ${chalk.bold(shortId)}    Project: ${chalk.bold(project)}`,
  );
  lines.push(
    `  Duration: ${chalk.bold(duration)}     Cost: ${chalk.bold(cost)}`,
  );
  lines.push("");

  // Build a set of cost-spike turn indices for annotation
  const spikeTurns = new Map<number, string>();
  for (const ev of tl.events) {
    if (ev.type === "cost_spike") {
      spikeTurns.set(ev.turnIndex, ev.label);
    }
  }

  // Group non-spike events by turn
  const turnGroups = new Map<number, TimelineEvent[]>();
  for (const ev of tl.events) {
    if (ev.type === "cost_spike") continue;
    const existing = turnGroups.get(ev.turnIndex) || [];
    existing.push(ev);
    turnGroups.set(ev.turnIndex, existing);
  }

  const sessionStartMs = tl.startTime
    ? new Date(tl.startTime).getTime()
    : 0;

  for (const [turnIdx, events] of turnGroups) {
    const promptEvent = events.find((e) => e.type === "prompt");
    if (!promptEvent) continue;

    // Elapsed time since session start
    const elapsed = formatElapsed(sessionStartMs, promptEvent.timestamp);
    const turnCost = `$${promptEvent.costDollars.toFixed(2)}`;
    const ctx = formatContextSize(promptEvent.contextSizeTokens);

    // Turn header
    let header = `  ${chalk.cyan(`Turn ${turnIdx + 1}`)}  ${chalk.dim(`[${elapsed}]`)}  ${turnCost}  ${chalk.dim(`ctx:${ctx}`)}`;

    const spikeLabel = spikeTurns.get(turnIdx);
    if (spikeLabel) {
      header += `  ${chalk.red.bold(`!! ${spikeLabel}`)}`;
    }

    lines.push(header);

    // User prompt
    lines.push(
      `    ${chalk.white.bold(">")} ${chalk.white.bold(`"${promptEvent.label}"`)}`,
    );

    // Tool calls, text output, thinking — skip prompt and tool_result that
    // duplicate tool_call info
    const bodyEvents = events.filter(
      (e) => e.type !== "prompt",
    );

    for (const ev of bodyEvents) {
      if (ev.type === "tool_call") {
        const filePart = ev.filePath ? ` ${shortPath(ev.filePath)}` : "";
        lines.push(
          `    ${chalk.yellow(`[${ev.toolName || ev.label}]`)}${filePart}`,
        );
      } else if (ev.type === "tool_result") {
        const tokStr = ev.detail || `${ev.tokenCount} tok`;
        lines.push(
          `    ${chalk.yellow(`[${ev.toolName || "result"}]`)} ${chalk.dim(`(${tokStr})`)}`,
        );
      } else if (ev.type === "thinking") {
        lines.push(`    ${chalk.dim(ev.label)}`);
      } else if (ev.type === "text_output") {
        const display = `"${ev.label}"  (${ev.tokenCount} tok)`;
        lines.push(`    ${chalk.dim(display)}`);
      }
    }

    lines.push("");
  }

  // Hotspots
  if (tl.hotspots.length > 0) {
    lines.push(`  ${chalk.red.bold("HOTSPOTS")}`);
    lines.push(chalk.dim(`  ${sep}`));
    for (const h of tl.hotspots) {
      const range = `Turns ${h.turnRange[0] + 1}-${h.turnRange[1] + 1}`;
      const cost = `$${h.costDollars.toFixed(2)}`;
      const pct = `${h.percentOfTotal}% of total`;
      lines.push(
        `  ${chalk.red(`${range}:`)} ${chalk.bold(cost)} (${pct}) ${chalk.dim("\u2014 " + h.reason)}`,
      );
    }
    lines.push("");
  }

  lines.push(chalk.dim(`  ${sep}`));
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format elapsed time since session start.
 * Returns H:MM if >= 1 hour, M:SS otherwise.
 */
function formatElapsed(startMs: number, timestamp: string): string {
  if (!startMs || !timestamp) return "0:00";
  const ms = new Date(timestamp).getTime() - startMs;
  if (ms < 0 || isNaN(ms)) return "0:00";

  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Format context size as human-readable (e.g. 23K, 180K).
 */
function formatContextSize(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/**
 * Shorten a file path for display.
 */
function shortPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 2) return filePath;
  return parts.slice(-2).join("/");
}
