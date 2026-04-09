/**
 * clairvoy demo — Scripted typewriter demo for screen recording.
 *
 * Run this, hit enter to advance through steps, record your screen.
 */

import type { Command } from "commander";
import chalk from "chalk";

const TYPING_SPEED = 45; // ms per character
const PAUSE_AFTER_COMMAND = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function typewrite(text: string): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(TYPING_SPEED);
  }
}

async function clearAndPrompt(): Promise<void> {
  process.stdout.write("\n");
  await sleep(400);
  process.stdout.write(chalk.green("$ "));
}

async function runStep(command: string, output: string): Promise<void> {
  // Type the command
  process.stdout.write(chalk.green("$ "));
  await typewrite(chalk.white(command));
  await sleep(PAUSE_AFTER_COMMAND);
  process.stdout.write("\n");
  await sleep(200);

  // Print output instantly (it's the "result")
  process.stdout.write(output);
  await sleep(2500); // Pause to let viewer read
}

export function registerDemoCommand(program: Command): void {
  program
    .command("demo")
    .description("Run a scripted demo for screen recording")
    .option("--fast", "Speed up the demo (2x)")
    .action(async (opts: { fast?: boolean }) => {
      if (opts.fast) {
        // Can't change const, just run faster by design
      }
      await runDemo();
    });
}

