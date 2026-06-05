import { randomUUID } from 'node:crypto';

import type { HeadlessCommand } from './commands';
import {
  readHeadlessControlRequest,
  waitForHeadlessControlApplied,
  writeHeadlessControlRequest,
} from './control';
import {
  readHeadlessRunStatus,
  type HeadlessApprovalStatus,
  type HeadlessRunStatus,
} from './status-file';

interface HeadlessOutput {
  write(chunk: string): boolean;
}

interface HeadlessRunIO {
  readonly stdout?: HeadlessOutput;
}

export async function runHeadless(
  command: HeadlessCommand,
  version: string,
  io: HeadlessRunIO = {},
): Promise<void> {
  void version;
  const stdout = io.stdout ?? process.stdout;

  switch (command.kind) {
    case 'status':
      await runHeadlessStatus(command.options, stdout);
      return;
    case 'goal-control':
      await runHeadlessGoalControl(command.options, stdout);
      return;
    case 'run':
      throw new Error('headless run is not implemented yet');
  }
}

async function runHeadlessStatus(
  options: Extract<HeadlessCommand, { readonly kind: 'status' }>['options'],
  stdout: HeadlessOutput,
): Promise<void> {
  const status = await readHeadlessRunStatus(options.file);
  if (options.json) {
    stdout.write(`${JSON.stringify(status)}\n`);
    return;
  }
  stdout.write(formatHeadlessStatus(status));
}

async function runHeadlessGoalControl(
  options: Extract<HeadlessCommand, { readonly kind: 'goal-control' }>['options'],
  stdout: HeadlessOutput,
): Promise<void> {
  const status = await readHeadlessRunStatus(options.file);
  const control = status.control;
  if (control === null) {
    throw new Error('Status file does not contain a control path.');
  }
  if (!control.supportedActions.includes(options.action)) {
    throw new Error(`Headless run does not support control action "${options.action}".`);
  }

  const commandId = `cmd_${randomUUID()}`;
  await writeHeadlessControlRequest(control.path, {
    schemaVersion: 1,
    runId: status.runId,
    commandId,
    action: options.action,
    requestedAt: new Date().toISOString(),
  });

  if (options.wait) {
    const applied = await waitForHeadlessControlApplied({
      statusFile: options.file,
      commandId,
      timeoutMs: 30_000,
    });
    if (applied !== null) {
      stdout.write(`control ${applied.result} - ${applied.action} - command ${commandId}\n`);
      return;
    }
  }

  const written = await readHeadlessControlRequest(control.path);
  stdout.write(`control pending - ${written?.action ?? options.action} - command ${commandId}\n`);
}

function formatHeadlessStatus(status: HeadlessRunStatus): string {
  const parts: string[] = [status.state];
  if (status.sessionId !== null) parts.push(`session ${status.sessionId}`);
  if (status.turnId !== null) parts.push(`turn ${status.turnId}`);
  if (status.summary.toolCallCount > 0) {
    parts.push(`tools ${status.summary.completedToolCallCount}/${status.summary.toolCallCount}`);
  }
  if (status.activeTool !== null) parts.push(`tool ${status.activeTool.name}`);
  if (status.approval !== null) {
    parts.push(
      `${approvalLabel(status.approval.decision)} - ${status.approval.kind} - ${status.approval.message}`,
    );
  }
  if (status.goal !== null) {
    parts.push(
      `goal ${status.goal.status ?? 'unknown'} - turns ${status.goal.turnsUsed ?? 0} - tokens ${status.goal.tokensUsed ?? 0}`,
    );
  }
  if (status.files.outputDir !== null) {
    const completedResponses = status.files.responses.filter(
      (response) => response.state === 'completed',
    ).length;
    parts.push(`files ${completedResponses} - output ${status.files.outputDir}`);
  }
  if (status.control?.lastRequest !== null && status.control?.lastRequest !== undefined) {
    const request = status.control.lastRequest;
    if (status.control.lastApplied?.commandId === request.commandId) {
      parts.push(
        `control ${status.control.lastApplied.result} - ${request.action} - command ${request.commandId}`,
      );
    } else {
      parts.push(`control pending - ${request.action} - command ${request.commandId}`);
    }
  }
  parts.push(`updated ${status.updatedAt}`);
  return `${parts.join(' - ')}\n`;
}

function approvalLabel(decision: HeadlessApprovalStatus['decision']): string {
  return decision === 'required' ? 'approval required' : `approval ${decision}`;
}
