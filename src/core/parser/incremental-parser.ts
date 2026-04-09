/**
 * Incremental JSONL Parser
 *
 * Reads only NEW bytes appended to a JSONL file since the last check,
 * maintaining running totals of token usage. Designed for live monitoring
 * without re-reading the entire file on each update.
 */

import { openSync, readSync, fstatSync, closeSync } from "node:fs";

interface RawEntry {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | Array<{ type: string; [key: string]: unknown }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export class IncrementalParser {
  private bytesRead = 0;
  private remainder = "";
  private filePath: string;

  // Running totals
  totalInput = 0;
  totalOutput = 0;
  totalCacheRead = 0;
  totalCacheWrite = 0;
  turnCount = 0;
  toolCallCount = 0;
  model = "unknown";
  lastTimestamp = "";

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Read only new bytes since last call, update running totals. Returns true if new data was found. */
  update(): boolean {
    const fd = openSync(this.filePath, "r");
    try {
      const stat = fstatSync(fd);
      const fileSize = stat.size;

      if (fileSize <= this.bytesRead) {
        return false;
      }

      const newBytes = fileSize - this.bytesRead;
      const buf = Buffer.alloc(newBytes);
      readSync(fd, buf, 0, newBytes, this.bytesRead);
      this.bytesRead = fileSize;

      const chunk = this.remainder + buf.toString("utf-8");
      const lines = chunk.split("\n");

      // Last element may be an incomplete line; save it for next read
      this.remainder = lines.pop() ?? "";

      let foundNew = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let entry: RawEntry;
        try {
          entry = JSON.parse(trimmed) as RawEntry;
        } catch {
          continue; // skip malformed lines
        }

        foundNew = true;

        if (entry.timestamp) {
          this.lastTimestamp = entry.timestamp;
        }

        if (entry.type === "assistant" && entry.message) {
          const msg = entry.message;

          if (msg.model) {
            this.model = msg.model;
          }

          if (msg.usage) {
            this.totalInput += msg.usage.input_tokens ?? 0;
            this.totalOutput += msg.usage.output_tokens ?? 0;
            this.totalCacheRead += msg.usage.cache_read_input_tokens ?? 0;
            this.totalCacheWrite += msg.usage.cache_creation_input_tokens ?? 0;
          }

          // Count tool_use blocks in assistant content
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === "tool_use") {
                this.toolCallCount++;
              }
            }
          }
        }

        // Count user turns (real prompts, not tool results)
        if (entry.type === "user" && entry.message) {
          const content = entry.message.content;
          if (typeof content === "string") {
            this.turnCount++;
          } else if (Array.isArray(content)) {
            const hasText = content.some((b) => b.type === "text");
            const hasToolResult = content.some((b) => b.type === "tool_result");
            if (!hasToolResult || hasText) {
              this.turnCount++;
            }
          }
        }
      }

      return foundNew;
    } finally {
      closeSync(fd);
    }
  }
}
