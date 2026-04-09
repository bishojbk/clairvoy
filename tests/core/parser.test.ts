import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSessionFromString } from "../../src/core/parser/session-parser.js";

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("parseSessionFromString", () => {
  const content = loadFixture("minimal-session.jsonl");
  const session = parseSessionFromString(content, "test-session-001.jsonl");

  it("extracts session ID", () => {
    expect(session.sessionId).toBe("test-session-001");
  });

  it("extracts model from assistant messages", () => {
    expect(session.model).toBe("claude-sonnet-4-6");
  });

  it("groups messages into turns", () => {
    expect(session.turns.length).toBe(2);
  });

  it("extracts user message text", () => {
    expect(session.turns[0].userMessage).toBe("Fix the bug in auth.ts");
    expect(session.turns[1].userMessage).toBe("Now run the tests");
  });

  it("collects tool calls per turn", () => {
    // Turn 0: Read + Edit
    expect(session.turns[0].toolCalls.length).toBe(2);
    expect(session.turns[0].toolCalls[0].name).toBe("Read");
    expect(session.turns[0].toolCalls[1].name).toBe("Edit");

    // Turn 1: Bash
    expect(session.turns[1].toolCalls.length).toBe(1);
    expect(session.turns[1].toolCalls[0].name).toBe("Bash");
  });

  it("extracts tool result text", () => {
    const readResult = session.turns[0].toolCalls[0].resultText;
    expect(readResult).toContain("export function login");
  });

  it("aggregates token usage", () => {
    expect(session.totalUsage.turnCount).toBe(2);
    expect(session.totalUsage.toolCallCount).toBe(3);
    expect(session.totalUsage.totalInputTokens).toBeGreaterThan(0);
    expect(session.totalUsage.totalOutputTokens).toBeGreaterThan(0);
    expect(session.totalUsage.totalCacheReadTokens).toBeGreaterThan(0);
    expect(session.totalUsage.totalCacheCreationTokens).toBeGreaterThan(0);
  });

  it("extracts timestamps", () => {
    expect(session.startTime).toBe("2026-04-01T10:00:00Z");
    expect(session.turns[0].timestamp).toBe("2026-04-01T10:00:00Z");
  });

  it("extracts session metadata", () => {
    expect(session.metadata.cwd).toBe("/Users/test/project");
    expect(session.metadata.version).toBe("2.1.80");
    expect(session.metadata.entrypoint).toBe("cli");
    expect(session.metadata.gitBranch).toBe("main");
  });

  it("handles empty/malformed input gracefully", () => {
    const empty = parseSessionFromString("", "empty.jsonl");
    expect(empty.turns.length).toBe(0);
    expect(empty.totalUsage.turnCount).toBe(0);

    const malformed = parseSessionFromString('{"broken\n{"also":"broken', "bad.jsonl");
    expect(malformed.turns.length).toBe(0);
  });
});
