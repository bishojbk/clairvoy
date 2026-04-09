/**
 * Diagnostics Engine
 *
 * Scans recent sessions and configuration to identify systemic issues.
 * Returns diagnoses with prescriptions — evidence-based, not generic.
 *
 * RULE: Pure functions only. No CLI deps.
 */

import type {
  ParsedSession,
  TokenBreakdown,
  Diagnosis,
  Prescription,
} from "../types.js";
import { estimateTokens } from "../constants.js";

/**
 * Run all diagnostic checks against recent session data.
 */
export function diagnoseAll(
  sessions: ParsedSession[],
  breakdowns: TokenBreakdown[],
  hasCLAUDEmd: boolean,
): Diagnosis[] {
  const diagnoses: Diagnosis[] = [];

  diagnoses.push(...checkCLAUDEmd(hasCLAUDEmd));
  diagnoses.push(...checkLongSessions(sessions));
  diagnoses.push(...checkFileReReads(breakdowns));
  diagnoses.push(...checkSycophancy(breakdowns));
  diagnoses.push(...checkMetaCommentary(breakdowns));
  diagnoses.push(...checkCodeEchoing(breakdowns));
  diagnoses.push(...checkHighToolCallSessions(sessions));
  diagnoses.push(...checkHighTurnCount(sessions));
  diagnoses.push(...checkLargeContext(sessions));

  // Sort: critical first, then warning, then info
  const order = { critical: 0, warning: 1, info: 2 };
  diagnoses.sort((a, b) => order[a.severity] - order[b.severity]);

  return diagnoses;
}

function checkCLAUDEmd(hasCLAUDEmd: boolean): Diagnosis[] {
  if (hasCLAUDEmd) return [];
  return [{
    id: "no-claude-md",
    severity: "warning",
    title: "No CLAUDE.md found in project",
    detail: "A CLAUDE.md file can reduce sycophancy, meta-commentary, and verbose output by giving Claude behavioral rules. Without one, Claude uses default (verbose) behavior.",
    prescription: {
      action: "Run `clairvoy optimize` to generate a CLAUDE.md tuned to your waste patterns",
      claudeMdRule: "# Rules\n- No filler. Start with the answer or the action.\n- Don't narrate what you're about to do. Just do it.\n- Don't summarize what you just did.",
      effort: "trivial",
    },
  }];
}

function checkLongSessions(sessions: ParsedSession[]): Diagnosis[] {
  const longSessions = sessions.filter((s) => s.totalUsage.turnCount > 50);
  if (longSessions.length === 0) return [];

  const avgTurns = Math.round(
    longSessions.reduce((sum, s) => sum + s.totalUsage.turnCount, 0) / longSessions.length,
  );

  return [{
    id: "long-sessions",
    severity: longSessions.length > 2 ? "critical" : "warning",
    title: `${longSessions.length} sessions with 50+ turns (avg ${avgTurns} turns)`,
    detail: "Long sessions cause context to compound. Each turn re-sends the entire history. Sessions over 50 turns have significantly higher per-turn costs.",
    prescription: {
      action: "Use /compact when context grows large, or start new sessions for unrelated tasks",
      effort: "easy",
    },
  }];
}

function checkFileReReads(breakdowns: TokenBreakdown[]): Diagnosis[] {
  const reReadWarnings = breakdowns.flatMap((b) =>
    b.warnings.filter((w) => w.message.includes("re-reads")),
  );
  if (reReadWarnings.length === 0) return [];

  const totalWasted = reReadWarnings.reduce((sum, w) => sum + w.tokensWasted, 0);

  return [{
    id: "file-re-reads",
    severity: totalWasted > 50000 ? "critical" : "warning",
    title: `${reReadWarnings.length} file re-read warnings (~${totalWasted.toLocaleString()} tokens wasted)`,
    detail: "Claude is reading the same files multiple times within sessions. Each re-read adds tokens to context that compound on every subsequent turn.",
    prescription: {
      action: "Add a CLAUDE.md rule to track read files",
      claudeMdRule: "- Track files you've read. Never re-read a file in the same session unless it was modified.",
      effort: "trivial",
    },
  }];
}

function checkSycophancy(breakdowns: TokenBreakdown[]): Diagnosis[] {
  let totalSycophancy = 0;
  let sessionsWithSycophancy = 0;

  for (const b of breakdowns) {
    const syc = b.categories.find((c) => c.name === "Sycophancy");
    if (syc && syc.tokens > 0) {
      totalSycophancy += syc.tokens;
      sessionsWithSycophancy++;
    }
  }

  if (sessionsWithSycophancy === 0) return [];
  const rate = Math.round((sessionsWithSycophancy / breakdowns.length) * 100);

  return [{
    id: "sycophancy",
    severity: rate > 50 ? "warning" : "info",
    title: `Sycophancy detected in ${rate}% of sessions (~${totalSycophancy.toLocaleString()} tokens total)`,
    detail: "Claude opens responses with filler like \"Great question!\" or \"Absolutely!\". These tokens compound in conversation history.",
    prescription: {
      action: "Add anti-sycophancy rule to CLAUDE.md",
      claudeMdRule: "- No sycophantic openers. No \"Great question!\", \"Absolutely!\", \"Sure!\". Start with the answer.",
      effort: "trivial",
    },
  }];
}

