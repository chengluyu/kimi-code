import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

const DEFAULT_APPROVE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'SetTodoList',
  'TodoList',
  'TaskList',
  'TaskOutput',
  'CronList',
  'WebSearch',
  'FetchURL',
  'Agent',
  'AskUserQuestion',
  'Skill',
  // Goal control tools have no side effects on the world: GetGoal reads, and
  // UpdateGoal only records the goal's own status (it's the model's only way to
  // stop the goal, so prompting for it would be friction with no safety value).
  'GetGoal',
  'UpdateGoal',
]);

export class DefaultToolApprovePermissionPolicy implements PermissionPolicy {
  readonly name = 'default-tool-approve';

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (!DEFAULT_APPROVE_TOOLS.has(context.toolCall.name)) return;
    return {
      kind: 'approve',
    };
  }
}
