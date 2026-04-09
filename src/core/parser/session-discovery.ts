/**
 * Session Discovery
 *
 * Finds and lists Claude Code session log files.
 * Sessions live at ~/.claude/projects/<project-id>/<session-id>.jsonl
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { SessionInfo } from "../types.js";

/**
 * Find the Claude Code projects directory.
 */
export function getProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * List all available session files, sorted by modification time (newest first).
 */
export function listSessions(limit = 20): SessionInfo[] {
  const projectsDir = getProjectsDir();
  if (!existsSync(projectsDir)) return [];

  const sessions: SessionInfo[] = [];

  for (const projectDir of readdirSync(projectsDir)) {
    const projectPath = join(projectsDir, projectDir);
    if (!statSync(projectPath).isDirectory()) continue;

    for (const file of readdirSync(projectPath)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(projectPath, file);
      if (!statSync(filePath).isFile()) continue;

      sessions.push({
        path: filePath,
        projectPath: projectDir,
        sessionId: basename(file, ".jsonl"),
        modifiedAt: statSync(filePath).mtime,
      });
    }
  }

  sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return sessions.slice(0, limit);
}
