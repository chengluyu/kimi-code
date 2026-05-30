import { describe, expect, it } from 'vitest';

import { buildGoalReportLines, goalPanelTitle } from '#/tui/components/messages/goal-panel';
import { darkColors } from '#/tui/theme/colors';
import type { GoalSnapshot } from '@moonshot-ai/kimi-code-sdk';

const ANSI_SGR = /\[[0-9;]*m/g;
function strip(lines: string[]): string {
  return lines.join('\n').replaceAll(ANSI_SGR, '');
}

function goal(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    goalId: 'g1',
    objective: 'Ship the goal status box',
    status: 'active',
    turnsUsed: 7,
    tokensUsed: 128_400,
    wallClockMs: 252_000, // 4m12s
    budget: {
      turnBudget: null,
      tokenBudget: null,
      wallClockBudgetMs: null,
    },
    ...overrides,
  } as GoalSnapshot;
}

function lines(g: GoalSnapshot): string {
  return strip(buildGoalReportLines({ colors: darkColors, goal: g }));
}

describe('buildGoalReportLines', () => {
  it('renders the objective as a blockquote and key counters for an active goal', () => {
    const out = lines(goal());
    expect(out).toContain('▌ Ship the goal status box');
    expect(out).toContain('Running');
    expect(out).toContain('4m 12s');
    expect(out).toContain('7 evaluated');
    expect(out).toContain('128.4k'); // formatTokenCount
  });

  it('shows a no-stop-condition note for an unbounded active goal', () => {
    expect(lines(goal())).toContain('No stop condition — runs until evaluated complete.');
  });

  it('shows a Stop row with progress when a turn budget is set', () => {
    const out = lines(goal({ budget: { turnBudget: 20, tokenBudget: null, wallClockBudgetMs: null } } as Partial<GoalSnapshot>));
    expect(out).toContain('Stop');
    expect(out).toContain('after 20 turns (7/20)');
    expect(out).not.toContain('No stop condition');
  });

  it('includes the completion criterion when present', () => {
    const out = lines(goal({ completionCriterion: 'tests pass' }));
    expect(out).toContain('✓ tests pass');
  });

  it('shows the latest evaluator verdict and reason', () => {
    const out = lines(goal({ lastEvaluatorVerdict: 'continue', lastEvaluatorReason: 'more to do' }));
    expect(out).toContain('Evaluator');
    expect(out).toContain('continue — more to do');
  });

  it('renders a terminal goal with a Status row and no Stop row', () => {
    const out = lines(goal({ status: 'complete', terminalReason: 'all done' }));
    expect(out).toContain('Status');
    expect(out).toContain('complete — all done');
    expect(out).not.toContain('No stop condition');
    expect(out).not.toMatch(/^Stop/m);
  });

  it('titles the box with the status', () => {
    expect(goalPanelTitle(goal())).toBe(' Goal · active ');
    expect(goalPanelTitle(goal({ status: 'complete' }))).toBe(' Goal · complete ');
  });

  it('truncates a very long objective with an ellipsis', () => {
    const long = 'word '.repeat(200).trim();
    const out = lines(goal({ objective: long }));
    expect(out).toContain('…');
  });
});
