import type { Agent } from '..';
import { flags } from '../../flags';
import { GoalInjector } from './goal';
import type { DynamicInjector } from './injector';
import { PermissionModeInjector } from './permission-mode';
import { PluginSessionStartInjector } from './plugin-session-start';
import { PlanModeInjector } from './plan-mode';

export class InjectionManager {
  private readonly injectors: DynamicInjector[];
  // Goal context is injected at continuation boundaries (turn start, each
  // continuation, after compaction) via `injectGoal()`, NOT in the per-step
  // `inject()` loop. Boundary-cadence append-only injection keeps one fresh copy
  // near the tail without mutating the prefix, so prompt caching is preserved and
  // the context does not grow O(n^2) the way per-step injection did.
  private readonly goalInjector: GoalInjector | null;

  constructor(protected readonly agent: Agent) {
    // Explicit push order keeps the injector sequence obvious. Plan mode and
    // permission mode are operational constraints applied per step.
    const injectors: DynamicInjector[] = [];
    injectors.push(new PluginSessionStartInjector(agent));
    injectors.push(new PlanModeInjector(agent));
    injectors.push(new PermissionModeInjector(agent));
    this.injectors = injectors;
    this.goalInjector =
      flags.enabled('goal-command') && agent.type === 'main' ? new GoalInjector(agent) : null;
  }

  async inject(): Promise<void> {
    for (const injector of this.injectors) {
      await injector.inject();
    }
  }

  /**
   * Appends a fresh goal-context reminder at a continuation boundary. Append-only
   * (never mutates the prefix) so prompt caching is preserved; no-ops when goal
   * mode is off, the agent is not the main agent, or there is nothing to inject.
   */
  async injectGoal(): Promise<void> {
    await this.goalInjector?.inject();
  }

  onContextClear(): void {
    for (const injector of this.lifecycleInjectors()) {
      injector.onContextClear();
    }
  }

  onContextCompacted(compactedCount: number): void {
    for (const injector of this.lifecycleInjectors()) {
      try {
        injector.onContextCompacted(compactedCount);
      } catch {
        continue;
      }
    }
  }

  /** Per-step injectors plus the boundary goal injector, for lifecycle events. */
  private lifecycleInjectors(): DynamicInjector[] {
    return this.goalInjector === null ? this.injectors : [this.goalInjector, ...this.injectors];
  }
}
