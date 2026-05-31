/**
 * Spinner labels shown while the independent goal evaluator runs between a
 * stopped step and the continuation decision. One is picked at random each time
 * evaluation starts (and held stable for that phase) so the status line reads as
 * a varied "checking in on progress" rather than a monotone, jargon-y
 * "Evaluating the goal…" every single turn. All phrase the same idea — the
 * runtime is reviewing the work so far to decide whether to keep going.
 */
export const GOAL_EVAL_LABELS = [
  'Reviewing progress…',
  'Assessing progress…',
  'Checking the goal…',
  'Reviewing the work so far…',
  'Weighing progress…',
  'Checking progress…',
  'Gauging progress…',
  'Reviewing where things stand…',
  'Assessing the work so far…',
  'Checking goal progress…',
] as const;

/** Picks a random evaluation label from the pool. */
export function pickGoalEvalLabel(): string {
  const index = Math.floor(Math.random() * GOAL_EVAL_LABELS.length);
  return GOAL_EVAL_LABELS[index] ?? GOAL_EVAL_LABELS[0];
}
