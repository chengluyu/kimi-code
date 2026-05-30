import type { GoalSnapshot } from '@moonshot-ai/kimi-code-sdk';

import { parseGoalCommand } from '#/tui/commands/index';

/**
 * Headless goal-mode support for the `kimi -p "/goal <objective>"` prompt path.
 *
 * The continuation loop runs inside a single main-agent turn, so the existing
 * prompt-turn waiter already blocks until the goal reaches a terminal state.
 * This module adds the create-on-entry parsing, a machine-readable summary, and
 * the terminal-status → exit-code mapping.
 */

export interface HeadlessGoalCreate {
  readonly objective: string;
  readonly replace: boolean;
  readonly budgetLimits: {
    tokenBudget?: number;
    turnBudget?: number;
    wallClockBudgetMs?: number;
  };
}

/**
 * Distinct exit codes per terminal goal status. `complete` (and an absent goal,
 * which should not happen on the create path) map to success. A turn abort
 * (e.g. SIGINT) parks the goal as `paused` — not complete — so it maps to its
 * own non-zero code rather than success.
 */
export const GOAL_EXIT_CODES = {
  complete: 0,
  error: 1,
  blocked: 3,
  impossible: 4,
  budget_limited: 5,
  paused: 6,
  cancelled: 7,
} as const;

export function goalExitCode(status: string | undefined): number {
  switch (status) {
    case 'blocked':
      return GOAL_EXIT_CODES.blocked;
    case 'impossible':
      return GOAL_EXIT_CODES.impossible;
    case 'budget_limited':
      return GOAL_EXIT_CODES.budget_limited;
    case 'paused':
      return GOAL_EXIT_CODES.paused;
    case 'cancelled':
      return GOAL_EXIT_CODES.cancelled;
    case 'error':
      return GOAL_EXIT_CODES.error;
    default:
      return GOAL_EXIT_CODES.complete;
  }
}

const GOAL_PREFIX = /^\/goal(\s|$)/;

/**
 * Parses a headless prompt into a goal-create request, or `undefined` when the
 * prompt is not a `/goal` create command (so the caller runs it as a normal
 * prompt). Non-create goal subcommands are not supported headless and fall
 * through to normal prompt handling.
 */
export function parseHeadlessGoalCreate(
  prompt: string,
  flagEnabled: boolean,
): HeadlessGoalCreate | undefined {
  if (!flagEnabled) return undefined;
  const trimmed = prompt.trim();
  if (!GOAL_PREFIX.test(trimmed)) return undefined;
  const args = trimmed.replace(/^\/goal/, '').trim();
  const parsed = parseGoalCommand(args);
  if (parsed.kind !== 'create') return undefined;
  return { objective: parsed.objective, replace: parsed.replace, budgetLimits: parsed.budgetLimits };
}

export interface GoalSummary {
  readonly type: 'goal.summary';
  readonly goalId: string | null;
  readonly status: string | null;
  readonly reason: string | null;
  readonly turnsUsed: number | null;
  readonly tokensUsed: number | null;
  readonly wallClockMs: number | null;
  readonly evidence: readonly { summary: string }[] | null;
}

export function goalSummaryJson(goal: GoalSnapshot | null): GoalSummary {
  if (goal === null) {
    return {
      type: 'goal.summary',
      goalId: null,
      status: null,
      reason: null,
      turnsUsed: null,
      tokensUsed: null,
      wallClockMs: null,
      evidence: null,
    };
  }
  return {
    type: 'goal.summary',
    goalId: goal.goalId,
    status: goal.status,
    reason: goal.terminalReason ?? null,
    turnsUsed: goal.turnsUsed,
    tokensUsed: goal.tokensUsed,
    wallClockMs: goal.wallClockMs,
    evidence:
      goal.terminalEvidence?.map((e) => ({ summary: e.summary })) ??
      goal.lastEvidence?.map((e) => ({ summary: e.summary })) ??
      null,
  };
}

export function formatGoalSummaryText(goal: GoalSnapshot | null): string {
  if (goal === null) return 'Goal: no goal found.';
  const parts = [`Goal [${goal.status}]`];
  if (goal.terminalReason !== undefined) parts.push(goal.terminalReason);
  return `${parts.join(': ')} (turns: ${goal.turnsUsed}, tokens: ${goal.tokensUsed})`;
}
