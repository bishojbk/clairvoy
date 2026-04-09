/**
 * Advanced Behavioral Pattern Detection
 *
 * Detects wasteful patterns in Claude Code sessions:
 * loops, dead-ends, search spirals, over-reads, redundant tools,
 * edit reverts, and verbose output.
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type {
  ParsedSession,
  DetectedPattern,
  PatternEvidence,
  Turn,
  ToolCall,
} from "../types.js";
import { estimateTokens, getPricing } from "../constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Estimate the dollar cost of wasted tokens using output pricing. */
function wasteCost(tokensWasted: number, model: string): number {
  const pricing = getPricing(model);
  return (tokensWasted / 1_000_000) * pricing.outputPerMillion;
}

/** Sum output tokens across a range of turns (inclusive). */
function sumOutputTokens(turns: Turn[], start: number, end: number): number {
  let total = 0;
  for (let i = start; i <= end && i < turns.length; i++) {
    total += turns[i].usage.output_tokens;
  }
  return total;
}

/** Extract tool name sequences from a turn. */
function toolNameSequence(turn: Turn): string[] {
  return turn.toolCalls.map((tc) => tc.name);
}

/** Dead-end phrase patterns. */
const DEAD_END_PHRASES = [
  /that approach won'?t work/i,
  /let me try a different/i,
  /reverting/i,
  /let me try another/i,
  /that didn'?t work/i,
  /going back to/i,
  /scratch that/i,
  /actually,? let me/i,
  /this isn'?t (going to )?work/i,
  /let me undo/i,
  /let me revert/i,
];

// ---------------------------------------------------------------------------
// 1. Loop Detection
// ---------------------------------------------------------------------------

/**
 * Sliding window over tool call sequences per turn. If the same sequence
 * of 3+ tool names repeats 2+ times within 10 turns, flag it.
 */
