/**
 * Trend Aggregator
 *
 * Groups sessions by time windows and projects to produce
 * historical usage reports.
 *
 * RULE: Pure functions only. No CLI deps, no console.log.
 */

import type { ParsedSession, TokenBreakdown, SessionScore } from "../types.js";
import { decodeProjectPath } from "../../cli/util/format.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  sessions: number;
  totalCost: number;
  totalTokens: number;
  totalTurns: number;
  avgScore: number;
}

export interface ProjectUsage {
  project: string;
  sessions: number;
  totalCost: number;
  totalTokens: number;
  percentOfTotal: number;
}

export interface TrendReport {
  daily: DailyUsage[];
  byProject: ProjectUsage[];
  totalCost: number;
  totalSessions: number;
  totalTurns: number;
  periodDays: number;
  avgCostPerDay: number;
  avgCostPerSession: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SessionData {
  parsed: ParsedSession;
  breakdown: TokenBreakdown;
  score: SessionScore;
}

// ---------------------------------------------------------------------------
// Main aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregate session data into a trend report for the given period.
 */
export function aggregateTrends(
  sessions: SessionData[],
  periodDays: number,
): TrendReport {
  if (sessions.length === 0) {
    return {
      daily: [],
      byProject: [],
      totalCost: 0,
      totalSessions: 0,
      totalTurns: 0,
      periodDays,
      avgCostPerDay: 0,
      avgCostPerSession: 0,
    };
  }

  // Filter sessions within the requested period
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  cutoff.setHours(0, 0, 0, 0);

  const filtered = sessions.filter((s) => {
    const ts = getSessionDate(s.parsed);
    return ts >= cutoff;
  });

  // --- Daily aggregation ---
  const dailyMap = new Map<
    string,
    { sessions: number; cost: number; tokens: number; turns: number; scores: number[] }
  >();

  for (const s of filtered) {
    const dateKey = toDateKey(getSessionDate(s.parsed));
    const existing = dailyMap.get(dateKey) || {
      sessions: 0,
      cost: 0,
      tokens: 0,
      turns: 0,
      scores: [],
    };
    existing.sessions++;
    existing.cost += s.breakdown.totalCostDollars;
    existing.tokens += totalTokensForSession(s.parsed);
    existing.turns += s.parsed.totalUsage.turnCount;
    existing.scores.push(s.score.numericScore);
    dailyMap.set(dateKey, existing);
  }

  const daily: DailyUsage[] = Array.from(dailyMap.entries())
    .map(([date, d]) => ({
      date,
      sessions: d.sessions,
      totalCost: round2(d.cost),
      totalTokens: d.tokens,
      totalTurns: d.turns,
      avgScore: d.scores.length > 0
        ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length)
        : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- Project aggregation ---
  const projectMap = new Map<
    string,
    { sessions: number; cost: number; tokens: number }
  >();

  for (const s of filtered) {
    const project = decodeProjectPath(s.parsed.projectPath);
    const existing = projectMap.get(project) || { sessions: 0, cost: 0, tokens: 0 };
    existing.sessions++;
    existing.cost += s.breakdown.totalCostDollars;
    existing.tokens += totalTokensForSession(s.parsed);
    projectMap.set(project, existing);
  }

  const totalCost = filtered.reduce((sum, s) => sum + s.breakdown.totalCostDollars, 0);

  const byProject: ProjectUsage[] = Array.from(projectMap.entries())
    .map(([project, p]) => ({
      project,
      sessions: p.sessions,
      totalCost: round2(p.cost),
      totalTokens: p.tokens,
      percentOfTotal: totalCost > 0 ? Math.round((p.cost / totalCost) * 100) : 0,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  // --- Totals ---
  const totalSessions = filtered.length;
  const totalTurns = filtered.reduce(
    (sum, s) => sum + s.parsed.totalUsage.turnCount,
    0,
  );
  const activeDays = dailyMap.size || 1;

  return {
    daily,
    byProject,
    totalCost: round2(totalCost),
    totalSessions,
    totalTurns,
    periodDays,
    avgCostPerDay: round2(totalCost / activeDays),
    avgCostPerSession: totalSessions > 0 ? round2(totalCost / totalSessions) : 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSessionDate(session: ParsedSession): Date {
  if (session.startTime) {
    const d = new Date(session.startTime);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function totalTokensForSession(session: ParsedSession): number {
  const u = session.totalUsage;
  return (
    u.totalInputTokens +
    u.totalOutputTokens +
    u.totalCacheCreationTokens +
    u.totalCacheReadTokens
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
