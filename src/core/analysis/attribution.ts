/**
 * Token Attribution
 *
 * Categorizes every token in a session as user-caused, Claude-caused,
 * or system overhead. Answers "who caused these tokens?"
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type {
  ParsedSession,
  Turn,
  TurnAttribution,
  CompoundingInfo,
  AttributedTurn,
} from "../types.js";
import { estimateTokens, getPricing } from "../constants.js";
import { calculateCompounding } from "./compounding.js";

// ---------------------------------------------------------------------------
// File-path heuristic: detect user-requested tool results
// ---------------------------------------------------------------------------

/**
 * Check whether the user's message explicitly mentions a file path,
 * suggesting the subsequent tool results were user-requested rather
 * than Claude-initiated.
 */
function userMentionsFilePath(userMessage: string): Set<string> {
  const paths = new Set<string>();
  // Match things that look like file paths: /foo/bar, ./foo, src/bar.ts
  const matches = userMessage.match(
    /(?:^|\s)((?:\.{0,2}\/)?[\w@./-]+\.[\w]+)/g,
  );
  if (matches) {
    for (const m of matches) {
      paths.add(m.trim());
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// System overhead estimation
// ---------------------------------------------------------------------------

/**
 * Estimate system overhead tokens from the first turn.
 * The first turn's cache_creation + cache_read captures the system prompt,
 * tool definitions, and CLAUDE.md — all before any conversation history.
 */
function estimateSystemOverhead(session: ParsedSession): number {
  if (session.turns.length === 0) return 0;
  const firstTurn = session.turns[0];
  const cacheCreation = firstTurn.usage.cache_creation_input_tokens ?? 0;
  const cacheRead = firstTurn.usage.cache_read_input_tokens ?? 0;
  return cacheCreation + cacheRead;
}

// ---------------------------------------------------------------------------
// Per-turn attribution
// ---------------------------------------------------------------------------

function attributeTurn(
  turn: Turn,
  systemOverhead: number,
): TurnAttribution {
  // --- User-caused tokens ---
  // User prompt text
  const userPromptTokens = estimateTokens(turn.userMessage);

  // Check if user explicitly mentioned file paths
  const userPaths = userMentionsFilePath(turn.userMessage);

  // Tool results where user explicitly mentioned the file path
  let userToolResultTokens = 0;
  for (const tc of turn.toolCalls) {
    const inputPath =
      typeof tc.input.file_path === "string"
        ? tc.input.file_path
        : typeof tc.input.command === "string"
          ? tc.input.command
          : "";
    const isUserRequested = [...userPaths].some(
      (p) => inputPath.includes(p),
    );
    if (isUserRequested) {
      userToolResultTokens += tc.resultTokenEstimate;
    }
  }

  const userCausedTokens = userPromptTokens + userToolResultTokens;

  // --- Claude-caused tokens ---
  // Output tokens (Claude's response)
  const outputTokens = turn.usage.output_tokens;

  // Tool call inputs (Claude decided to call these tools)
  let toolCallInputTokens = 0;
  for (const tc of turn.toolCalls) {
    toolCallInputTokens += estimateTokens(JSON.stringify(tc.input));
  }

  // Tool results that were Claude-initiated (not user-mentioned paths)
  let claudeToolResultTokens = 0;
  for (const tc of turn.toolCalls) {
    const inputPath =
      typeof tc.input.file_path === "string"
        ? tc.input.file_path
        : typeof tc.input.command === "string"
          ? tc.input.command
          : "";
    const isUserRequested = [...userPaths].some(
      (p) => inputPath.includes(p),
    );
    if (!isUserRequested) {
      claudeToolResultTokens += tc.resultTokenEstimate;
    }
  }

  const claudeCausedTokens =
    outputTokens + toolCallInputTokens + claudeToolResultTokens;

  // --- System overhead ---
  // Roughly constant per turn (system prompt + tools)
  const systemOverheadTokens = systemOverhead;

  // --- History retransmission ---
  // Total context at this turn minus system overhead and new content
  const totalContext =
    (turn.usage.cache_read_input_tokens ?? 0) +
    (turn.usage.cache_creation_input_tokens ?? 0) +
    turn.usage.input_tokens;
  const newContent = userCausedTokens + claudeCausedTokens;
  const historyRetransmission = Math.max(
    0,
    totalContext - systemOverhead - newContent,
  );

  return {
    userCausedTokens,
    claudeCausedTokens,
    systemOverheadTokens,
    historyRetransmission,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attribute every turn's tokens to user, Claude, or system overhead.
 * Also calculates compounding info for each turn.
 */
export function attributeSession(
  session: ParsedSession,
): AttributedTurn[] {
  const systemOverhead = estimateSystemOverhead(session);
  const compoundingInfos = calculateCompounding(session);

  return session.turns.map((turn, i) => {
    const attribution = attributeTurn(turn, systemOverhead);
    const compounding: CompoundingInfo = compoundingInfos[i] ?? {
      turnContextSize: 0,
      newTokensAdded: 0,
      cumulativeRetransmissionCost: 0,
      marginalCostOfVerbosity: 0,
    };

    return {
      ...turn,
      attribution,
      compounding,
    };
  });
}

/**
 * Aggregate attribution across all turns in a session.
 */
export function aggregateAttribution(
  attributedTurns: AttributedTurn[],
): TurnAttribution {
  let userCausedTokens = 0;
  let claudeCausedTokens = 0;
  let systemOverheadTokens = 0;
  let historyRetransmission = 0;

  for (const turn of attributedTurns) {
    userCausedTokens += turn.attribution.userCausedTokens;
    claudeCausedTokens += turn.attribution.claudeCausedTokens;
    systemOverheadTokens += turn.attribution.systemOverheadTokens;
    historyRetransmission += turn.attribution.historyRetransmission;
  }

  return {
    userCausedTokens,
    claudeCausedTokens,
    systemOverheadTokens,
    historyRetransmission,
  };
}