export function detectLoops(session: ParsedSession): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const turns = session.turns;

  for (let windowStart = 0; windowStart < turns.length; windowStart++) {
    const windowEnd = Math.min(windowStart + 10, turns.length);

    // Collect all tool names in this window
    const sequences: Array<{ names: string[]; turnIndex: number }> = [];
    for (let i = windowStart; i < windowEnd; i++) {
      const names = toolNameSequence(turns[i]);
      if (names.length >= 3) {
        sequences.push({ names, turnIndex: i });
      }
    }

    // Compare sequences for repetition
    for (let i = 0; i < sequences.length; i++) {
      const seq = sequences[i].names.join(",");
      let repeatCount = 1;
      const repeatTurns: number[] = [sequences[i].turnIndex];

      for (let j = i + 1; j < sequences.length; j++) {
        if (sequences[j].names.join(",") === seq) {
          repeatCount++;
          repeatTurns.push(sequences[j].turnIndex);
        }
      }

      if (repeatCount >= 2) {
        const rangeStart = repeatTurns[0];
        const rangeEnd = repeatTurns[repeatTurns.length - 1];
        const tokensWasted = sumOutputTokens(turns, rangeStart, rangeEnd);

        // Avoid duplicate patterns for overlapping windows
        const alreadyFound = patterns.some(
          (p) =>
            p.type === "loop" &&
            p.turnRange[0] === rangeStart &&
            p.turnRange[1] === rangeEnd,
        );
        if (alreadyFound) continue;

        const seqDisplay = sequences[i].names.join("\u2192");
        const evidence: PatternEvidence[] = repeatTurns.map((t) => ({
          turnIndex: t,
          type: "tool_call" as const,
          summary: `${seqDisplay} sequence in turn ${t}`,
        }));

        patterns.push({
          type: "loop",
          severity: repeatCount >= 3 ? "high" : "medium",
          turnRange: [rangeStart, rangeEnd],
          description: `${seqDisplay} repeated ${repeatCount}x`,
          tokensWasted,
          dollarCost: wasteCost(tokensWasted, session.model),
          evidence,
        });
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 2. Dead-End Detection
// ---------------------------------------------------------------------------

/**
 * Look for Edit calls followed by reverts, or text indicating abandonment
 * after 3+ tool calls.
 */
export function detectDeadEnds(session: ParsedSession): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const turns = session.turns;

  // Track edit history: file -> { old_string, new_string, turnIndex }
  const editHistory: Array<{
    filePath: string;
    oldString: string;
    newString: string;
    turnIndex: number;
  }> = [];

  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name === "Edit") {
        const filePath = (tc.input.file_path as string) || "";
        const oldString = (tc.input.old_string as string) || "";
        const newString = (tc.input.new_string as string) || "";

        // Check if this reverts a previous edit
        for (const prev of editHistory) {
          if (
            prev.filePath === filePath &&
            (oldString === prev.newString || newString === prev.oldString)
          ) {
            const tokensWasted = sumOutputTokens(
              turns,
              prev.turnIndex,
              turn.index,
            );
            patterns.push({
              type: "dead-end",
              severity: "high",
              turnRange: [prev.turnIndex, turn.index],
              description: `Edit to ${shortPath(filePath)} reverted`,
              tokensWasted,
              dollarCost: wasteCost(tokensWasted, session.model),
              evidence: [
                {
                  turnIndex: prev.turnIndex,
                  type: "tool_call",
                  summary: `Original edit in turn ${prev.turnIndex}`,
                },
                {
                  turnIndex: turn.index,
                  type: "tool_call",
                  summary: `Revert edit in turn ${turn.index}`,
                },
              ],
            });
          }
        }

        editHistory.push({ filePath, oldString, newString, turnIndex: turn.index });
      }
    }

    // Check for dead-end phrases after 3+ tool calls in recent turns
    const recentToolCount = countRecentToolCalls(turns, turn.index, 3);
    if (recentToolCount >= 3) {
      for (const block of turn.assistantBlocks) {
        if (block.type === "text") {
          const text = (block as { type: "text"; text: string }).text;
          for (const phrase of DEAD_END_PHRASES) {
            if (phrase.test(text)) {
              const startTurn = Math.max(0, turn.index - 3);
              const tokensWasted = sumOutputTokens(turns, startTurn, turn.index);
              patterns.push({
                type: "dead-end",
                severity: "medium",
                turnRange: [startTurn, turn.index],
                description: `Abandoned approach after ${recentToolCount} tool calls`,
                tokensWasted,
                dollarCost: wasteCost(tokensWasted, session.model),
                evidence: [
                  {
                    turnIndex: turn.index,
                    type: "text",
                    summary: `Dead-end phrase detected: "${text.slice(0, 80)}"`,
                  },
                ],
              });
              break; // one phrase match per turn is enough
            }
          }
        }
      }
    }
  }

  return patterns;
}