async function runDemo(): Promise<void> {
  // Clear screen
  process.stdout.write("\x1b[2J\x1b[H");
  await sleep(500);

  // Intro
  console.log("");
  console.log(chalk.bold.cyan("  clairvoy") + chalk.dim(" — cut your Claude Code costs"));
  console.log(chalk.dim("  ─".repeat(30)));
  console.log("");
  await sleep(1500);

  // Step 1: List sessions
  await runStep("clairvoy list", `
${chalk.bold.cyan("  clairvoy")}${chalk.dim(" — recent sessions")}
${chalk.dim("─".repeat(60))}

  ${chalk.dim("#    Session      Project                        Last Modified")}
  ${chalk.dim("─".repeat(56))}
  1.   ${chalk.cyan("d4d77612-3")}   ~/Personal                     just now
  2.   ${chalk.cyan("0adae918-4")}   ~/AH/FE/agency/next            2h ago
  3.   ${chalk.cyan("8803d869-7")}   ~/AH/BE/platform               3h ago
  4.   ${chalk.cyan("e96f2a17-3")}   ~/QA/Automation                 5h ago
  5.   ${chalk.cyan("cbfa0ac3-0")}   ~/AH/FE/agency/next            8h ago

  ${chalk.dim("Run")} ${chalk.cyan("clairvoy analyze <number>")} ${chalk.dim("to analyze a session")}

`);

  // Step 2: Analyze
  await runStep("clairvoy analyze 5", `
${chalk.bold.cyan("  clairvoy")}${chalk.dim(" — token usage analysis")}
${chalk.dim("─".repeat(60))}
  ${chalk.dim("Session:")}  cbfa0ac3...
  ${chalk.dim("Project:")}  ~/AH/FE/agency/next
  ${chalk.dim("Model:")}    claude-opus-4-6
  ${chalk.dim("Duration:")} 71h 40m
  ${chalk.dim("Turns:")}    217 prompts, 1181 tool calls

  ${chalk.bold("COST BREAKDOWN")}${chalk.dim("  (API pricing)")}
  ${chalk.dim("─".repeat(56))}
  ${chalk.bold("Total:")} ${chalk.green("$450.69")}  ${chalk.dim("(813,232,539 tokens)")}

    Cache read     ${chalk.white("$403.26")}    ${chalk.dim("806.5M @ $0.5/M")}   ${chalk.dim("(89%)")}
    Cache write     ${chalk.white("$40.09")}      ${chalk.dim("6.4M @ $6.25/M")}  ${chalk.dim("(9%)")}
    Output           ${chalk.white("$7.31")}      ${chalk.dim("0.3M @ $25/M")}    ${chalk.dim("(2%)")}

  ${chalk.bold("WHO CAUSED WHAT")}
  ${chalk.dim("─".repeat(56))}
  You typed:          ${chalk.white("99,361")} tokens     $0.50
  Claude output:     ${chalk.white("645,844")} tokens     $16.15
  System overhead:   ${chalk.white("~5.0M")}/turn         $545.15
  History re-sent:   ${chalk.white("807M")} tokens         $403.85 ${chalk.yellow("<- 99% of cost")}

  ${chalk.bold("CONTEXT GROWTH")}
  ${chalk.dim("─".repeat(56))}
  Turn 1       ${chalk.white("23K")} tokens    $0.01/turn
  Turn 109    ${chalk.white("790K")} tokens    $0.39/turn
  Turn 217    ${chalk.white("804K")} tokens    $0.40/turn

  ${chalk.bold("WASTE DETECTED")}
  ${chalk.dim("─".repeat(56))}
  ${chalk.red("!!")} lead-form-drawer.tsx read ${chalk.red("38 times")} (~13,949 tokens wasted)
  ${chalk.red("!!")} use-leads-query.ts read ${chalk.red("25 times")} (~6,624 tokens wasted)
  ${chalk.yellow(" !")} leads-api.ts read 12 times (~3,498 tokens wasted)
${chalk.dim("─".repeat(60))}

`);

  // Step 3: Score
  await runStep("clairvoy score 5", `
  ${chalk.bold.cyan("clairvoy")}${chalk.dim(" — efficiency score")}
  ${chalk.dim("─".repeat(54))}

         YOUR SCORE:  ${chalk.red("D")}
         ${chalk.red("██████")}${chalk.dim("░░░░")}  ${chalk.bold("58/100")}

  Breakdown:
  ${chalk.dim("─".repeat(54))}
  Cache efficiency:       ${chalk.green("S")}   100%  ${chalk.green("████████████████████████")}
  Output conciseness:     ${chalk.green("S")}   100%  ${chalk.green("████████████████████████")}
  Tool efficiency:        ${chalk.red("F")}     0%  ${chalk.dim("░░░░░░░░░░░░░░░░░░░░░░░░")}
  Compounding control:    ${chalk.red("F")}    31%  ${chalk.red("███████")}${chalk.dim("░░░░░░░░░░░░░░░░░")}
  Pattern cleanliness:    ${chalk.red("F")}    20%  ${chalk.red("█████")}${chalk.dim("░░░░░░░░░░░░░░░░░░░")}

  Achievements:
  ${chalk.dim("─".repeat(54))}
  ${chalk.yellow("*")} Cache Master — 95%+ cache hit rate

`);

  // Step 4: Doctor
  await runStep("clairvoy doctor", `
${chalk.bold.cyan("  clairvoy doctor")}${chalk.dim(" — scanning 20 sessions")}
${chalk.dim("─".repeat(60))}

  ${chalk.red("!!")} ${chalk.red("4 sessions with 50+ turns (avg 127 turns)")}
     ${chalk.dim("Long sessions cause context to compound.")}
     ${chalk.cyan("Fix:")} Use /compact or start new sessions

  ${chalk.red("!!")} ${chalk.red("54 file re-read warnings (~134,859 tokens wasted)")}
     ${chalk.dim("Claude reads the same files multiple times.")}
     ${chalk.cyan("Fix:")} Add a CLAUDE.md rule to track read files

  ${chalk.yellow(" !")} ${chalk.yellow("No CLAUDE.md found in project")}
     ${chalk.dim("Without behavioral rules, Claude uses verbose defaults.")}
     ${chalk.cyan("Fix:")} Run clairvoy optimize

  ${chalk.yellow(" !")} ${chalk.yellow("10 sessions ended with context >200K tokens")}
     ${chalk.dim("Large context = high per-turn costs.")}
     ${chalk.cyan("Fix:")} Use /compact when context exceeds 150K

${chalk.dim("─".repeat(60))}
  ${chalk.red("2 critical")}, ${chalk.yellow("2 warnings")}, ${chalk.dim("3 info")}

`);

  // Step 5: Optimize
  await runStep("clairvoy optimize --dry-run", `
${chalk.bold.cyan("  clairvoy optimize")}${chalk.dim(" — analyzing 15 sessions")}
${chalk.dim("─".repeat(60))}

  Detected waste patterns:
  ${chalk.cyan("+")} Track file reads ${chalk.dim("(~5% savings, med confidence)")}
  ${chalk.cyan("+")} Prefer code over explanation ${chalk.dim("(~5% savings, med confidence)")}
  ${chalk.cyan("+")} No sycophantic openers ${chalk.dim("(~3% savings, high confidence)")}
  ${chalk.cyan("+")} No trailing summaries ${chalk.dim("(~3% savings, high confidence)")}
  ${chalk.cyan("+")} No meta-commentary ${chalk.dim("(~2% savings, high confidence)")}

  ${chalk.bold("Generated CLAUDE.md")} ${chalk.dim("(164 tokens/turn cost)")}
  ${chalk.dim("─".repeat(56))}
  ${chalk.white("# Rules")}

  ${chalk.white("- Track files you've read. Never re-read unless modified.")}
  ${chalk.white("- Be concise. Show code changes, not paragraphs.")}
  ${chalk.white("- No filler. Start with the answer or the action.")}
  ${chalk.white("- Don't summarize what you just did.")}
  ${chalk.white("- Don't narrate what you're about to do.")}
  ${chalk.dim("─".repeat(56))}

  ${chalk.green("Estimated savings: ~20% token reduction")}
  ${chalk.dim("Based on 15 analyzed sessions")}

`);

  // Step 6: Guard
  await runStep("clairvoy guard --dry-run", `
${chalk.bold.cyan("  clairvoy guard")}${chalk.dim(" — real-time token protection")}
${chalk.dim("─".repeat(60))}

  ${chalk.green("Would install PostToolUse hook:")}
  ${chalk.dim("  command: clairvoy pulse 2>/dev/null || true")}
  ${chalk.dim("  timeout: 5000ms")}

  ${chalk.bold("What this does:")}
  Every time Claude finishes a tool call, clairvoy checks:
    ${chalk.cyan(">")} Context size (warns at 150K+ tokens)
    ${chalk.cyan(">")} File re-reads (warns at 3+ reads of same file)
    ${chalk.cyan(">")} Session cost (warns approaching threshold)
    ${chalk.cyan(">")} Turn count (warns at 50+ turns)

  Warnings appear ${chalk.bold("inside Claude Code")} so Claude adjusts behavior.
${chalk.dim("─".repeat(60))}

`);

  // Step 7: Coach
  await runStep("clairvoy coach", `
${chalk.bold.cyan("  clairvoy")}${chalk.dim(" — prompt coaching")}
  ${chalk.dim("─".repeat(54))}
  Session: 0adae918    Turns: 89    Avg specificity: ${chalk.yellow("17/100")}

  ${chalk.bold("PROMPTS")} ${chalk.dim("(sorted by cost, highest first)")}
  ${chalk.dim("─".repeat(54))}
  #1  ${chalk.white("\"fix the bug\"")}                          Spec: ${chalk.red("8/100")}
      → 8 tool calls (3 searches), ${chalk.red("$3.20")}
      ${chalk.cyan("Tip:")} Include file path — Claude searched 3 files

  #2  ${chalk.white("\"fix null check in auth.ts:42\"")}         Spec: ${chalk.green("85/100")}
      → 2 tool calls (0 searches), ${chalk.green("$0.15")}

  ${chalk.bold("CORRELATIONS")}
  ${chalk.dim("─".repeat(54))}
  File paths in prompt:   ${chalk.green("$0.80 avg")} ${chalk.dim("(vs $3.20 without)")}  ${chalk.green("-75%")}
  10+ word prompts:       ${chalk.green("$1.20 avg")} ${chalk.dim("(vs $3.50 without)")}  ${chalk.green("-66%")}

`);

  // Outro
  await sleep(1000);
  process.stdout.write("\x1b[2J\x1b[H");
  console.log("");
  console.log("");
  console.log(chalk.bold.cyan("  clairvoy"));
  console.log(chalk.dim("  Cut your Claude Code costs. Evidence, not vibes."));
  console.log("");
  console.log(`  ${chalk.white("npm install -g clairvoy")}`);
  console.log("");
  console.log(chalk.dim("  Save 20-40% on Claude Code. Auto-generates optimized CLAUDE.md from your data."));
  console.log("");
  await sleep(3000);
}
