/**
 * HTML dashboard export for clairvoy sessions.
 *
 * Generates a self-contained HTML document with inline CSS and JS.
 * No external dependencies — everything is embedded.
 *
 * RULE: Pure module — no chalk, no process.exit, no CLI deps.
 */

import type { ParsedSession, TokenBreakdown, SessionScore } from "../types.js";
import { getPricing } from "../constants.js";

export interface ExportableSession {
  parsed: ParsedSession;
  breakdown: TokenBreakdown;
  score: SessionScore;
}

/**
 * Decode Claude Code's project path encoding.
 * Duplicated from cli/util/format.ts to avoid cross-layer import.
 */
function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function gradeColor(grade: string): string {
  if (grade === "S" || grade === "A") return "#4ade80";
  if (grade === "B") return "#22d3ee";
  if (grade === "C") return "#fbbf24";
  return "#f87171";
}

function formatCost(n: number): string {
  return "$" + n.toFixed(2);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/**
 * Generate a self-contained HTML dashboard for analyzed sessions.
 */
export function sessionsToHTML(sessions: ExportableSession[]): string {
  // Aggregate summary stats
  let totalCost = 0;
  let totalScore = 0;
  let totalTokens = 0;

  const rows: string[] = [];

  for (const { parsed, breakdown, score } of sessions) {
    const pricing = getPricing(parsed.model);
    const usage = parsed.totalUsage;

    totalCost += breakdown.totalCostDollars;
    totalScore += score.numericScore;

    const sessionTokens =
      usage.totalInputTokens +
      usage.totalOutputTokens +
      usage.totalCacheCreationTokens +
      usage.totalCacheReadTokens;
    totalTokens += sessionTokens;

    const durationMs =
      parsed.startTime && parsed.endTime
        ? new Date(parsed.endTime).getTime() - new Date(parsed.startTime).getTime()
        : 0;
    const durationMin = Math.round((durationMs / 60_000) * 10) / 10;

    const inputCost = (usage.totalInputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (usage.totalOutputTokens / 1_000_000) * pricing.outputPerMillion;
    const cacheReadCost = (usage.totalCacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
    const cacheWriteCost = (usage.totalCacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion;
    const costTotal = inputCost + outputCost + cacheReadCost + cacheWriteCost;

    // Cost breakdown bar widths (percentages of total cost)
    const inputPct = costTotal > 0 ? (inputCost / costTotal) * 100 : 0;
    const outputPct = costTotal > 0 ? (outputCost / costTotal) * 100 : 0;
    const cacheReadPct = costTotal > 0 ? (cacheReadCost / costTotal) * 100 : 0;
    const cacheWritePct = costTotal > 0 ? (cacheWriteCost / costTotal) * 100 : 0;

    const project = escapeHtml(decodeProjectPath(parsed.projectPath));
    const gc = gradeColor(score.overall);

    rows.push(`<tr>
      <td class="mono">${escapeHtml(parsed.sessionId.slice(0, 8))}</td>
      <td title="${project}">${escapeHtml(project.split("/").slice(-2).join("/"))}</td>
      <td>${escapeHtml(parsed.model)}</td>
      <td class="mono">${durationMin}m</td>
      <td class="mono">${usage.turnCount}</td>
      <td class="mono">${usage.toolCallCount}</td>
      <td class="mono">${formatTokens(sessionTokens)}</td>
      <td class="mono">${formatCost(breakdown.totalCostDollars)}</td>
      <td class="mono">${breakdown.estimatedSavingsPercent}%</td>
      <td><span class="grade" style="color:${gc}">${score.overall}</span> <span class="mono score-num">${score.numericScore}</span></td>
      <td class="bar-cell">
        <div class="cost-bar">
          <div class="bar-seg bar-input" style="width:${inputPct.toFixed(1)}%" title="Input: ${formatCost(inputCost)}"></div>
          <div class="bar-seg bar-output" style="width:${outputPct.toFixed(1)}%" title="Output: ${formatCost(outputCost)}"></div>
          <div class="bar-seg bar-cache-read" style="width:${cacheReadPct.toFixed(1)}%" title="Cache Read: ${formatCost(cacheReadCost)}"></div>
          <div class="bar-seg bar-cache-write" style="width:${cacheWritePct.toFixed(1)}%" title="Cache Write: ${formatCost(cacheWriteCost)}"></div>
        </div>
      </td>
    </tr>`);
  }

  const avgScore = sessions.length > 0 ? Math.round(totalScore / sessions.length) : 0;
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>clairvoy Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    line-height: 1.5;
    padding: 2rem;
  }
  .mono { font-family: "SF Mono", "Fira Code", "Cascadia Code", Consolas, monospace; font-size: 0.85em; }
  h1 { color: #22d3ee; font-size: 1.5rem; margin-bottom: 0.25rem; }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 2rem; }
  .cards { display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  .card {
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    min-width: 180px;
    flex: 1;
  }
  .card-label { color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .card-value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; }
  .card-value.cost { color: #fbbf24; }
  .card-value.sessions { color: #22d3ee; }
  .card-value.score { color: #4ade80; }
  .card-value.tokens { color: #c084fc; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th {
    background: #16213e;
    color: #888;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.75rem 0.5rem;
    text-align: left;
    cursor: pointer;
    user-select: none;
    border-bottom: 2px solid #2a2a4a;
    white-space: nowrap;
  }
  th:hover { color: #22d3ee; }
  th .sort-arrow { font-size: 0.65rem; margin-left: 0.25rem; }
  td { padding: 0.6rem 0.5rem; border-bottom: 1px solid #2a2a4a; font-size: 0.85rem; white-space: nowrap; }
  tr:hover td { background: #16213e; }
  .grade { font-weight: 700; font-size: 1rem; }
  .score-num { color: #888; font-size: 0.75rem; }
  .bar-cell { min-width: 120px; }
  .cost-bar { display: flex; height: 14px; border-radius: 3px; overflow: hidden; background: #2a2a4a; }
  .bar-seg { height: 100%; }
  .bar-input { background: #3b82f6; }
  .bar-output { background: #f59e0b; }
  .bar-cache-read { background: #4ade80; }
  .bar-cache-write { background: #a78bfa; }
  .legend { display: flex; gap: 1.25rem; margin-top: 0.75rem; font-size: 0.75rem; color: #888; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 0.35rem; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .footer { margin-top: 2rem; color: #555; font-size: 0.75rem; text-align: center; }
</style>
</head>
<body>

<h1>clairvoy Report</h1>
<div class="subtitle">Generated ${escapeHtml(generatedAt)} &mdash; ${sessions.length} session${sessions.length !== 1 ? "s" : ""}</div>

<div class="cards">
  <div class="card">
    <div class="card-label">Total Cost</div>
    <div class="card-value cost mono">${formatCost(totalCost)}</div>
  </div>
  <div class="card">
    <div class="card-label">Sessions</div>
    <div class="card-value sessions mono">${sessions.length}</div>
  </div>
  <div class="card">
    <div class="card-label">Avg Score</div>
    <div class="card-value score mono">${avgScore}/100</div>
  </div>
  <div class="card">
    <div class="card-label">Total Tokens</div>
    <div class="card-value tokens mono">${formatTokens(totalTokens)}</div>
  </div>
</div>

<table id="session-table">
<thead>
<tr>
  <th data-col="0" data-type="string">Session<span class="sort-arrow"></span></th>
  <th data-col="1" data-type="string">Project<span class="sort-arrow"></span></th>
  <th data-col="2" data-type="string">Model<span class="sort-arrow"></span></th>
  <th data-col="3" data-type="number">Duration<span class="sort-arrow"></span></th>
  <th data-col="4" data-type="number">Turns<span class="sort-arrow"></span></th>
  <th data-col="5" data-type="number">Tools<span class="sort-arrow"></span></th>
  <th data-col="6" data-type="number">Tokens<span class="sort-arrow"></span></th>
  <th data-col="7" data-type="number">Cost<span class="sort-arrow"></span></th>
  <th data-col="8" data-type="number">Waste<span class="sort-arrow"></span></th>
  <th data-col="9" data-type="number">Score<span class="sort-arrow"></span></th>
  <th>Cost Breakdown</th>
</tr>
</thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>

<div class="legend">
  <div class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span> Input</div>
  <div class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span> Output</div>
  <div class="legend-item"><span class="legend-dot" style="background:#4ade80"></span> Cache Read</div>
  <div class="legend-item"><span class="legend-dot" style="background:#a78bfa"></span> Cache Write</div>
</div>

<div class="footer">clairvoy &mdash; token usage analytics for Claude Code</div>

<script>
(function() {
  var table = document.getElementById("session-table");
  var headers = table.querySelectorAll("th[data-col]");
  var tbody = table.querySelector("tbody");
  var currentCol = -1;
  var ascending = true;

  function parseVal(td, type) {
    var text = td.textContent.trim();
    if (type === "number") {
      var n = text.replace(/[^0-9.\\-]/g, "");
      return parseFloat(n) || 0;
    }
    return text.toLowerCase();
  }

  headers.forEach(function(th) {
    th.addEventListener("click", function() {
      var col = parseInt(th.getAttribute("data-col"));
      var type = th.getAttribute("data-type");

      if (currentCol === col) {
        ascending = !ascending;
      } else {
        currentCol = col;
        ascending = true;
      }

      headers.forEach(function(h) {
        h.querySelector(".sort-arrow").textContent = "";
      });
      th.querySelector(".sort-arrow").textContent = ascending ? " \\u25B2" : " \\u25BC";

      var rows = Array.from(tbody.querySelectorAll("tr"));
      rows.sort(function(a, b) {
        var va = parseVal(a.children[col], type);
        var vb = parseVal(b.children[col], type);
        if (va < vb) return ascending ? -1 : 1;
        if (va > vb) return ascending ? 1 : -1;
        return 0;
      });

      rows.forEach(function(row) { tbody.appendChild(row); });
    });
  });
})();
</script>

</body>
</html>
`;
}
