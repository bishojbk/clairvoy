/**
 * Session Timeline Builder
 *
 * Transforms a ParsedSession + TokenBreakdown into a chronological
 * timeline of events with cost tracking, spike detection, and hotspots.
 *
 * RULE: Pure functions only. No CLI deps, no chalk, no console.log.
 */

import type {
  ParsedSession,
  TokenBreakdown,
  SessionTimeline,
  TimelineEvent,
  TimelineHotspot,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
} from "../types.js";
import { getPricing, calculateCost, estimateTokens } from "../constants.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a chronological timeline from a parsed session and its breakdown.
 */
export function buildTimeline(
  session: ParsedSession,
  breakdown: TokenBreakdown,
): SessionTimeline {
  const pricing = getPricing(session.model);
  const events: TimelineEvent[] = [];
  let cumulativeCost = 0;
  let eventIndex = 0;

  // Per-turn cost tracking for spike detection
  const turnCosts: { turnIndex: number; cost: number }[] = [];

  for (const turn of session.turns) {
    // Calculate this turn's cost
    const turnUsageForCost = {
      totalInputTokens: turn.usage.input_tokens,
      totalOutputTokens: turn.usage.output_tokens,
      totalCacheCreationTokens: turn.usage.cache_creation_input_tokens || 0,
      totalCacheReadTokens: turn.usage.cache_read_input_tokens || 0,
    };
    const turnCost = calculateCost(turnUsageForCost, pricing);

    // Context size for this turn
    const contextSize =
      (turn.usage.cache_read_input_tokens || 0) +
      (turn.usage.cache_creation_input_tokens || 0) +
      turn.usage.input_tokens;

    turnCosts.push({ turnIndex: turn.index, cost: turnCost });

    // --- Prompt event ---
    const promptLabel = truncate(turn.userMessage, 80);
    events.push({
      index: eventIndex++,
      timestamp: turn.timestamp,
      type: "prompt",
      turnIndex: turn.index,
      durationMs: turn.durationMs,
      tokenCount: estimateTokens(turn.userMessage),
      costDollars: turnCost,
      cumulativeCostDollars: cumulativeCost + turnCost,
      contextSizeTokens: contextSize,
      label: promptLabel,
    });

    // --- Assistant block events ---
    for (const block of turn.assistantBlocks) {
      if (block.type === "thinking") {
        const tb = block as ThinkingBlock;
        const tokens = estimateTokens(tb.thinking || "");
        events.push({
          index: eventIndex++,
          timestamp: turn.timestamp,
          type: "thinking",
          turnIndex: turn.index,
          tokenCount: tokens,
          costDollars: 0,
          cumulativeCostDollars: cumulativeCost + turnCost,
          contextSizeTokens: contextSize,
          label: `thinking (${formatTokenCount(tokens)} tok)`,
        });
      } else if (block.type === "tool_use") {
        const tb = block as ToolUseBlock;
        const filePath =
          typeof tb.input.file_path === "string"
            ? tb.input.file_path
            : undefined;
        events.push({
          index: eventIndex++,
          timestamp: turn.timestamp,
          type: "tool_call",
          turnIndex: turn.index,
          tokenCount: estimateTokens(JSON.stringify(tb.input)),
          costDollars: 0,
          cumulativeCostDollars: cumulativeCost + turnCost,
          contextSizeTokens: contextSize,
          label: tb.name,
          toolName: tb.name,
          filePath,
          detail: filePath || undefined,
        });
      } else if (block.type === "text") {
        const tb = block as TextBlock;
        const tokens = estimateTokens(tb.text);
        events.push({
          index: eventIndex++,
          timestamp: turn.timestamp,
          type: "text_output",
          turnIndex: turn.index,
          tokenCount: tokens,
          costDollars: 0,
          cumulativeCostDollars: cumulativeCost + turnCost,
          contextSizeTokens: contextSize,
          label: truncate(tb.text, 60),
        });
      }
    }

    // --- Tool result events ---
    for (const tc of turn.toolCalls) {
      events.push({
        index: eventIndex++,
        timestamp: turn.timestamp,
        type: "tool_result",
        turnIndex: turn.index,
        tokenCount: tc.resultTokenEstimate,
        costDollars: 0,
        cumulativeCostDollars: cumulativeCost + turnCost,
        contextSizeTokens: contextSize,
        label: `${tc.name} result`,
        toolName: tc.name,
        detail: `${formatTokenCount(tc.resultTokenEstimate)} tok`,
      });
    }

    cumulativeCost += turnCost;
  }

  // --- Detect cost spikes ---
  const avgTurnCost =
    turnCosts.length > 0
      ? turnCosts.reduce((sum, t) => sum + t.cost, 0) / turnCosts.length
      : 0;

  if (avgTurnCost > 0) {
    for (const tc of turnCosts) {
      const ratio = tc.cost / avgTurnCost;
      if (ratio > 2) {
        events.push({
          index: eventIndex++,
          timestamp:
            session.turns.find((t) => t.index === tc.turnIndex)?.timestamp ||
            "",
          type: "cost_spike",
          turnIndex: tc.turnIndex,
          tokenCount: 0,
          costDollars: tc.cost,
          cumulativeCostDollars: 0, // informational
          contextSizeTokens: 0,
          label: `COST SPIKE (${ratio.toFixed(1)}x avg)`,
          severity: ratio > 5 ? "critical" : "warning",
        });
      }
    }
  }

  // --- Detect hotspots ---
  const hotspots = detectHotspots(turnCosts, cumulativeCost);

  // Total tokens
  const totalTokens =
    session.totalUsage.totalInputTokens +
    session.totalUsage.totalOutputTokens +
    session.totalUsage.totalCacheCreationTokens +
    session.totalUsage.totalCacheReadTokens;

  return {
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    model: session.model,
    startTime: session.startTime,
    endTime: session.endTime,
    totalCostDollars: breakdown.totalCostDollars,
    totalTokens,
    events,
    hotspots,
  };
}

