/**
 * Hooks Manager
 *
 * Reads, writes, and merges Claude Code's ~/.claude/settings.json
 * to install and remove clairvoy guard hooks.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

export type { ClaudeSettings, HookEntry, HookCommand };

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

// ---------------------------------------------------------------------------
// Read / write Claude settings
// ---------------------------------------------------------------------------

export function readClaudeSettings(): ClaudeSettings {
  const settingsPath = getSettingsPath();
  if (!existsSync(settingsPath)) {
    return {};
  }
  try {
    const raw = readFileSync(settingsPath, "utf-8");
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    return {};
  }
}

export function writeClaudeSettings(settings: ClaudeSettings): void {
  const settingsPath = getSettingsPath();
  const dir = join(homedir(), ".claude");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = settingsPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(settings, null, 2), "utf-8");
  renameSync(tmpPath, settingsPath);
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function backupSettings(): string {
  const backupDir = join(homedir(), ".clairvoy", "backups");
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `settings.${timestamp}.json`);
  const settingsPath = getSettingsPath();
  if (existsSync(settingsPath)) {
    copyFileSync(settingsPath, backupPath);
  } else {
    writeFileSync(backupPath, "{}", "utf-8");
  }
  return backupPath;
}

// ---------------------------------------------------------------------------
// Hook detection constant
// ---------------------------------------------------------------------------

const TOKENLENS_HOOK_MARKER = "clairvoy pulse";

const TOKENLENS_HOOK_ENTRY: HookEntry = {
  matcher: "",
  hooks: [
    {
      type: "command",
      command: "clairvoy pulse 2>/dev/null || true",
      timeout: 5000,
    },
  ],
};

// ---------------------------------------------------------------------------
// Install / remove / detect
// ---------------------------------------------------------------------------

function hasTokenlensHook(entries: HookEntry[]): boolean {
  return entries.some((entry) =>
    entry.hooks.some((h) => h.command.includes(TOKENLENS_HOOK_MARKER)),
  );
}

export function isGuardInstalled(settings: ClaudeSettings): boolean {
  const postToolUse = settings.hooks?.PostToolUse;
  if (!postToolUse || !Array.isArray(postToolUse)) return false;
  return hasTokenlensHook(postToolUse);
}

export function installGuardHooks(settings: ClaudeSettings): ClaudeSettings {
  const result = { ...settings };
  if (!result.hooks) {
    result.hooks = {};
  }
  if (!result.hooks.PostToolUse) {
    result.hooks.PostToolUse = [];
  }
  // Don't add if already present
  if (hasTokenlensHook(result.hooks.PostToolUse)) {
    return result;
  }
  result.hooks.PostToolUse = [...result.hooks.PostToolUse, TOKENLENS_HOOK_ENTRY];
  return result;
}

export function removeGuardHooks(settings: ClaudeSettings): ClaudeSettings {
  const result = { ...settings };
  if (!result.hooks?.PostToolUse) {
    return result;
  }
  result.hooks.PostToolUse = result.hooks.PostToolUse.filter(
    (entry) => !entry.hooks.some((h) => h.command.includes(TOKENLENS_HOOK_MARKER)),
  );
  // Clean up empty array
  if (result.hooks.PostToolUse.length === 0) {
    delete result.hooks.PostToolUse;
  }
  // Clean up empty hooks object
  if (Object.keys(result.hooks).length === 0) {
    delete result.hooks;
  }
  return result;
}
