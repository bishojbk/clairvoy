# clairvoy

**Cut your Claude Code costs 20-40%. Not another usage tracker.**

ccusage shows you the bill. clairvoy cuts it.

---

## One session cost $406. $160 was preventable.

Real numbers from a real project. clairvoy found:
- **Edit called 50x in one turn** (115 tool calls total)
- **Same file read 21 times** in one session
- **Edit revert spanning 100+ turns** (~168K tokens wasted)
- **97% of the cost** was history retransmission

## Quick Start

```bash
npm install -g clairvoy

# Instant overview of your spending
clairvoy

# Diagnose systemic waste
clairvoy doctor

# Generate + install optimized CLAUDE.md (top 3 rules, instant)
clairvoy quickfix

# Full 22-rule analysis with measured savings
clairvoy optimize --install

# Enable real-time protection with $10 budget cap
clairvoy guard --budget 10
```

## What Makes This Different

| Feature | ccusage | Claude-Code-Usage-Monitor | clairvoy |
|---|---|---|---|
| Usage tracking | Yes | Yes | Yes |
| Cost breakdown | Yes | Basic | Detailed (attribution + compounding) |
| CLAUDE.md generation | No | No | **Yes — from YOUR data** |
| Before/after measurement | No | No | **Yes (--adapt)** |
| Real-time guard hooks | No | No | **Yes (PostToolUse hooks)** |
| Budget caps | No | No | **Yes (--budget)** |
| Prompt coaching | No | No | **Yes (specificity scoring)** |
| Efficiency grading | No | No | **Yes (S-F, 5 dimensions)** |
| Model routing recommendations | No | No | **Yes** |

## Features

### optimize
Generates a CLAUDE.md from YOUR actual waste patterns. 22 rules in the catalog, each with measured savings and break-even analysis. `--install` applies it, `--adapt` measures before/after and refines rules over time.

```
clairvoy optimize --install
```

### guard
Installs PostToolUse hooks into Claude Code. Warns you in real-time when context grows large, files are re-read, or costs spike. Set a budget cap with `--budget`.

```
clairvoy guard --budget 10
```

### quickfix
Zero-decision optimization. Scans 5 recent sessions, picks top 3 rules, installs a minimal CLAUDE.md. Under 5 seconds.

```
clairvoy quickfix
```

### doctor
Scans 20 sessions, finds systemic problems (long sessions, no CLAUDE.md, file re-read patterns, high tool call counts), gives prescriptions with effort estimates.

```
clairvoy doctor
```

### coach
Scores your prompts by specificity (0-100) and shows cost correlation. Prompts with file paths cost **75% less**. Prompts with line numbers cost **89% less**.

```
clairvoy coach
```

### model routing
After `clairvoy analyze`, shows which turns could've used a cheaper model. Real example: 51% savings by routing simple turns to Haiku.

## All Commands

| Category | Commands |
|----------|----------|
| **Measure** | `list` `analyze` `score` `replay` `trends` `live` |
| **Optimize** | `optimize` `quickfix` `doctor` `coach` `tips` |
| **Protect** | `guard` `unguard` `pulse` |
| **Compare** | `compare` `benchmark` `export` |

## How It Works

1. You use Claude Code normally
2. Claude Code writes JSONL session logs to `~/.claude/projects/`
3. clairvoy reads those logs — classifies tokens, detects waste patterns, scores efficiency
4. Generates a CLAUDE.md with targeted rules from a 22-rule optimization catalog
5. Each rule has estimated savings %, break-even turns, and confidence level

**No API keys. No config. Works offline. 100% local. Your data never leaves your machine.**

## For Max/Pro Plan Users

You're not paying per token — but wasteful sessions burn through your allowance faster. clairvoy makes every session more efficient so you code longer before hitting rate limits.

## For API Users

Every wasted token is money. clairvoy found $160 of preventable waste in a single $406 session. Real savings, measured.

## Requirements

- Node.js >= 20
- Claude Code (any version/plan)

## License

MIT
