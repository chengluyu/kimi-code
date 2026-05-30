# Phase 7: Goal UX and Budget Model

## Goal

Make goal mode visible and controllable in the TUI, and replace the surprising
default turn cap with a counters-plus-evaluator model. All work is gated behind
the `goal-command` experimental flag.

This phase is complete when:

- a user can see an active (or recently achieved) goal at a glance (footer badge),
  inspect it in detail (`/goal` status box), and follow the autonomous loop in the
  transcript (low-profile markers + a completion card);
- `/goal` subcommands autocomplete;
- a goal created with no flags has **no** hard caps and runs until the evaluator
  judges it terminal, with the live counters (turns / time / tokens) visible to the
  evaluator so it can enforce any stop-clause stated in the objective.

## Background / rationale

Prior discussion (see TRACKER post-implementation notes and the replay of session
`398e1aba`) established:

- The default `turnBudget = 20` is the *only* default ceiling and is surprising. A
  "turn" is a checkpoint count, not a resource. Tokens/time are the meaningful
  resources, and the best stop signal is a clause in the objective ("…or stop after
  20 turns") judged by the evaluator — the Claude Code model.
- For that to work the evaluator must *see* the counters. Today it does not: its
  prompt has objective / criterion / model-report / transcript only.
- Goal activity is invisible in the TUI: no status surface, no loop markers, and the
  model rarely calls goal tools (CreateGoal is slash-driven, GetGoal is redundant via
  injection), so "watch the tool calls" shows nothing.

## Resolved micro-decisions

- **Failure guard:** keep a small default `failureTurnLimit` (malfunction guard for a
  perpetually-erroring evaluator) — this is not a work cap. `noProgressTurnLimit`
  stays unset by default.
- **Footer tokens:** badge shows status + elapsed + turns; full token detail lives in
  the `/goal` box (badge stays compact).
- **Verdict markers:** silent on plain `continue`; emit a marker only on
  `no_progress`, lifecycle changes, and terminal states. ("Low-profile.")
- **Footer never shows `N/M`** unless an explicit budget is set; default = raw counters.

## Commits (sequenced)

Each commit ships green (tests + typecheck + lint) and updates TRACKER.md.

### Commit 1 — Generic subcommand autocomplete (independent)

- `apps/kimi-code/src/tui/commands/registry.ts`: add optional
  `completeArgs?(partial: string): { value: string; description: string }[]` to the
  command-entry type. Implement on the `goal` entry → `status`/`pause`/`resume`/
  `cancel`/`clear`/`replace` + `--max-turns`/`--max-tokens`/`--max-minutes`, filtered
  by partial token, respecting existing `idle-only` availability.
- Slash-completion engine (confirm exact file near `registry.ts`): when the typed
  token matches a command and args follow, call `completeArgs(args)` and offer them.
- Tests: `completeArgs` filters correctly; engine surfaces suggestions after `/goal `.

### Commit 2 — Budget model: drop default cap, counters visible to evaluator

- `packages/agent-core/src/session/goal.ts`:
  - `createGoal()`: drop `?? DEFAULT_GOAL_TURN_BUDGET`; remove the constant. No default
    hard budgets → `overBudget` stays false → no hard stop for an unflagged goal.
  - Keep a small default `failureTurnLimit` (e.g. 3); leave `noProgressTurnLimit` unset.
- `packages/agent-core/src/agent/goal/evaluator.ts` `buildEvaluatorPrompt`: add a
  `Progress: turn N, <elapsed>, <tokens> tokens` line and a `Budgets/Stop conditions:`
  line when set; add a Decide item: "Has any stop condition stated in the objective
  (turn/time/token limit) been reached, given the progress above?"
- `apps/kimi-code/src/tui/commands/goal.ts` `createGoal()`: nudge when unbounded.
- `apps/kimi-code/src/cli/goal-prompt.ts`: stderr warning when unbounded (headless).
- Tests: unbounded goal never hard-stops; evaluator prompt includes counters + the
  stop-condition decision line; default failure guard still stops a failing evaluator;
  update the old "default turn budget caps…" test.

### Commit 3 — Shared spine: `goal.updated` event + terminal stats record

- `packages/agent-core/src/rpc/events.ts` (+ `AgentEvent` union): add
  `goal.updated { snapshot: GoalSnapshot | null; change?: GoalChange }`, where
  `GoalChange = { kind: 'lifecycle'|'verdict'|'report'|'terminal'; status?; verdict?;
  reason?; evidence?; actor?; stats? }`.
- `packages/agent-core/src/session/goal.ts`: add `emitEvent?` option (mirroring
  `auditSink`); emit on lifecycle/verdict/report/terminal/turn boundaries. Do NOT emit
  on every `recordTokenUsage` (footer tokens refresh per turn).
- `packages/agent-core/src/session/index.ts`: wire `emitEvent` to `this.rpc?.emitEvent`.
- `packages/agent-core/src/agent/records/types.ts`: add optional `turnsUsed?`/
  `tokensUsed?`/`wallClockMs?` to `goal.update`; populate on terminal transitions.
- Tests: mutations emit with correct `change.kind`; per-step token usage does not emit;
  terminal record carries stats.

### Commit 4 — Footer badge (#1)

- `apps/kimi-code/src/tui/tui-state.ts`: add `AppState.goal?` snapshot.
- `apps/kimi-code/src/tui/controllers/session-event-handler.ts`: handle `goal.updated`
  → set/clear `appState.goal`; clear on terminal.
- `apps/kimi-code/src/tui/components/chrome/footer.ts`: badge on line 1, colored by
  status. No budget → raw counters `[goal ● active · 4m · 7 turns]`. Budget set → show
  `used/limit` for that counter. Cleared on terminal.
- Tests: badge reflects status/counters; `used/limit` only when budgeted; clears on
  terminal.

### Commit 5 — `/goal` status box (like `/usage`)

- `apps/kimi-code/src/tui/components/messages/goal-panel.ts` (new; mirror
  `usage-panel.ts` / `plan-box.ts`).
- `apps/kimi-code/src/tui/commands/goal.ts` `showGoalStatus()`: render the box.
- Active: title `Goal · active`; condition as blockquote (`▌`, wrapped); rows Running /
  Turns / Tokens / Evaluator (latest verdict + reason); `Stop` row with progress when
  budgeted, else dim "No stop condition — runs until evaluated complete".
- Achieved-earlier: title `Goal · <status>`; achieved condition + final stats from the
  retained terminal snapshot.
- Tests: active box with counters + last verdict; achieved-earlier variant;
  no-stop-condition line when unbounded.

### Commit 6 — Transcript markers (#3) + completion card (#2), live + resume

- New components in `apps/kimi-code/src/tui/components/messages/`:
  - Low-profile marker: dim single word (verdict/lifecycle), `setExpanded` so `ctrl+o`
    expands to reason/evidence (pattern from `thinking.ts`/`shell-execution.ts`).
  - Completion card: prominent terminal card with reason + stats (time/turns/tokens).
- Live: `session-event-handler.ts` on `goal.updated` with `change` → marker (verdict/
  lifecycle, silent on plain `continue`) or completion card (terminal, using
  `change.stats`).
- Resume: in the transcript-reconstruction-from-records path (confirm exact file),
  render `goal.*` records into the same components; terminal card reads the stats from
  Commit 3.
- Tests: live verdict→marker, terminal→card, `ctrl+o` toggle; resume rebuilds markers +
  completion card with stats from records.

## Dependencies

```
1 Autocomplete        ─ independent
2 Budget model        ─ independent (agent-core)
3 goal.updated spine  ─ enables 4 & 6
4 Footer badge        ─ needs 3
5 /goal status box    ─ needs only getGoal snapshot (independent)
6 Markers + card      ─ needs 3 (live) + records (resume); largest
```

## Verification (per commit)

```bash
pnpm --filter @moonshot-ai/agent-core test
pnpm --filter @moonshot-ai/agent-core run typecheck   # agent-core commits
pnpm --filter @moonshot-ai/kimi-code test             # TUI commits
pnpm run lint
```
