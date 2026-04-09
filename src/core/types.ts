/**
 * Core types for clairvoy.
 *
 * These model the data we extract from Claude Code session logs
 * and the analysis we produce from them.
 *
 * RULE: This file must have zero imports from cli/ or store/.
 */

// ---------------------------------------------------------------------------
// Raw session log types (what Claude Code writes to JSONL)
// ---------------------------------------------------------------------------

export type RawEntryType =
  | "user"
  | "assistant"
  | "system"
  | "progress"
  | "file-history-snapshot"
  | "queue-operation"
  | "last-prompt"
  | "custom-title"
  | "agent-name"
  | "permission-mode"
  | "attachment";

export interface RawLogEntry {
  type: RawEntryType;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  message?: RawMessage;
  // assistant-specific
  requestId?: string;
  // system-specific
  subtype?: "turn_duration" | "api_error" | string;
  durationMs?: number;
  messageCount?: number;
  level?: string | null;
  error?: Record<string, unknown>;
  cause?: string | null;
  retryAttempt?: number | null;
  maxRetries?: number | null;
  retryInMs?: number | null;
  // session metadata
  isSidechain?: boolean;
  isMeta?: boolean;
  promptId?: string;
  permissionMode?: string;
  userType?: "external" | "internal" | string;
  entrypoint?: "cli" | "api" | string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  // custom-title
  customTitle?: string;
  // agent-name
  agentName?: string;
  // queue-operation
  operation?: string;
  content?: string;
  // last-prompt
  lastPrompt?: string;
  // progress
  data?: ProgressData;
  toolUseID?: string;
  parentToolUseID?: string;
  // attachment
  imagePasteIds?: number[];
  // tool result metadata (on user entries)
  toolUseResult?: Record<string, unknown>;
}

export interface ProgressData {
  type: "agent_progress" | "hook_progress" | "waiting_for_task" | string;
  message?: string;
  prompt?: string;
  agentId?: string;
  hookEvent?: string;
  hookName?: string;
  command?: string;
  taskDescription?: string;
  taskType?: string;
}

export interface RawMessage {
  role: "user" | "assistant";
  model?: string;
  id?: string;
  type?: string;
  stop_reason?: "end_turn" | "tool_use" | string;
  stop_sequence?: string | null;
  content: string | ContentBlock[];
  usage?: TokenUsage;
  context_management?: Record<string, unknown>;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  service_tier?: string;
  inference_geo?: string;
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
  speed?: string;
}

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: { type: string };
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id?: string;
  content: string | Array<{ type: string; text: string }>;
}

// ---------------------------------------------------------------------------
// Parsed session types (what our parser produces)
// ---------------------------------------------------------------------------

export interface SessionInfo {
  path: string;
  projectPath: string;
  sessionId: string;
  modifiedAt: Date;
}

export interface ParsedSession {
  sessionId: string;
  projectPath: string;
  startTime: string;
  endTime: string;
  model: string;
  turns: Turn[];
  totalUsage: AggregatedUsage;
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  cwd?: string;
  version?: string;
  gitBranch?: string;
  entrypoint?: string;
  customTitle?: string;
}

export interface Turn {
  index: number;
  timestamp: string;
  userMessage: string;
  assistantBlocks: ContentBlock[];
  toolCalls: ToolCall[];
  usage: TokenUsage;
  model: string;
  durationMs?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  resultText: string;
  resultTokenEstimate: number;
}

export interface AggregatedUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  turnCount: number;
  toolCallCount: number;
}

// ---------------------------------------------------------------------------
// Classification types (what our classifier produces)
// ---------------------------------------------------------------------------

export interface TokenBreakdown {
  session: ParsedSession;
  categories: CategoryBreakdown[];
  warnings: WasteWarning[];
  estimatedSavingsPercent: number;
  estimatedSavingsDollars: number;
  totalCostDollars: number;
}

export interface CategoryBreakdown {
  name: string;
  tokens: number;
  percent: number;
  description: string;
}

export interface WasteWarning {
  severity: "high" | "medium" | "low";
  message: string;
  tokensWasted: number;
}

// ---------------------------------------------------------------------------
// Attribution types (who caused these tokens?)
// ---------------------------------------------------------------------------

export type TokenSource = "user" | "claude" | "system";

export interface TurnAttribution {
  userCausedTokens: number;
  claudeCausedTokens: number;
  systemOverheadTokens: number;
  historyRetransmission: number;
}

export interface CompoundingInfo {
  turnContextSize: number;
  newTokensAdded: number;
  cumulativeRetransmissionCost: number;
  marginalCostOfVerbosity: number;
}

export interface AttributedTurn extends Turn {
  attribution: TurnAttribution;
  compounding: CompoundingInfo;
}

// ---------------------------------------------------------------------------
// Pattern detection types
// ---------------------------------------------------------------------------

export type PatternType =
  | "loop"
  | "dead-end"
  | "yak-shave"
  | "search-spiral"
  | "over-read"
  | "redundant-tool"
  | "retry-storm"
  | "edit-revert"
  | "verbose-output";

export interface DetectedPattern {
  type: PatternType;
  severity: "high" | "medium" | "low";
  turnRange: [number, number];
  description: string;
  tokensWasted: number;
  dollarCost: number;
  evidence: PatternEvidence[];
}

export interface PatternEvidence {
  turnIndex: number;
  type: "tool_call" | "text" | "usage_spike";
  summary: string;
}

// ---------------------------------------------------------------------------
// Scoring types
// ---------------------------------------------------------------------------

export type EfficiencyGrade = "S" | "A" | "B" | "C" | "D" | "F";

