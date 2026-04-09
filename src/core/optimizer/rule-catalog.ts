/**
 * Rule Catalog
 *
 * Library of all possible CLAUDE.md optimization rules.
 * Each rule targets a specific waste pattern and has a known token cost.
 */

import type { OptimizationRule, PatternType } from "../types.js";

/**
 * All available optimization rules, ordered by typical impact.
 */
export const RULE_CATALOG: OptimizationRule[] = [
  // -------------------------------------------------------------------------
  // Output reduction rules (target: Claude's response verbosity)
  // -------------------------------------------------------------------------
  {
    id: "no-sycophancy",
    name: "No sycophantic openers",
    claudeMdSnippet: "- No filler. No \"Great question!\", \"Absolutely!\", \"Sure!\". Start with the answer or the action.",
    targetPattern: "general",
    estimatedSavingsPercent: 3,
    breakEvenTurns: 2,
    confidence: "high",
  },
  {
    id: "no-meta-commentary",
    name: "No meta-commentary",
    claudeMdSnippet: "- Don't narrate what you're about to do. Just do it. Don't say \"Let me check\" — just check.",
    targetPattern: "general",
    estimatedSavingsPercent: 2,
    breakEvenTurns: 2,
    confidence: "high",
  },
  {
    id: "no-trailing-summary",
    name: "No trailing summaries",
    claudeMdSnippet: "- Don't summarize what you just did after completing a task. The diff speaks for itself.",
    targetPattern: "verbose-output",
    estimatedSavingsPercent: 3,
    breakEvenTurns: 3,
    confidence: "high",
  },
  {
    id: "no-unsolicited-suggestions",
    name: "No unsolicited suggestions",
    claudeMdSnippet: "- Only do what's asked. Don't suggest additional improvements, refactors, or \"you might also want to\" ideas.",
    targetPattern: "general",
    estimatedSavingsPercent: 2,
    breakEvenTurns: 3,
    confidence: "medium",
  },
  {
    id: "concise-output",
    name: "Prefer code over explanation",
    claudeMdSnippet: "- Be concise. Show code changes, not paragraphs explaining them. One sentence of context max.",
    targetPattern: "verbose-output",
    estimatedSavingsPercent: 5,
    breakEvenTurns: 3,
    confidence: "medium",
  },
  {
    id: "no-echoing-code",
    name: "Don't echo back code",
    claudeMdSnippet: "- After editing a file, don't echo back the entire file or large code blocks. The edit tool confirms the change.",
    targetPattern: "verbose-output",
    estimatedSavingsPercent: 4,
    breakEvenTurns: 3,
    confidence: "high",
  },
  {
    id: "no-option-lists",
    name: "Don't list multiple options",
    claudeMdSnippet: "- Don't present multiple approaches. Pick the best one and do it. If it fails, try the next.",
    targetPattern: "verbose-output",
    estimatedSavingsPercent: 3,
    breakEvenTurns: 4,
    confidence: "medium",
  },
  {
    id: "minimal-error-explanation",
    name: "Minimal error explanations",
    claudeMdSnippet: "- When an error occurs, state what went wrong in one line and fix it. Don't explain the error theory.",
    targetPattern: "verbose-output",
    estimatedSavingsPercent: 2,
    breakEvenTurns: 3,
    confidence: "medium",
  },

  // -------------------------------------------------------------------------
  // Tool efficiency rules (target: reducing tool call volume and input tokens)
  // -------------------------------------------------------------------------
  {
    id: "track-file-reads",
    name: "Track file reads",
    claudeMdSnippet: "- Track files you've already read. Never re-read a file unless it was modified since the last read.",
    targetPattern: "redundant-tool",
    estimatedSavingsPercent: 5,
    breakEvenTurns: 5,
    confidence: "medium",
  },
  {
    id: "targeted-reads",
    name: "Use targeted file reads",
    claudeMdSnippet: "- When reading files, use offset/limit to read only the relevant section. Don't read entire files when you need 10 lines.",
    targetPattern: "over-read",
    estimatedSavingsPercent: 4,
    breakEvenTurns: 4,
    confidence: "medium",
  },
  {
    id: "grep-before-read",
    name: "Search before reading",
    claudeMdSnippet: "- Use Grep to find what you need before reading whole files. Search first, read the specific location second.",
    targetPattern: "over-read",
    estimatedSavingsPercent: 3,
    breakEvenTurns: 4,
    confidence: "medium",
  },
  {
    id: "batch-file-reads",
    name: "Batch file operations",
    claudeMdSnippet: "- When you need to check multiple files, read them in parallel in one turn. Don't read one file per turn.",
    targetPattern: "redundant-tool",
    estimatedSavingsPercent: 3,
    breakEvenTurns: 5,
    confidence: "medium",
  },
  {
    id: "single-shell-command",
    name: "One command, not a loop",
    claudeMdSnippet: "- Use a single shell command with proper flags instead of running the same command in a loop. Prefer `find`, `xargs`, and glob patterns.",
    targetPattern: "loop",
    estimatedSavingsPercent: 2,
    breakEvenTurns: 5,
    confidence: "medium",
  },
  {
    id: "avoid-cat-in-bash",
    name: "Use Read tool, not cat/head/tail",
    claudeMdSnippet: "- Use the Read tool to read files, not cat/head/tail via Bash. The Read tool is cheaper and the output is structured.",
    targetPattern: "redundant-tool",
    estimatedSavingsPercent: 2,
    breakEvenTurns: 3,
    confidence: "high",
  },

  // -------------------------------------------------------------------------
  // Behavioral rules (target: session-level waste patterns)
  // -------------------------------------------------------------------------
  {
    id: "no-loops",
    name: "Stop and ask before looping",
    claudeMdSnippet: "- If an approach fails twice, stop and explain the issue instead of retrying the same strategy.",
    targetPattern: "loop",
    estimatedSavingsPercent: 8,
    breakEvenTurns: 10,
    confidence: "low",
  },
  {
    id: "compact-early",
    name: "Use /compact proactively",
    claudeMdSnippet: "- When context feels large (many file reads, long session), suggest /compact to the user before continuing.",
    targetPattern: "general",
    estimatedSavingsPercent: 5,
    breakEvenTurns: 8,
    confidence: "low",
  },
  {
    id: "plan-before-coding",
    name: "Plan before implementing",
    claudeMdSnippet: "- For multi-step tasks, outline the plan in 3-5 bullet points before writing code. Reduces dead-ends and reverts.",
    targetPattern: "dead-end",
    estimatedSavingsPercent: 6,
    breakEvenTurns: 8,
    confidence: "medium",
  },
  {
    id: "no-speculative-edits",
    name: "Don't edit speculatively",
    claudeMdSnippet: "- Don't make edits you're unsure about. Verify the approach first (read the code, run a test), then edit once correctly.",
    targetPattern: "edit-revert",
    estimatedSavingsPercent: 5,
    breakEvenTurns: 6,
    confidence: "medium",
  },
  {
    id: "narrow-search-first",
    name: "Start with narrow searches",
    claudeMdSnippet: "- Search for specific symbols or strings first. Only broaden the search if the narrow search returns nothing.",
    targetPattern: "search-spiral",
    estimatedSavingsPercent: 3,
    breakEvenTurns: 5,
    confidence: "medium",
  },
  {
    id: "one-task-per-session",
    name: "Separate sessions for separate tasks",
    claudeMdSnippet: "- Start a new session for unrelated tasks. Don't mix bug fixes with feature work in the same session — context compounds.",
    targetPattern: "general",
    estimatedSavingsPercent: 4,
    breakEvenTurns: 10,
    confidence: "low",
  },

  // -------------------------------------------------------------------------
  // Prompt quality rules (target: user-side improvements)
  // -------------------------------------------------------------------------
  {
    id: "specific-prompts",
    name: "Include file paths in prompts",
    claudeMdSnippet: "- When the user mentions a file, function, or error, include the exact path and line number if known.",
    targetPattern: "search-spiral",
    estimatedSavingsPercent: 3,
    breakEvenTurns: 4,
    confidence: "medium",
  },
  {
    id: "paste-errors",
    name: "Paste exact error messages",
    claudeMdSnippet: "- When debugging, paste the exact error message rather than paraphrasing it. This avoids unnecessary investigation turns.",
    targetPattern: "dead-end",
    estimatedSavingsPercent: 2,
    breakEvenTurns: 3,
    confidence: "medium",
  },
];

/**
 * Get rules relevant to a set of detected waste patterns.
 */
export function getRelevantRules(
  detectedPatterns: PatternType[],
  hasAnySycophancy: boolean,
  hasAnyMeta: boolean,
  hasAnySuggestions: boolean,
  sessionCount?: number,
): OptimizationRule[] {
  const relevant: OptimizationRule[] = [];
  const patternSet = new Set(detectedPatterns);

  for (const rule of RULE_CATALOG) {
    if (rule.targetPattern === "general") {
      // General rules: match by specific waste types or apply universally
      if (rule.id === "no-sycophancy" && hasAnySycophancy) relevant.push(rule);
      else if (rule.id === "no-meta-commentary" && hasAnyMeta) relevant.push(rule);
      else if (rule.id === "no-unsolicited-suggestions" && hasAnySuggestions) relevant.push(rule);
      // Universal general rules always apply
      else if (rule.id === "compact-early") relevant.push(rule);
      else if (rule.id === "one-task-per-session" && (sessionCount || 0) >= 5) relevant.push(rule);
      continue;
    }

    if (patternSet.has(rule.targetPattern)) {
      relevant.push(rule);
    }
  }

  return relevant;
}
