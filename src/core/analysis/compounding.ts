/**
 * Compounding Calculator
 *
 * Calculates how verbose output at turn t compounds across all
 * remaining turns. Verbose early output is re-transmitted as context
 * every subsequent turn, multiplying its cost.
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type { ParsedSession, CompoundingInfo } from "../types.js";
import { getPricing } from "../constants.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate compounding info for each turn in a session.
 *
 * For each turn t:
 * - turnContextSize: total input context (cache_read + cache_creation + input)
 * - newTokensAdded: new content added to context this turn (cache_creation + input)
 * - cumulativeRetransmissionCost: total $ spent re-sending context up to this turn
 * - marginalCostOfVerbosity: how much 1 extra output token at this turn costs
 *   across all remaining turns (remaining_turns * cache_read_price_per_token)
 */
export function calculateCompounding(
  session: ParsedSession,
): CompoundingInfo[] {
  const pricing = getPricing(session.model);
  const cacheReadPricePerToken = pricing.cacheReadPerMillion / 1_000_000;
  const totalTurns = session.turns.length;

  let cumulativeRetransmissionCost = 0;

  return session.turns.map((turn, index) => {
    const cacheRead = turn.usage.cache_read_input_tokens ?? 0;
    const cacheCreation = turn.usage.cache_creation_input_tokens ?? 0;
    const input = turn.usage.input_tokens;

    // Total context window size at this turn
    const turnContextSize = cacheRead + cacheCreation + input;

    // New tokens added this turn (content that wasn't in previous turns)
    // cache_creation = new content being cached; input = uncached new content
    const newTokensAdded = cacheCreation + input;

    // Cost of re-sending this turn's context (mostly cache reads)
    const turnRetransmissionCost = turnContextSize * cacheReadPricePerToken;
    cumulativeRetransmissionCost += turnRetransmissionCost;

    // How many turns remain after this one
    const remainingTurns = totalTurns - index - 1;

    // If you added 1 extra token at this turn, it would be retransmitted
    // (as a cache read) in every subsequent turn
    const marginalCostOfVerbosity =
      remainingTurns * cacheReadPricePerToken;

    return {
      turnContextSize,
      newTokensAdded,
      cumulativeRetransmissionCost,
      marginalCostOfVerbosity,
    };
  });
}

/**
 * Calculate the per-turn cost (context size * cache read price).
 * Useful for showing $/turn at various points in the session.
 */
export function perTurnCost(
  session: ParsedSession,
): Array<{ turnIndex: number; contextSize: number; costPerTurn: number }> {
  const pricing = getPricing(session.model);
  const cacheReadPricePerToken = pricing.cacheReadPerMillion / 1_000_000;

  return session.turns.map((turn, index) => {
    const cacheRead = turn.usage.cache_read_input_tokens ?? 0;
    const cacheCreation = turn.usage.cache_creation_input_tokens ?? 0;
    const input = turn.usage.input_tokens;
    const contextSize = cacheRead + cacheCreation + input;
    const costPerTurn = contextSize * cacheReadPricePerToken;

    return {
      turnIndex: index,
      contextSize,
      costPerTurn,
    };
  });
}