function checkMetaCommentary(breakdowns: TokenBreakdown[]): Diagnosis[] {
  let totalMeta = 0;
  for (const b of breakdowns) {
    const meta = b.categories.find((c) => c.name === "Meta-commentary");
    if (meta) totalMeta += meta.tokens;
  }

  if (totalMeta < 500) return [];

  return [{
    id: "meta-commentary",
    severity: "info",
    title: `~${totalMeta.toLocaleString()} tokens spent on meta-commentary across sessions`,
    detail: "Claude narrates its actions: \"Let me take a look...\", \"Here's what I found...\". These add no value and compound in history.",
    prescription: {
      action: "Add conciseness rule to CLAUDE.md",
      claudeMdRule: "- Don't narrate actions. Don't say \"Let me check\" — just check. Don't say \"Here's what I found\" — just show it.",
      effort: "trivial",
    },
  }];
}

function checkHighTurnCount(sessions: ParsedSession[]): Diagnosis[] {
  if (sessions.length === 0) return [];

  const avgTurns = Math.round(
    sessions.reduce((sum, s) => sum + s.totalUsage.turnCount, 0) / sessions.length,
  );

  if (avgTurns <= 20) return [];

  return [{
    id: "high-avg-turns",
    severity: "info",
    title: `Average session is ${avgTurns} turns`,
    detail: "Sessions with many turns accumulate large context windows. Consider being more specific in prompts to reduce back-and-forth.",
    prescription: {
      action: "Include file paths and line numbers in prompts to reduce search turns",
      effort: "easy",
    },
  }];
}

function checkCodeEchoing(breakdowns: TokenBreakdown[]): Diagnosis[] {
  let totalEchoing = 0;
  for (const b of breakdowns) {
    const echo = b.categories.find((c) => c.name === "Code Echoing (waste)");
    if (echo) totalEchoing += echo.tokens;
  }

  if (totalEchoing < 1000) return [];

  return [{
    id: "code-echoing",
    severity: totalEchoing > 10000 ? "warning" : "info",
    title: `~${totalEchoing.toLocaleString()} tokens spent echoing code after edits`,
    detail: "Claude echoes back full files or large code blocks after making edits. The edit tool already confirms changes — echoing wastes output tokens that compound in history.",
    prescription: {
      action: "Add anti-echoing rule to CLAUDE.md",
      claudeMdRule: "- After editing a file, don't echo back the entire file or large code blocks. The edit tool confirms the change.",
      effort: "trivial",
    },
  }];
}

function checkHighToolCallSessions(sessions: ParsedSession[]): Diagnosis[] {
  const highToolSessions = sessions.filter((s) => {
    const totalToolCalls = s.turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
    return totalToolCalls > 100;
  });

  if (highToolSessions.length === 0) return [];

  const avgToolCalls = Math.round(
    highToolSessions.reduce((sum, s) => {
      return sum + s.turns.reduce((tSum, t) => tSum + t.toolCalls.length, 0);
    }, 0) / highToolSessions.length,
  );

  return [{
    id: "high-tool-calls",
    severity: highToolSessions.length > 3 ? "warning" : "info",
    title: `${highToolSessions.length} sessions with 100+ tool calls (avg ${avgToolCalls})`,
    detail: "Sessions with very high tool call counts often indicate excessive searching, file reading, or retry loops. Each tool call adds input and output tokens.",
    prescription: {
      action: "Use specific file paths in prompts to reduce search turns, batch file reads in parallel",
      effort: "easy",
    },
  }];
}

function checkLargeContext(sessions: ParsedSession[]): Diagnosis[] {
  const largeCtx = sessions.filter((s) => {
    const lastTurn = s.turns[s.turns.length - 1];
    if (!lastTurn) return false;
    const ctx = (lastTurn.usage.cache_read_input_tokens || 0) +
      (lastTurn.usage.cache_creation_input_tokens || 0) +
      lastTurn.usage.input_tokens;
    return ctx > 200_000;
  });

  if (largeCtx.length === 0) return [];

  return [{
    id: "large-context",
    severity: "warning",
    title: `${largeCtx.length} sessions ended with context >200K tokens`,
    detail: "Large context windows mean high per-turn costs even at cache pricing. Use /compact to summarize and reduce context mid-session.",
    prescription: {
      action: "Use /compact when context exceeds ~150K tokens",
      effort: "easy",
    },
  }];
}
