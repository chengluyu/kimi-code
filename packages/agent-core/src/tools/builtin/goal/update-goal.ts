/**
 * UpdateGoalTool — the model's single lever over the goal lifecycle. It sets the
 * goal's status directly; the turn driver reads the status at each turn boundary
 * and stops (`complete` / `blocked` / `paused`) or keeps going (still active).
 *
 * The argument is intentionally just a status enum — no reason or evidence. The
 * model explains itself in its own reply; the status is the machine-readable
 * signal. The tool is only offered to the model while a goal exists (see the
 * `loopTools` filter in the tool manager).
 */

import type { Agent } from '#/agent';
import { z } from 'zod';

import { buildGoalCompletionMessage } from '../../../agent/goal/completion';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { goalErrorResult, isGoalToolError, requireGoalStore } from './shared';
import DESCRIPTION from './update-goal.md';

export const UpdateGoalToolInputSchema = z
  .object({
    status: z
      .enum(['complete', 'paused', 'blocked'])
      .describe('The lifecycle status to set for the current goal.'),
  })
  .strict();

export type UpdateGoalToolInput = z.infer<typeof UpdateGoalToolInputSchema>;

export class UpdateGoalTool implements BuiltinTool<UpdateGoalToolInput> {
  readonly name = 'UpdateGoal' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(UpdateGoalToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: UpdateGoalToolInput): ToolExecution {
    const store = requireGoalStore(this.agent, this.name);
    if (isGoalToolError(store)) return store;

    return {
      description: `Setting goal status: ${args.status}`,
      approvalRule: this.name,
      execute: async () => {
        try {
          if (args.status === 'complete') {
            const completed = await store.markComplete({ actor: 'model' });
            // `complete` is transient — markComplete announces then clears the
            // record. Append the deterministic completion line as an assistant
            // message so it persists in the conversation and renders on resume.
            if (completed !== null) {
              this.agent.context.appendMessage({
                role: 'assistant',
                content: [{ type: 'text', text: buildGoalCompletionMessage(completed) }],
                toolCalls: [],
                origin: { kind: 'system_trigger', name: 'goal_completion' },
              });
            }
            return { output: 'Goal marked complete.' };
          }
          if (args.status === 'blocked') {
            await store.markBlocked({ actor: 'model' });
            return { output: 'Goal marked blocked.' };
          }
          await store.pauseGoal({ actor: 'model' });
          return { output: 'Goal paused.' };
        } catch (error) {
          return goalErrorResult(error);
        }
      },
    };
  }
}