/** Count tool calls in the last N turns ending at turnIndex. */
function countRecentToolCalls(
  turns: Turn[],
  turnIndex: number,
  lookback: number,
): number {
  let count = 0;
  const start = Math.max(0, turnIndex - lookback + 1);
  for (let i = start; i <= turnIndex && i < turns.length; i++) {
    count += turns[i].toolCalls.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 3. Search Spiral Detection
// ---------------------------------------------------------------------------

/**
 * Sequential Grep/Glob tool calls within 5 turns where the search pattern
 * broadens (pattern gets shorter or more generic).
 */
export function detectSearchSpirals(session: ParsedSession): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const turns = session.turns;

  // Collect search tool calls with their patterns
  const searches: Array<{
    turnIndex: number;
    toolName: string;
    pattern: string;
  }> = [];

  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name === "Grep" || tc.name === "Glob") {
        const pattern =
          (tc.input.pattern as string) ||
          (tc.input.glob as string) ||
          "";
        if (pattern) {
          searches.push({ turnIndex: turn.index, toolName: tc.name, pattern });
        }
      }
    }
  }

  // Look for escalating (broadening) search sequences
  for (let i = 0; i < searches.length; i++) {
    let escalationCount = 0;
    const spiralSearches = [searches[i]];

    for (let j = i + 1; j < searches.length; j++) {
      // Only within 5 turns
      if (searches[j].turnIndex - searches[i].turnIndex > 5) break;

      const prevPattern = spiralSearches[spiralSearches.length - 1].pattern;
      const currPattern = searches[j].pattern;

      // Broadening: pattern gets shorter, or uses wildcards, or is more generic
      if (
        currPattern.length < prevPattern.length ||
        (currPattern.includes("*") && !prevPattern.includes("*")) ||
        prevPattern.includes(currPattern)
      ) {
        escalationCount++;
        spiralSearches.push(searches[j]);
      }
    }

    if (escalationCount >= 2) {
      const rangeStart = spiralSearches[0].turnIndex;
      const rangeEnd = spiralSearches[spiralSearches.length - 1].turnIndex;
      const tokensWasted = sumOutputTokens(turns, rangeStart, rangeEnd);

      const alreadyFound = patterns.some(
        (p) =>
          p.type === "search-spiral" &&
          p.turnRange[0] === rangeStart &&
          p.turnRange[1] === rangeEnd,
      );
      if (alreadyFound) continue;

      const evidence: PatternEvidence[] = spiralSearches.map((s) => ({
        turnIndex: s.turnIndex,
        type: "tool_call" as const,
        summary: `${s.toolName} pattern: "${s.pattern}"`,
      }));

      patterns.push({
        type: "search-spiral",
        severity: escalationCount >= 3 ? "high" : "medium",
        turnRange: [rangeStart, rangeEnd],
        description: `Search broadened ${escalationCount + 1}x across turns ${rangeStart}-${rangeEnd}`,
        tokensWasted,
        dollarCost: wasteCost(tokensWasted, session.model),
        evidence,
      });
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 4. Over-Read Detection
// ---------------------------------------------------------------------------

/**
 * Read tool calls where file_path exists but no offset or limit,
 * and resultTokenEstimate > 500. Flag files read without line targeting.
 */
export function detectOverReads(session: ParsedSession): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name !== "Read") continue;

      const filePath = tc.input.file_path as string | undefined;
      if (!filePath) continue;

      const hasOffset = tc.input.offset !== undefined && tc.input.offset !== null;
      const hasLimit = tc.input.limit !== undefined && tc.input.limit !== null;

      if (!hasOffset && !hasLimit && tc.resultTokenEstimate > 500) {
        const tokensWasted = Math.floor(tc.resultTokenEstimate * 0.5); // estimate half was unnecessary

        patterns.push({
          type: "over-read",
          severity: tc.resultTokenEstimate > 2000 ? "medium" : "low",
          turnRange: [turn.index, turn.index],
          description: `${shortPath(filePath)} read without line targeting (~${tc.resultTokenEstimate.toLocaleString()} tokens)`,
          tokensWasted,
          dollarCost: wasteCost(tokensWasted, session.model),
          evidence: [
            {
              turnIndex: turn.index,
              type: "tool_call",
              summary: `Read ${shortPath(filePath)} — no offset/limit, ${tc.resultTokenEstimate} tokens`,
            },
          ],
        });
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 5. Redundant Tool Call Detection
// ---------------------------------------------------------------------------

/**
 * If a tool is called with the exact same name + stringified input as a
 * previous call in the session, AND no Write/Edit to the same file path
 * between them, it's redundant.
 */
export function detectRedundantToolCalls(
  session: ParsedSession,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Track all tool calls with their fingerprints
  const seen: Array<{
    fingerprint: string;
    turnIndex: number;
    toolCall: ToolCall;
  }> = [];

  // Track Write/Edit operations by file path
  const mutations = new Set<string>();

  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      // Track file mutations
      if (tc.name === "Write" || tc.name === "Edit") {
        const fp = (tc.input.file_path as string) || "";
        if (fp) mutations.add(fp);
      }

      const fingerprint = tc.name + ":" + JSON.stringify(tc.input);

      // Check if this exact call was made before
      for (const prev of seen) {
        if (prev.fingerprint === fingerprint) {
          // Check if there was a mutation to the relevant file between the two calls
          const relevantPath =
            (tc.input.file_path as string) ||
            (tc.input.path as string) ||
            "";

          // If the file was mutated between calls, the re-read is justified
          if (relevantPath && mutations.has(relevantPath)) continue;

          const tokensWasted = tc.resultTokenEstimate;

          patterns.push({
            type: "redundant-tool",
            severity: tokensWasted > 1000 ? "medium" : "low",
            turnRange: [prev.turnIndex, turn.index],
            description: `${tc.name} called with identical args (turns ${prev.turnIndex} and ${turn.index})`,
            tokensWasted,
            dollarCost: wasteCost(tokensWasted, session.model),
            evidence: [
              {
                turnIndex: prev.turnIndex,
                type: "tool_call",
                summary: `First call: ${tc.name} in turn ${prev.turnIndex}`,
              },
              {
                turnIndex: turn.index,
                type: "tool_call",
                summary: `Duplicate call: ${tc.name} in turn ${turn.index}`,
              },
            ],
          });
          break; // only flag once per duplicate pair
        }
      }

      seen.push({ fingerprint, turnIndex: turn.index, toolCall: tc });
    }
  }

  // Consolidate: group redundant calls by fingerprint
  return consolidateRedundant(patterns);
}

