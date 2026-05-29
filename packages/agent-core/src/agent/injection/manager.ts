import type { Agent } from '..';
import { flags } from '../../flags';
import { GoalInjector } from './goal';
import type { DynamicInjector } from './injector';
import { PermissionModeInjector } from './permission-mode';
import { PluginSessionStartInjector } from './plugin-session-start';
import { PlanModeInjector } from './plan-mode';

export class InjectionManager {
  private readonly injectors: DynamicInjector[];

  constructor(protected readonly agent: Agent) {
    // Explicit push order keeps the injector sequence obvious. The goal is the
    // work objective; plan mode and permission mode remain operational
    // constraints applied after that objective.
    const injectors: DynamicInjector[] = [];
    injectors.push(new PluginSessionStartInjector(agent));
    if (flags.enabled('goal-command') && agent.type === 'main') {
      injectors.push(new GoalInjector(agent));
    }
    injectors.push(new PlanModeInjector(agent));
    injectors.push(new PermissionModeInjector(agent));
    this.injectors = injectors;
  }

  async inject(): Promise<void> {
    for (const injector of this.injectors) {
      await injector.inject();
    }
  }

  onContextClear(): void {
    for (const injector of this.injectors) {
      injector.onContextClear();
    }
  }

  onContextCompacted(compactedCount: number): void {
    for (const injector of this.injectors) {
      try {
        injector.onContextCompacted(compactedCount);
      } catch {
        continue;
      }
    }
  }
}
