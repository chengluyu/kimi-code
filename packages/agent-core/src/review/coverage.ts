import type { ReviewAssignment } from './types';

export interface ReviewLineRange {
  readonly start: number;
  readonly end: number;
}

export interface ReviewPatchCoverageInput {
  readonly path: string;
  readonly hunkId?: string;
  readonly ranges?: readonly ReviewLineRange[];
}

export interface ReviewFileVersionCoverageInput {
  readonly path: string;
  readonly lineOffset: number;
  readonly nLines: number;
  readonly totalLines: number;
}

export interface ReviewCoverageMissingItem {
  readonly path: string;
  readonly required: 'patch' | 'full_file';
}

interface FileCoverage {
  readonly patchHunkIds: Set<string>;
  patchRead: boolean;
  fileRead: boolean;
  totalLines: number | undefined;
  patchRanges: ReviewLineRange[];
  fileRanges: ReviewLineRange[];
}

export class ReviewCoverageTracker {
  private readonly coverage = new Map<string, Map<string, FileCoverage>>();

  recordPatchRead(assignmentId: string, input: ReviewPatchCoverageInput): void {
    const file = this.fileCoverage(assignmentId, input.path);
    file.patchRead = true;
    if (input.hunkId !== undefined) file.patchHunkIds.add(input.hunkId);
    file.patchRanges = mergeRanges([...file.patchRanges, ...normalizeRanges(input.ranges ?? [])]);
  }

  recordFileVersionRead(assignmentId: string, input: ReviewFileVersionCoverageInput): void {
    const file = this.fileCoverage(assignmentId, input.path);
    file.fileRead = true;
    file.totalLines = input.totalLines;
    file.fileRanges = mergeRanges([
      ...file.fileRanges,
      ...normalizeRanges([
        {
          start: input.lineOffset,
          end: input.lineOffset + Math.max(0, input.nLines) - 1,
        },
      ]),
    ]);
  }

  hasLineCoverage(assignmentId: string, path: string, line: number): boolean {
    const file = this.coverage.get(assignmentId)?.get(path);
    if (file === undefined) return false;
    return rangeContains(file.patchRanges, line) || rangeContains(file.fileRanges, line);
  }

  missingCoverage(assignment: ReviewAssignment): readonly ReviewCoverageMissingItem[] {
    return assignment.assignedFiles
      .filter((path) => !this.hasRequiredCoverage(assignment, path))
      .map((path) => ({ path, required: assignment.requiredCoverage }));
  }

  hasRequiredCoverage(assignment: ReviewAssignment, path: string): boolean {
    const file = this.coverage.get(assignment.id)?.get(path);
    if (file === undefined) return false;
    if (assignment.requiredCoverage === 'patch') return file.patchRead;
    return isFullFileCovered(file);
  }

  snapshot(assignmentId: string): ReadonlyMap<string, Readonly<FileCoverage>> {
    return this.coverage.get(assignmentId) ?? new Map();
  }

  clear(): void {
    this.coverage.clear();
  }

  private fileCoverage(assignmentId: string, path: string): FileCoverage {
    let assignment = this.coverage.get(assignmentId);
    if (assignment === undefined) {
      assignment = new Map();
      this.coverage.set(assignmentId, assignment);
    }

    let file = assignment.get(path);
    if (file === undefined) {
      file = {
        patchHunkIds: new Set(),
        patchRead: false,
        fileRead: false,
        totalLines: undefined,
        patchRanges: [],
        fileRanges: [],
      };
      assignment.set(path, file);
    }
    return file;
  }
}

function isFullFileCovered(file: FileCoverage): boolean {
  if (!file.fileRead) return false;
  if (file.totalLines === 0) return true;
  if (file.totalLines === undefined) return false;
  let nextLine = 1;
  for (const range of file.fileRanges) {
    if (range.start > nextLine) return false;
    nextLine = Math.max(nextLine, range.end + 1);
    if (nextLine > file.totalLines) return true;
  }
  return false;
}

function normalizeRanges(ranges: readonly ReviewLineRange[]): readonly ReviewLineRange[] {
  return ranges
    .map((range) => ({
      start: Math.max(1, Math.trunc(range.start)),
      end: Math.trunc(range.end),
    }))
    .filter((range) => range.end >= range.start);
}

function mergeRanges(ranges: readonly ReviewLineRange[]): ReviewLineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ReviewLineRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || range.start > previous.end + 1) {
      merged.push({ ...range });
      continue;
    }
    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, range.end),
    };
  }
  return merged;
}

function rangeContains(ranges: readonly ReviewLineRange[], line: number): boolean {
  return ranges.some((range) => range.start <= line && line <= range.end);
}
