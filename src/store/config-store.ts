/**
 * Config Store
 *
 * Persistent configuration and pulse state at ~/.clairvoy/.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ClairvoyConfig, PulseState } from "../core/types.js";

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

export function getConfigDir(): string {
  return join(homedir(), ".clairvoy");
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ClairvoyConfig = {
  thresholds: {
    contextWarningTokens: 150_000,
    contextCriticalTokens: 300_000,
    costWarningDollars: 10,
    fileReReadThreshold: 3,
    turnCountWarning: 50,
  },
};

// ---------------------------------------------------------------------------
// Config read/write
// ---------------------------------------------------------------------------

export function loadConfig(): ClairvoyConfig {
  const configPath = join(getConfigDir(), "config.json");
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as ClairvoyConfig;
    // Merge defaults for any missing thresholds
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      thresholds: {
        ...DEFAULT_CONFIG.thresholds!,
        ...parsed.thresholds,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: ClairvoyConfig): void {
  const dir = getConfigDir();
  ensureDir(dir);
  const configPath = join(dir, "config.json");
  const tmpPath = configPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  renameSync(tmpPath, configPath);
}

// ---------------------------------------------------------------------------
// Pulse state read/write
// ---------------------------------------------------------------------------

function getPulseStateDir(): string {
  return join(getConfigDir(), "pulse-state");
}

export function loadPulseState(sessionId: string): PulseState | null {
  const statePath = join(getPulseStateDir(), `${sessionId}.json`);
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const raw = readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as PulseState;
  } catch {
    return null;
  }
}

export function savePulseState(sessionId: string, state: PulseState): void {
  const dir = getPulseStateDir();
  ensureDir(dir);
  const statePath = join(dir, `${sessionId}.json`);
  const tmpPath = statePath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmpPath, statePath);
}