// ---------------------------------------------------------------------------
// Hotspot detection
// ---------------------------------------------------------------------------

/**
 * Find contiguous ranges of 3+ turns that account for >30% of total cost.
 */
function detectHotspots(
  turnCosts: { turnIndex: number; cost: number }[],
  totalCost: number,
): TimelineHotspot[] {
  if (turnCosts.length < 3 || totalCost <= 0) return [];

  const hotspots: TimelineHotspot[] = [];
  const threshold = totalCost * 0.3;

  // Sliding window: try all contiguous ranges of length >= 3
  for (let start = 0; start < turnCosts.length - 2; start++) {
    let windowCost = 0;
    for (let end = start; end < turnCosts.length; end++) {
      windowCost += turnCosts[end].cost;
      const windowLen = end - start + 1;

      if (windowLen >= 3 && windowCost > threshold) {
        const pct = (windowCost / totalCost) * 100;

        // Check this range isn't already subsumed by an existing hotspot
        const alreadyCovered = hotspots.some(
          (h) =>
            h.turnRange[0] <= turnCosts[start].turnIndex &&
            h.turnRange[1] >= turnCosts[end].turnIndex,
        );
        if (!alreadyCovered) {
          hotspots.push({
            turnRange: [
              turnCosts[start].turnIndex,
              turnCosts[end].turnIndex,
            ],
            reason: inferHotspotReason(turnCosts, start, end),
            costDollars: Math.round(windowCost * 100) / 100,
            percentOfTotal: Math.round(pct),
          });
        }
        break; // Found the smallest range from this start that qualifies
      }
    }
  }

  // Deduplicate: keep only the hotspot with the highest cost for overlapping ranges
  const deduped: TimelineHotspot[] = [];
  for (const h of hotspots) {
    const overlapping = deduped.findIndex(
      (d) =>
        h.turnRange[0] <= d.turnRange[1] && h.turnRange[1] >= d.turnRange[0],
    );
    if (overlapping === -1) {
      deduped.push(h);
    } else if (h.costDollars > deduped[overlapping].costDollars) {
      deduped[overlapping] = h;
    }
  }

  return deduped;
}

/**
 * Infer a human-readable reason for a hotspot.
 */
function inferHotspotReason(
  turnCosts: { turnIndex: number; cost: number }[],
  start: number,
  end: number,
): string {
  const slice = turnCosts.slice(start, end + 1);
  const avgCost =
    slice.reduce((s, t) => s + t.cost, 0) / slice.length;

  // Check if costs are escalating (context compounding)
  let increasing = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].cost > slice[i - 1].cost) increasing++;
  }

  if (increasing >= slice.length * 0.7) {
    return "context compounding — costs escalating per turn";
  }

  // Check if there's a single massive spike
  const maxCost = Math.max(...slice.map((t) => t.cost));
  if (maxCost > avgCost * 3) {
    return "large context spike within range";
  }

  return "sustained high-cost turns";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + "...";
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
