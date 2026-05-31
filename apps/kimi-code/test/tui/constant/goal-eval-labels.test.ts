import { describe, expect, it } from 'vitest';

import { GOAL_EVAL_LABELS, pickGoalEvalLabel } from '#/tui/constant/goal-eval-labels';

describe('pickGoalEvalLabel', () => {
  it('always returns a label from the pool', () => {
    const pool = new Set<string>(GOAL_EVAL_LABELS);
    for (let i = 0; i < 200; i++) {
      expect(pool.has(pickGoalEvalLabel())).toBe(true);
    }
  });

  it('offers a pool of ten distinct, non-empty labels', () => {
    expect(GOAL_EVAL_LABELS).toHaveLength(10);
    expect(new Set(GOAL_EVAL_LABELS).size).toBe(10);
    for (const label of GOAL_EVAL_LABELS) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});
