import type { GoalSnapshot } from '../../session/goal';

/**
 * The deterministic goal-completion message. When the evaluator confirms a goal
 * `complete`, the continuation controller appends this verbatim as an assistant
 * message (so it persists in the conversation and renders on resume), and the
 * TUI renders the same text live. It is built from the final snapshot — not the
 * model — so the figures (turns / tokens / time) are guaranteed exact.
 */
export function buildGoalCompletionMessage(goal: GoalSnapshot): string {
  const head = `✓ Goal complete${goal.terminalReason ? ` — ${goal.terminalReason}` : ''}.`;
  const turns = `${goal.turnsUsed} turn${goal.turnsUsed === 1 ? '' : 's'}`;
  const stats = `Worked ${turns} over ${formatElapsed(goal.wallClockMs)}, using ${formatTokens(goal.tokensUsed)} tokens.`;
  return `${head}\n${stats}`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${(minutes % 60).toString().padStart(2, '0')}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
