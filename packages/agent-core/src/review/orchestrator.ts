import type { Kaos } from '@moonshot-ai/kaos';

import { loadAgentsMd } from '../profile';
import type { AgentEvent } from '../rpc/events';
import { linkAbortSignal, userCancellationReason } from '../utils/abort';
import {
  listReviewBaseRefs,
  listReviewCommits,
  previewReviewTarget,
  resolveReviewTarget,
} from './git-target';
import {
  buildReviewBackground,
  buildStandardReviewerPrompt,
  candidateToFinalComment,
  summarizeReviewResult,
} from './prompts';
import type {
  ReviewBaseRef,
  ReviewCommit,
  ReviewDiffStats,
  ReviewResult,
  ReviewStartInput,
  ReviewTarget,
  ReviewTargetPreview,
} from './types';
import { ReviewWorkerDriver, type ReviewWorkerLauncher } from './worker-driver';
import { ReviewRuntimeError, type SessionReviewRuntime } from './runtime';

type ReviewOrchestratorEvent = Extract<
  AgentEvent,
  | { readonly type: 'review.started' }
  | { readonly type: 'review.completed' }
  | { readonly type: 'review.cancelled' }
  | { readonly type: 'review.failed' }
>;

export interface ReviewOrchestratorOptions {
  readonly kaos: Kaos;
  readonly systemKaos?: Kaos;
  readonly kimiHomeDir?: string;
  readonly runtime: SessionReviewRuntime;
  readonly launcher: ReviewWorkerLauncher;
  readonly parentToolCallId?: string;
  readonly parentToolCallUuid?: string;
  readonly signal?: AbortSignal;
  readonly loadRepoInstructions?: () => Promise<string>;
  readonly emitEvent?: (event: ReviewOrchestratorEvent) => void;
}

export class ReviewOrchestrator {
  private readonly controller = new AbortController();
  private readonly unlinkSourceSignal: () => void;

  constructor(private readonly options: ReviewOrchestratorOptions) {
    this.unlinkSourceSignal =
      options.signal === undefined
        ? () => {}
        : linkAbortSignal(options.signal, this.controller);
  }

  async listBaseRefs(): Promise<readonly ReviewBaseRef[]> {
    return listReviewBaseRefs(this.options.kaos);
  }

  async listCommits(): Promise<readonly ReviewCommit[]> {
    return listReviewCommits(this.options.kaos);
  }

  async previewTarget(target: ReviewTarget): Promise<ReviewTargetPreview> {
    this.signal.throwIfAborted();
    const resolved = await resolveReviewTarget(this.options.kaos, target);
    this.signal.throwIfAborted();
    const stats = await previewReviewTarget(this.options.kaos, resolved);
    this.signal.throwIfAborted();
    return { target: resolved, stats };
  }

  async start(input: ReviewStartInput): Promise<ReviewResult> {
    if (input.intensity !== 'standard') {
      throw new ReviewRuntimeError(
        `Review intensity "${input.intensity}" is not implemented yet`,
      );
    }

    let reviewStarted = false;
    try {
      if (this.options.runtime.getActiveRun() !== null) {
        throw new ReviewRuntimeError('A review is already active');
      }
      this.options.runtime.clear();

      const preview = await this.previewTarget(input.target);
      const repoInstructions = await this.loadRepoInstructions();
      this.signal.throwIfAborted();
      const background = buildReviewBackground({
        target: preview.target,
        input: { ...input, target: preview.target },
        stats: preview.stats,
        repoInstructions,
      });
      this.options.runtime.startReview(
        { ...input, target: preview.target },
        preview.stats,
        background,
      );
      reviewStarted = true;
      this.emitEvent({
        type: 'review.started',
        target: preview.target,
        intensity: input.intensity,
        focus: input.focus,
        stats: preview.stats,
      });

      const assignment = this.options.runtime.createAssignment({
        role: 'reviewer',
        perspective: 'standard',
        assignedFiles: preview.stats.files.map((file) => file.path),
        requiredCoverage: 'patch',
      });
      const driver = new ReviewWorkerDriver({
        runtime: this.options.runtime,
        launcher: this.options.launcher,
        assignment,
        profileName: 'reviewer',
        prompt: buildStandardReviewerPrompt({ background, assignment }),
        description: 'Review changes',
        parentToolCallId: this.options.parentToolCallId ?? 'review',
        parentToolCallUuid: this.options.parentToolCallUuid,
        runInBackground: false,
        signal: this.signal,
      });
      const worker = await driver.run();
      const comments = this.options.runtime
        .getComments({ state: 'candidate' })
        .map(candidateToFinalComment);
      const resultWithoutSummary = {
        target: preview.target,
        intensity: input.intensity,
        status: worker.status,
        stats: preview.stats,
        comments,
      };
      const summary = summarizeReviewResult(resultWithoutSummary);
      const result = {
        ...resultWithoutSummary,
        summary: worker.status === 'blocked' && worker.summary !== undefined
          ? `${summary}\n${worker.summary}`
          : summary,
      };
      this.emitEvent({
        type: 'review.completed',
        status: result.status === 'blocked' ? 'blocked' : 'complete',
        summary: result.summary,
        comments: result.comments,
      });
      return result;
    } catch (error) {
      if (this.signal.aborted && reviewStarted) {
        this.options.runtime.clear();
        this.emitEvent({ type: 'review.cancelled' });
      } else {
        this.emitEvent({
          type: 'review.failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      if (reviewStarted && this.options.runtime.getActiveRun() !== null) {
        this.options.runtime.finishReview();
      }
      this.unlinkSourceSignal();
    }
  }

  cancel(): void {
    this.controller.abort(userCancellationReason());
  }

  private get signal(): AbortSignal {
    return this.controller.signal;
  }

  private async loadRepoInstructions(): Promise<string> {
    if (this.options.loadRepoInstructions !== undefined) {
      return this.options.loadRepoInstructions();
    }
    const kaos = this.options.systemKaos ?? this.options.kaos;
    return loadAgentsMd(kaos, this.options.kimiHomeDir);
  }

  private emitEvent(event: ReviewOrchestratorEvent): void {
    this.options.emitEvent?.(event);
  }
}

export async function previewReviewOrchestratorTarget(
  kaos: Kaos,
  target: ReviewTarget,
): Promise<ReviewTargetPreview> {
  const resolved = await resolveReviewTarget(kaos, target);
  const stats: ReviewDiffStats = await previewReviewTarget(kaos, resolved);
  return { target: resolved, stats };
}
