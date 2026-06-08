import { describe, expect, it } from 'vitest';

import {
  buildGoalBlockedReasonPrompt,
  buildGoalCompletionMessage,
  buildGoalCompletionSummaryPrompt,
} from '#/agent/goal/completion';
import type { GoalSnapshot } from '#/session/goal';

function snapshot(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    objective: 'work',
    status: 'complete',
    turnsUsed: 3,
    tokensUsed: 12_500,
    wallClockMs: 260_000,
    terminalReason: 'all tests pass',
    ...overrides,
  } as unknown as GoalSnapshot;
}

describe('buildGoalCompletionMessage', () => {
  it('includes the reason, exact turns, tokens, and time', () => {
    const text = buildGoalCompletionMessage(snapshot());
    expect(text).toContain('Goal complete — all tests pass.');
    expect(text).toContain('3 turns');
    expect(text).toContain('12.5k tokens');
    expect(text).toContain('4m20s');
  });

  it('omits the dash when there is no reason and singularizes one turn', () => {
    const text = buildGoalCompletionMessage(snapshot({ terminalReason: undefined, turnsUsed: 1, tokensUsed: 800, wallClockMs: 5000 }));
    expect(text).toContain('Goal complete.');
    expect(text).not.toContain('—');
    expect(text).toContain('1 turn ');
    expect(text).toContain('800 tokens');
    expect(text).toContain('5s');
  });

  it('uses stronger ASCII-only wording in the completion prompt sent to the model', () => {
    const text = buildGoalCompletionSummaryPrompt(snapshot());
    expect(text).toContain('Goal completed successfully: all tests pass.');
    expect(text).toContain('Write a concise final message for the user');
    expect(text).not.toContain('✓');
    expect(text).not.toContain('—');
  });

  it('uses stronger wording in the blocked prompt sent to the model', () => {
    const text = buildGoalBlockedReasonPrompt(snapshot({ status: 'blocked' }));
    expect(text).toContain('Goal blocked.');
    expect(text).toContain('State that the goal is blocked');
    expect(text).toContain('concrete blocker');
  });
});
