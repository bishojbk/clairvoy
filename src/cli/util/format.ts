/**
 * Shared formatting helpers for CLI output.
 */

/**
 * Decode Claude Code's project path encoding.
 * -Users-foo-bar → /Users/foo/bar
 */
export function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
}

/**
 * Format a number with locale thousands separator, right-padded.
 */
export function padNum(n: number): string {
  return n.toLocaleString().padStart(10);
}

/**
 * Format a relative time string from a date.
 */
export function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Format a duration from start/end ISO timestamps.
 */
export function getDuration(start: string, end: string): string {
  if (!start || !end) return "unknown";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "unknown";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (mins > 60) {
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  }
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Create an ASCII bar visualization.
 */
export function makeBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}
