import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { ErrorCodes, KimiError } from '@moonshot-ai/agent-core';

const SESSION_RUN_LOCK_FILE = 'run.lock';
const LIVE_UNKNOWN_LOCK: SessionRunLockFile = {
  schemaVersion: 1,
  runId: '',
  pid: process.pid,
  createdAt: '',
  command: '',
};

export interface SessionRunLock {
  readonly sessionDir: string;
  readonly runId: string;
  release(): Promise<void>;
}

export interface AcquireSessionRunLockInput {
  readonly sessionDir: string;
  readonly runId: string;
  readonly pid: number;
  readonly command: string;
}

interface SessionRunLockFile {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly pid: number;
  readonly createdAt: string;
  readonly command: string;
}

export async function acquireSessionRunLock(
  input: AcquireSessionRunLockInput,
): Promise<SessionRunLock> {
  const lockPath = getSessionRunLockPath(input.sessionDir);

  try {
    return await createSessionRunLock(input, lockPath);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  if (await isExistingLockLive(lockPath)) {
    throw createSessionLockedError(input.sessionDir, lockPath);
  }

  await unlink(lockPath).catch((error: unknown) => {
    if (!isNotFound(error)) throw error;
  });

  try {
    return await createSessionRunLock(input, lockPath);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw createSessionLockedError(input.sessionDir, lockPath);
    }
    throw error;
  }
}

function getSessionRunLockPath(sessionDir: string): string {
  return join(sessionDir, SESSION_RUN_LOCK_FILE);
}

async function createSessionRunLock(
  input: AcquireSessionRunLockInput,
  lockPath: string,
): Promise<SessionRunLock> {
  const file = await open(lockPath, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify({
      schemaVersion: 1,
      runId: input.runId,
      pid: input.pid,
      createdAt: new Date().toISOString(),
      command: input.command,
    } satisfies SessionRunLockFile, null, 2)}\n`, 'utf-8');
  } finally {
    await file.close();
  }

  return {
    sessionDir: input.sessionDir,
    runId: input.runId,
    release: async (): Promise<void> => {
      const existing = await readLockFile(lockPath);
      if (existing?.runId !== input.runId) return;
      await unlink(lockPath).catch((error: unknown) => {
        if (!isNotFound(error)) throw error;
      });
    },
  };
}

async function isExistingLockLive(lockPath: string): Promise<boolean> {
  const existing = await readLockFile(lockPath);
  if (existing === null) return false;
  return isPidAlive(existing.pid);
}

async function readLockFile(lockPath: string): Promise<SessionRunLockFile | null> {
  let raw: string;
  try {
    raw = await readFile(lockPath, 'utf-8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isLockFile(parsed)) return LIVE_UNKNOWN_LOCK;
    return parsed;
  } catch {
    return LIVE_UNKNOWN_LOCK;
  }
}

function isLockFile(value: unknown): value is SessionRunLockFile {
  if (typeof value !== 'object' || value === null) return false;
  const lock = value as Partial<SessionRunLockFile>;
  return (
    lock.schemaVersion === 1 &&
    typeof lock.runId === 'string' &&
    Number.isInteger(lock.pid) &&
    typeof lock.createdAt === 'string' &&
    typeof lock.command === 'string'
  );
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  if (typeof process.kill !== 'function') return true;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
    if (code === 'ESRCH') return false;
    return true;
  }
}

function createSessionLockedError(sessionDir: string, lockPath: string): KimiError {
  return new KimiError(
    ErrorCodes.SESSION_LOCKED,
    `Session at "${sessionDir}" is already locked by another run.`,
    { details: { sessionDir, lockPath } },
  );
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
