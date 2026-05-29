# `/goal` Implementation Tracker

High-level goal: implement the `/goal` command (autonomous goal mode) in the kimi-code
coding agent, following the phase plans in this directory.

## Status legend

- ⬜ Not started
- 🟡 In progress
- ✅ Complete

## Phases

| Phase | Title | Status | Commit |
|-------|-------|--------|--------|
| 1a | Core session goal state | ✅ | 040a06c |
| 1b | Goal audit and resume lifecycle | ✅ | 70ee3c6 |
| 2  | SDK API and `/goal` command surface | ✅ | (this commit) |
| 3  | Model goal tools | 🟡 | — |
| 4a | Goal context injection | ⬜ | — |
| 4b | Goal usage accounting | ⬜ | — |
| 4c | Goal continuation loop | ⬜ | — |
| 4d | Goal evaluator | ⬜ | — |
| 5  | End-to-end integration and gates | ⬜ | — |
| 6  | Headless goal mode and hardening | ⬜ | — |

## Detours / Notes

(None yet.)

## Log

- Phase 1a complete: `SessionGoalStore` (`session/goal.ts`) owns durable goal state in
  `metadata.custom.goal`; `Session`/`Agent` wired with the store; goal error codes added;
  `updateSessionMetadata` reserves `custom.goal`. 33 goal tests pass; typecheck clean; no
  agent-core imports in app src.

### Detour notes (Phase 1a)

- `createGoal` accepts an optional `actor` (default `'user'`) so both the user path and the
  Phase 3 model `CreateGoal` tool can set `startedBy`/`updatedBy`. Plan signature unchanged
  otherwise.
- `recordEvaluatorVerdict` is implemented in 1a (state side); the consecutive-failure increment
  path is deferred to Phase 4d (recordEvaluatorVerdict resets failures on a produced verdict).
- Audit records (`goal.*` wire entries) are intentionally NOT wired in 1a — that is Phase 1b.

### Phase 1b

- Added 7 `goal.*` wire record types; replay ignores them (state is from `state.json`).
- `SessionGoalStore` gained lazy `auditSink`, pending queue, `flushPendingRecords()`,
  `normalizeMetadata()`; every mutating method now appends its audit record.
- Session flushes pending goal records after the main agent exists (createMain + resume) and
  runs `normalizeMetadata()` after `readMetadata()` on resume (active → paused).
- `goal.account_usage` uses `usageKind: 'token' | 'wall_clock'`. 62 goal/records tests pass;
  full agent-core suite (2281) green; typecheck clean.

### Phase 2

- Added `goal-command` experimental flag (`KIMI_CODE_EXPERIMENTAL_GOAL_COMMAND`, default off).
- `SessionAPI`/`CoreAPI` gained session-scoped `createGoal`/`getGoal`/`pauseGoal`/`resumeGoal`/
  `cancelGoal`/`clearGoal` (sessionId only, no agentId); core-api re-exports goal value types;
  `SessionAPIImpl` + `CoreImpl` delegate to `session.goals`.
- node-sdk: re-exported goal types; `SDKRpcClient` + `Session` forwarding methods (no public
  `updateGoal`).
- App: new `commands/goal.ts` deterministic parser + `handleGoalCommand`; registered behind
  `goal-command` with subcommand-aware availability; wired into dispatch/index.
- Tests: goal.test.ts (44 w/ registry+resolve), session-goal.test.ts (7). All typechecks pass;
  still no agent-core imports in app src.

### Detour note (Phase 2)

- The plan's SDK test direction ("forwards the right payload to SDKRpcClient") is implemented as a
  focused `Session`-with-stub-rpc unit test rather than a full harness round-trip, which is faster
  and directly asserts payload shape. Full end-to-end dispatch is covered in Phase 5.