export interface SessionScore {
  overall: EfficiencyGrade;
  numericScore: number;
  dimensions: ScoreDimension[];
  achievements: Achievement[];
}

export interface ScoreDimension {
  name: string;
  score: number;
  grade: EfficiencyGrade;
  weight: number;
  description: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  progress?: number;
}

// ---------------------------------------------------------------------------
// Optimizer types
// ---------------------------------------------------------------------------

export interface OptimizationRule {
  id: string;
  name: string;
  claudeMdSnippet: string;
  targetPattern: PatternType | "general";
  estimatedSavingsPercent: number;
  breakEvenTurns: number;
  confidence: "high" | "medium" | "low";
}

export interface OptimizationReport {
  rules: OptimizationRule[];
  totalEstimatedSavings: number;
  claudeMdContent: string;
  claudeMdTokenCost: number;
  dataPoints: number;
}

// ---------------------------------------------------------------------------
// Doctor types
// ---------------------------------------------------------------------------

export interface Diagnosis {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  prescription: Prescription;
}

export interface Prescription {
  action: string;
  claudeMdRule?: string;
  effort: "trivial" | "easy" | "moderate";
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export interface StoredSessionSummary {
  sessionId: string;
  projectPath: string;
  analyzedAt: string;
  model: string;
  turnCount: number;
  totalTokens: number;
  totalCost: number;
  wastePercent: number;
  grade: EfficiencyGrade;
  numericScore: number;
  patterns: PatternType[];
  durationMs: number;
}

export interface UserConfig {
  excludeProjects?: string[];
}

// ---------------------------------------------------------------------------
// Config / persistent state types
// ---------------------------------------------------------------------------

export interface ClairvoyConfig {
  guardInstalled?: boolean;
  guardInstalledAt?: string;
  settingsBackupPath?: string;
  claudeMdInstalledAt?: string;
  claudeMdHash?: string;
  claudeMdPath?: string;
  budgetDollars?: number;           // budget cap for guard (e.g. 10 = warn at $10)
  thresholds?: PulseThresholds;
}

export interface PulseThresholds {
  contextWarningTokens: number;     // default: 150_000
  contextCriticalTokens: number;    // default: 300_000
  costWarningDollars: number;       // default: 10.0
  fileReReadThreshold: number;      // default: 3
  turnCountWarning: number;         // default: 50
  budgetDollars?: number;           // hard budget cap — strong warning when exceeded
}

export interface PulseState {
  sessionId: string;
  bytesRead: number;
  remainder: string;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  turnCount: number;
  toolCallCount: number;
  model: string;
  lastTimestamp: string;
  fileReadCounts: Record<string, number>;
  lastWarnings: Record<string, string>;  // warning key -> ISO timestamp (debounce)
  warningCount: number;
}

// ---------------------------------------------------------------------------
// Timeline types
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | "prompt"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "text_output"
  | "cost_spike"
  | "waste_flag";

export interface TimelineEvent {
  index: number;
  timestamp: string;
  type: TimelineEventType;
  turnIndex: number;
  durationMs?: number;
  tokenCount: number;
  costDollars: number;
  cumulativeCostDollars: number;
  contextSizeTokens: number;
  label: string;
  detail?: string;
  wasteFlags?: string[];
  toolName?: string;
  filePath?: string;
  severity?: "info" | "warning" | "critical";
}

export interface SessionTimeline {
  sessionId: string;
  projectPath: string;
  model: string;
  startTime: string;
  endTime: string;
  totalCostDollars: number;
  totalTokens: number;
  events: TimelineEvent[];
  hotspots: TimelineHotspot[];
}

export interface TimelineHotspot {
  turnRange: [number, number];
  reason: string;
  costDollars: number;
  percentOfTotal: number;
}

// ---------------------------------------------------------------------------
// Prompt coaching types
// ---------------------------------------------------------------------------

export interface PromptAnalysis {
  turnIndex: number;
  promptText: string;
  specificity: SpecificityScore;
  outcome: PromptOutcome;
  suggestion?: string;
}

export interface SpecificityScore {
  overall: number;
  hasFilePaths: boolean;
  hasLineNumbers: boolean;
  hasFunctionNames: boolean;
  hasErrorMessages: boolean;
  wordCount: number;
  isImperative: boolean;
}

export interface PromptOutcome {
  turnsToComplete: number;
  toolCallsTriggered: number;
  searchToolCalls: number;
  costDollars: number;
  wasteDetected: boolean;
}

export interface CoachingReport {
  sessionId: string;
  prompts: PromptAnalysis[];
  averageSpecificity: number;
  bestPrompt: PromptAnalysis | null;
  worstPrompt: PromptAnalysis | null;
  correlations: PromptCorrelation[];
}

export interface PromptCorrelation {
  factor: string;
  avgCostWith: number;
  avgCostWithout: number;
  improvement: string;
}

// ---------------------------------------------------------------------------
// Adaptation types
// ---------------------------------------------------------------------------

export interface AdaptationReport {
  installedAt: string;
  sessionsBeforeCount: number;
  sessionsAfterCount: number;
  beforeMetrics: AdaptMetrics;
  afterMetrics: AdaptMetrics;
  rulesKept: string[];
  rulesRemoved: Array<{ name: string; reason: string }>;
  rulesAdded: string[];
  updatedClaudeMdContent: string;
  proof: AdaptProof[];
}

export interface AdaptMetrics {
  avgCostPerSession: number;
  avgWastePercent: number;
  avgScore: number;
  avgTurns: number;
}

export interface AdaptProof {
  metric: string;
  before: number;
  after: number;
  change: string;
  improved: boolean;
}