/** Merge multiple redundant-tool patterns with the same description. */
function consolidateRedundant(
  patterns: DetectedPattern[],
): DetectedPattern[] {
  const byKey = new Map<string, DetectedPattern[]>();
  for (const p of patterns) {
    const key = p.evidence[0]?.summary || p.description;
    const existing = byKey.get(key) || [];
    existing.push(p);
    byKey.set(key, existing);
  }

  const result: DetectedPattern[] = [];
  for (const [, group] of byKey) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      // Merge group into a single pattern
      const first = group[0];
      const last = group[group.length - 1];
      const totalWasted = group.reduce((s, p) => s + p.tokensWasted, 0);
      const allEvidence = group.flatMap((p) => p.evidence);
      const toolName = first.evidence[0]?.summary.match(/First call: (\w+)/)?.[1] || "tool";

      result.push({
        type: "redundant-tool",
        severity: totalWasted > 2000 ? "medium" : "low",
        turnRange: [first.turnRange[0], last.turnRange[1]],
        description: `${toolName} called ${group.length + 1} times with same args`,
        tokensWasted: totalWasted,
        dollarCost: first.dollarCost + last.dollarCost,
        evidence: allEvidence,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 6. Retry Storm Detection
// ---------------------------------------------------------------------------

/**
 * Detect turns where the same tool is called repeatedly with small variations,
 * often indicating Claude is retrying a failing approach (e.g., Edit with
 * slightly different old_string each time).
 */
export function detectRetryStorms(
  session: ParsedSession,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const turns = session.turns;

  for (const turn of turns) {
    // Count tool calls by name in this turn
    const toolCounts = new Map<string, number>();
    for (const tc of turn.toolCalls) {
      toolCounts.set(tc.name, (toolCounts.get(tc.name) || 0) + 1);
    }

    // Flag any tool called 4+ times in a single turn
    for (const [toolName, count] of toolCounts) {
      if (count >= 4) {
        const tokensWasted = sumOutputTokens(turns, turn.index, turn.index);
        patterns.push({
          type: "retry-storm",
          severity: count >= 6 ? "high" : "medium",
          turnRange: [turn.index, turn.index],
          description: `${toolName} called ${count}x in turn ${turn.index} — likely retrying a failing approach`,
          tokensWasted,
          dollarCost: wasteCost(tokensWasted, session.model),
          evidence: [{
            turnIndex: turn.index,
            type: "tool_call",
            summary: `${toolName} x${count} in a single turn`,
          }],
        });
      }
    }
  }

  // Also detect the same tool failing across consecutive turns
  for (let i = 0; i < turns.length - 2; i++) {
    const window = turns.slice(i, i + 3);
    const failedTools: string[] = [];

    for (const turn of window) {
      for (const tc of turn.toolCalls) {
        // Heuristic: tool result contains "error" or tool result is empty/failed
        const resultStr = (tc.resultText || "").toLowerCase();
        if (resultStr.includes("error") || resultStr.includes("failed") || resultStr.includes("no such file")) {
          failedTools.push(tc.name);
        }
      }
    }

    // If 3+ failures of the same tool across 3 consecutive turns
    const failCounts = new Map<string, number>();
    for (const name of failedTools) {
      failCounts.set(name, (failCounts.get(name) || 0) + 1);
    }

    for (const [toolName, count] of failCounts) {
      if (count >= 3) {
        const alreadyFound = patterns.some(
          (p) => p.type === "retry-storm" && p.turnRange[0] === i,
        );
        if (alreadyFound) continue;

        const tokensWasted = sumOutputTokens(turns, i, i + 2);
        patterns.push({
          type: "retry-storm",
          severity: "medium",
          turnRange: [i, i + 2],
          description: `${toolName} failed ${count}x across turns ${i}-${i + 2}`,
          tokensWasted,
          dollarCost: wasteCost(tokensWasted, session.model),
          evidence: [{
            turnIndex: i,
            type: "tool_call",
            summary: `${toolName} repeated failures across 3 turns`,
          }],
        });
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 7. Edit Revert Detection
// ---------------------------------------------------------------------------

/**
 * Look across all turns for Edit calls where file_path matches AND
 * old_string of edit B === new_string of edit A. This means edit B
 * undid edit A.
 */
export function detectEditReverts(session: ParsedSession): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Collect all edit operations
  const edits: Array<{
    filePath: string;
    oldString: string;
    newString: string;
    turnIndex: number;
  }> = [];

  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name === "Edit") {
        edits.push({
          filePath: (tc.input.file_path as string) || "",
          oldString: (tc.input.old_string as string) || "",
          newString: (tc.input.new_string as string) || "",
          turnIndex: turn.index,
        });
      }
    }
  }

  // Compare all pairs: does edit B revert edit A?
  for (let a = 0; a < edits.length; a++) {
    for (let b = a + 1; b < edits.length; b++) {
      if (
        edits[a].filePath === edits[b].filePath &&
        edits[b].oldString === edits[a].newString
      ) {
        const tokensWasted = sumOutputTokens(
          session.turns,
          edits[a].turnIndex,
          edits[b].turnIndex,
        );

        // Deduplicate with dead-end patterns that already found this
        const alreadyFound = patterns.some(
          (p) =>
            p.type === "edit-revert" &&
            p.turnRange[0] === edits[a].turnIndex &&
            p.turnRange[1] === edits[b].turnIndex,
        );
        if (alreadyFound) continue;

        patterns.push({
          type: "edit-revert",
          severity: "high",
          turnRange: [edits[a].turnIndex, edits[b].turnIndex],
          description: `Edit to ${shortPath(edits[a].filePath)} reverted in turn ${edits[b].turnIndex}`,
          tokensWasted,
          dollarCost: wasteCost(tokensWasted, session.model),
          evidence: [
            {
              turnIndex: edits[a].turnIndex,
              type: "tool_call",
              summary: `Edit applied in turn ${edits[a].turnIndex}`,
            },
            {
              turnIndex: edits[b].turnIndex,
              type: "tool_call",
              summary: `Edit reverted in turn ${edits[b].turnIndex}`,
            },
          ],
        });
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 8. Verbose Output Detection
// ---------------------------------------------------------------------------

/**
 * Text blocks >500 estimated tokens that are >80% non-code
 * (don't contain ``` or 4-space indent).
 */
export function detectVerboseOutput(session: ParsedSession): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  for (const turn of session.turns) {
    for (const block of turn.assistantBlocks) {
      if (block.type !== "text") continue;

      const text = (block as { type: "text"; text: string }).text;
      const tokens = estimateTokens(text);
      if (tokens <= 500) continue;

      // Check if it's mostly non-code
      const lines = text.split("\n");
      let codeLines = 0;
      let inCodeBlock = false;

      for (const line of lines) {
        if (line.trim().startsWith("```")) {
          inCodeBlock = !inCodeBlock;
          codeLines++;
          continue;
        }
        if (inCodeBlock || /^\s{4,}\S/.test(line)) {
          codeLines++;
        }
      }

      const codeRatio = lines.length > 0 ? codeLines / lines.length : 0;
      if (codeRatio <= 0.2) {
        // >80% non-code
        const excessTokens = tokens - 500; // tokens beyond the threshold

        patterns.push({
          type: "verbose-output",
          severity: tokens > 2000 ? "medium" : "low",
          turnRange: [turn.index, turn.index],
          description: `Verbose text block (~${tokens.toLocaleString()} tokens, ${Math.round((1 - codeRatio) * 100)}% prose)`,
          tokensWasted: excessTokens,
          dollarCost: wasteCost(excessTokens, session.model),
          evidence: [
            {
              turnIndex: turn.index,
              type: "text",
              summary: `${tokens} token text block: "${text.slice(0, 60)}..."`,
            },
          ],
        });
      }
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 9. Excessive Thinking Detection
// ---------------------------------------------------------------------------

/**
 * Detect turns where thinking blocks are disproportionately large relative
 * to the actual output produced. Thinking > 3x output tokens is a sign
 * of overthinking or circular reasoning.
 */
export function detectExcessiveThinking(
  session: ParsedSession,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  for (const turn of session.turns) {
    let thinkingTokens = 0;
    let outputTokens = 0;

    for (const block of turn.assistantBlocks) {
      if (block.type === "thinking") {
        const tb = block as { type: "thinking"; thinking: string };
        thinkingTokens += estimateTokens(tb.thinking || "");
      } else if (block.type === "text") {
        const tb = block as { type: "text"; text: string };
        outputTokens += estimateTokens(tb.text);
      }
    }

    // Flag if thinking is >3x the output AND thinking > 2000 tokens
    if (thinkingTokens > 2000 && outputTokens > 0 && thinkingTokens > outputTokens * 3) {
      const excessTokens = thinkingTokens - outputTokens;

      patterns.push({
        type: "verbose-output",
        severity: thinkingTokens > 5000 ? "medium" : "low",
        turnRange: [turn.index, turn.index],
        description: `Excessive thinking in turn ${turn.index}: ~${thinkingTokens.toLocaleString()} thinking tokens for ~${outputTokens.toLocaleString()} output tokens`,
        tokensWasted: excessTokens,
        dollarCost: wasteCost(excessTokens, session.model),
        evidence: [{
          turnIndex: turn.index,
          type: "text",
          summary: `${thinkingTokens} thinking tokens vs ${outputTokens} output tokens (${Math.round(thinkingTokens / outputTokens)}x ratio)`,
        }],
      });
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 10. Tool Call Spam Detection
// ---------------------------------------------------------------------------

/**
 * Detect turns with an unusually high number of tool calls (>10 in a single
 * turn), which often indicates Claude is thrashing rather than working
 * efficiently.
 */
export function detectToolCallSpam(
  session: ParsedSession,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  for (const turn of session.turns) {
    if (turn.toolCalls.length > 10) {
      const tokensWasted = sumOutputTokens(session.turns, turn.index, turn.index);

      // Categorize what tools are being spammed
      const toolCounts = new Map<string, number>();
      for (const tc of turn.toolCalls) {
        toolCounts.set(tc.name, (toolCounts.get(tc.name) || 0) + 1);
      }
      const topTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0];

      patterns.push({
        type: "redundant-tool",
        severity: turn.toolCalls.length > 20 ? "high" : "medium",
        turnRange: [turn.index, turn.index],
        description: `${turn.toolCalls.length} tool calls in turn ${turn.index} (most: ${topTool[0]} x${topTool[1]})`,
        tokensWasted,
        dollarCost: wasteCost(tokensWasted, session.model),
        evidence: [{
          turnIndex: turn.index,
          type: "tool_call",
          summary: `${turn.toolCalls.length} tool calls, dominated by ${topTool[0]}`,
        }],
      });
    }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// 11. Yak-Shave Detection
// ---------------------------------------------------------------------------

/**
 * Detect when Claude diverges from the original task — indicated by
 * reading/editing files unrelated to the files in the first few turns,
 * or by long sequences of tool calls on tangential paths.
 */
export function detectYakShaves(
  session: ParsedSession,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const turns = session.turns;
  if (turns.length < 8) return patterns;

  // Collect file paths touched in the first 3 turns (the "core" task)
  const coreFiles = new Set<string>();
  for (let i = 0; i < Math.min(3, turns.length); i++) {
    for (const tc of turns[i].toolCalls) {
      const fp = (tc.input.file_path as string) || (tc.input.path as string) || "";
      if (fp) {
        // Extract directory for fuzzy matching
        const dir = fp.split("/").slice(0, -1).join("/");
        if (dir) coreFiles.add(dir);
      }
    }
  }

  if (coreFiles.size === 0) return patterns;

  // Look for stretches of 5+ turns where NO touched file shares a directory with core files
  let divergeStart = -1;
  let divergeCount = 0;

  for (let i = 3; i < turns.length; i++) {
    const turnFiles = new Set<string>();
    for (const tc of turns[i].toolCalls) {
      const fp = (tc.input.file_path as string) || (tc.input.path as string) || "";
      if (fp) {
        const dir = fp.split("/").slice(0, -1).join("/");
        if (dir) turnFiles.add(dir);
      }
    }

    // Check if this turn touches any core directories
    let touchesCore = turnFiles.size === 0; // no files = not diverging (text-only turn)
    for (const dir of turnFiles) {
      for (const coreDir of coreFiles) {
        if (dir.startsWith(coreDir) || coreDir.startsWith(dir)) {
          touchesCore = true;
          break;
        }
      }
      if (touchesCore) break;
    }

    if (!touchesCore) {
      if (divergeStart === -1) divergeStart = i;
      divergeCount++;
    } else {
      if (divergeCount >= 5) {
        const tokensWasted = sumOutputTokens(turns, divergeStart, divergeStart + divergeCount - 1);
        patterns.push({
          type: "yak-shave",
          severity: divergeCount >= 8 ? "high" : "medium",
          turnRange: [divergeStart, divergeStart + divergeCount - 1],
          description: `${divergeCount} turns working outside the original task scope (turns ${divergeStart}-${divergeStart + divergeCount - 1})`,
          tokensWasted,
          dollarCost: wasteCost(tokensWasted, session.model),
          evidence: [{
            turnIndex: divergeStart,
            type: "tool_call",
            summary: `Task diverged from core files for ${divergeCount} consecutive turns`,
          }],
        });
      }
      divergeStart = -1;
      divergeCount = 0;
    }
  }

  // Check trailing divergence
  if (divergeCount >= 5) {
    const tokensWasted = sumOutputTokens(turns, divergeStart, divergeStart + divergeCount - 1);
    patterns.push({
      type: "yak-shave",
      severity: divergeCount >= 8 ? "high" : "medium",
      turnRange: [divergeStart, divergeStart + divergeCount - 1],
      description: `${divergeCount} turns working outside the original task scope (turns ${divergeStart}-${divergeStart + divergeCount - 1})`,
      tokensWasted,
      dollarCost: wasteCost(tokensWasted, session.model),
      evidence: [{
        turnIndex: divergeStart,
        type: "tool_call",
        summary: `Task diverged from core files for ${divergeCount} consecutive turns`,
      }],
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run all pattern detectors on a session and return sorted results.
 * Sorted by severity (high first), then by tokensWasted descending.
 */
export function detectAllPatterns(session: ParsedSession): DetectedPattern[] {
  const all: DetectedPattern[] = [
    ...detectLoops(session),
    ...detectDeadEnds(session),
    ...detectSearchSpirals(session),
    ...detectOverReads(session),
    ...detectRedundantToolCalls(session),
    ...detectRetryStorms(session),
    ...detectEditReverts(session),
    ...detectVerboseOutput(session),
    ...detectExcessiveThinking(session),
    ...detectToolCallSpam(session),
    ...detectYakShaves(session),
  ];

  const severityOrder: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  all.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.tokensWasted - a.tokensWasted;
  });

  return all;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function shortPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return ".../" + parts.slice(-2).join("/");
}
