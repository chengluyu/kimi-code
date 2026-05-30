# Goal feature — Branch 3 vs Branch 1 implementation comparison

Tracks the **work-in-progress** `feat/goal-impl/3` branch against the **completed**
`feat/goal-impl/1` branch (this branch). Updated as each new `Phase N: …` commit lands on
Branch 3, via a background monitor on the branch tip.

- **Branch 1 (reference, done):** phases 1a → 6 (`abb938d`).
- **Branch 3 (WIP):** Phase 1a (`230d0d2`), Phase 1b (`94a7f83`) — baselined below.

Legend: ✅ consistent · ⚠️ divergent but plausible · ❌ likely inconsistency / risk

> **TL;DR:** Branch 3 is a *hybrid*. It adopts the same **type/snapshot redesign** that
> Branch 2 used (wrapper `GoalSnapshot`, no dedicated `lastModelReport*` fields, `string`
> actors) but **restores Branch 1's safer persistence model** (async + `await`ed writes,
> state read fresh from metadata on every call — no in-memory cache). It also introduces a
> *third* distinct `GoalEvidence` shape and a distinct full-state audit-record design.

---

## Phase 1a — core `SessionGoalStore` (`230d0d2`)

Files touched are the **same set as Branch 1** (`agent/index.ts`, `errors/codes.ts`,
`session/goal.ts`, `session/index.ts`, `session/rpc.ts`, test, tracker). Unlike Branch 2,
Branch 3 does **not** front-load `rpc/core-api.ts` / `rpc/core-impl.ts` into Phase 1a — SDK
exposure is deferred, matching Branch 1's phase boundary. Progress doc is
`IMPLEMENTATION_TRACKER.md`.

### What matches Branch 1
- ✅ Identical `errors/codes.ts` goal error codes, `GoalStatus` union, `GoalBudgetLimits`
  fields, `DEFAULT_GOAL_TURN_BUDGET = 20`, 4000-char objective cap, `replace` guard.
- ✅ Same lifecycle surface (create/pause/resume/update/cancel/clear + record\*/mark\*).
- ✅ **Async + awaited persistence.** Every mutator is `async` and `await`s
  `setGoalData()` / `writeMetadata()` — this *fixes* the fire-and-forget `void persist()`
  risk that Branch 2 carried.
- ✅ **Stateless reads.** `getGoalData()` re-reads `metadata.custom.goal` on every call;
  there is no cached `this.state`, so metadata stays the single source of truth (matches
  Branch 1, avoids Branch 2's staleness risk).

### What matches Branch 2 instead (i.e. diverges from Branch 1)
- ❌ **`GoalSnapshot` is the wrapper shape** `{ goal, remainingTokens, overBudget,
  tokenBudgetReached, turnBudgetReached, wallClockBudgetReached }` — not Branch 1's
  flattened view with nested `budget: GoalBudgetReport`. No `GoalBudgetReport`,
  `remainingTurns`, or `remainingWallClockMs`. Downstream consumers will read goal fields
  via `snapshot.goal.*`, not top-level. Same structural break flagged for Branch 2.
- ❌ **Dropped `lastModelReportStatus/Reason/Evidence` state fields.** `recordModelReport`
  folds the report into `lastEvidence` as
  `{ description: "Model report: <status>", source: 'model_report' }`. Branch 1's
  continuation/evaluator (Phase 4c/4d) key off `lastModelReportStatus`; whether Branch 3
  can recover the requested status from this stringified evidence is the thing to watch in
  its later phases.
- ⚠️ **`string` actors** (no `GoalActor` union) — loses compile-time actor validation.

### Unique to Branch 3
- ⚠️ **A third `GoalEvidence` shape:** `{ description, source? }`.
  (Branch 1 = `{ summary, detail?, source? }`; Branch 2 = `{ kind, summary }`.) All three
  branches picked a different evidence record — none are interchangeable.
- ⚠️ **`GoalToolResult` keeps both** raw + snapshot:
  `{ goal: SessionGoalState | null, goalBudgetReport?: GoalSnapshot }`.
- ⚠️ **`record*` return types differ:** `recordTokenUsage/WallClock/incrementTurn/
  recordEvaluatorVerdict` return `void` (Branch 1 returned `GoalSnapshot | null`,
  Branch 2 returned `GoalSnapshot`). Callers can't chain on the updated snapshot.

### Findings / risks
- ❌ **Weakest goal-ID scheme of the three.** `goalId = \`goal-${Date.now()}\`` — no UUID
  (Branch 1) and not even Branch 2's `-${counter}` suffix. Two goals created in the same
  millisecond collide. Low probability, but the weakest of the three branches.
- ❌ **Usage deltas not clamped.** `tokensUsed += input.tokenDelta` /
  `wallClockMs += input.wallClockMs` with no `Math.max(0, …)` (Branch 1 clamps). A negative
  delta would decrement usage. Same gap as Branch 2.
- ⚠️ **Usage/turns accrue while `paused`.** `recordTokenUsage`, `recordWallClockUsage`,
  `incrementTurn` guard on `isActiveOrPaused(status)`, so a paused goal keeps accruing
  usage. Branch 1 (and Branch 2) only accrue while `active`. Possibly intentional, but a
  behavioral difference worth confirming.
- ⚠️ **`recordModelReport` has no status guard.** It records even on a terminal goal
  (only throws if no goal exists). Branch 1 required an active goal; Branch 2 returned
  early when not active.
- ⚠️ **`budgetLimits` spread ordering bug-risk.** `{ turnBudget: input… ?? DEFAULT,
  ...input.budgetLimits }` — because `...input.budgetLimits` is spread *last*, an explicit
  `turnBudget: undefined` in the input would overwrite the defaulted value back to
  `undefined`, defeating the safety cap. Branch 1/2 set `turnBudget` last so the default
  always wins. Only triggers if a caller passes an explicit `undefined`.

---

## Phase 1b — goal audit records + resume normalization (`94a7f83`)

Files: `records/index.ts`, `records/types.ts`, `session/goal.ts`, `session/index.ts`, test.

### What matches (converges with Branch 1)
- ✅ **Audit-only goal records with replay-ignore.** Same `goal.*` taxonomy
  (create/update/account_usage/continuation/report/evaluate/clear) wired into
  `restoreAgentRecord` as no-ops; goal state is restored from `metadata.custom.goal`, never
  rebuilt from records. Same core decision as both other branches.
- ✅ **`normalizeMetadata` resume semantics match:** drop malformed, drop stale
  `cancelled`, convert `active` → `paused` and emit a `goal.update` audit record, leave
  paused/terminal intact.
- ✅ **Pending-queue + `flushPendingRecords()`** buffering before the main-agent sink
  exists — same pattern as Branch 1.

### Divergences
- ❌ **Audit records embed the whole `SessionGoalState`.** `goal.create` and `goal.update`
  are `{ goal: SessionGoalState }` — the entire mutable record is snapshotted into each
  record, rather than Branch 1's discrete typed fields (`goalId/status/actor/…`). Distinct
  from Branch 2's loose discrete fields too. Replay ignores them, so this is an
  audit-readability/size difference, not a correctness one — but `actor`/`reason` are no
  longer top-level on the record (they live inside the embedded goal).
- ❌ **`goal.report` / `goal.evaluate` drop `evidence`.** Branch 3's records carry only
  `{ requestedStatus, reason }` / `{ verdict, reason }`. Branch 1 (and Branch 2) include an
  `evidence` array. The audit trail loses the evidence that motivated a report/verdict.
- ⚠️ **`goal.continuation` drops `goalId`** (`{ turnsUsed }` only); Branch 1 includes it.
- ⚠️ **`account_usage` shape** matches Branch 2 (presence of `tokensUsed?`/`wallClockMs?`,
  required `source`, sentinel `source: 'wall_clock'` for wall-clock) rather than Branch 1's
  discriminated `usageKind`+`delta`.
- ⚠️ **Resume actor label is `'system'`** (Branch 1/2 used `'runtime'`).
- ⚠️ **Weaker status validation in normalize.** Branch 3 checks only
  `typeof goal.status !== 'string'`; Branch 1/2 validate against the known-status set, so a
  bogus status string (e.g. `"foo"`) would survive Branch 3's normalization.
- ⚠️ **`normalizeMetadata` is sync and fire-and-forgets its writes** (`void this.setGoalData(…)`),
  unlike the rest of Branch 3, which awaits — a small internal inconsistency.

### Net assessment (Phases 1a–1b)
Branch 3 looks like the strongest of the two WIP attempts so far: it keeps Branch 2's
cleaner type layout while restoring Branch 1's safe, awaited, single-source-of-truth
persistence. The items most likely to bite later are the same Branch-2 lineage issues —
**the dropped `lastModelReport*` fields** (continuation/evaluator dependency, Phase 4c/4d)
and **the wrapper-snapshot break** — plus Branch 3's own weak goal-ID scheme and the
audit-record evidence/field losses. None are blocking at this stage.

---

## Phase 2 — SDK API + `/goal` command surface (`9324015`)

Files closely match Branch 1's Phase 2 (`c14b025`): same TUI command files
(`dispatch.ts`, `goal.ts`, `index.ts`, `registry.ts`), `flags/registry.ts`, RPC
(`core-api.ts`, `core-impl.ts`, `session/rpc.ts`), and node-sdk (`rpc.ts`, `session.ts`,
`types.ts`). Branch 3 additionally edits `agent-core/src/index.ts` (+23, re-exporting goal
types). Both gate the feature behind the same flag (registry diff is a comment-only
change, so the flag entry itself is effectively identical).

### What matches Branch 1
- ✅ **Same SDK session surface:** `createGoal / getGoal / pauseGoal / resumeGoal /
  cancelGoal / clearGoal`.
- ✅ **Same RPC surface** on `SessionAPI` (create/get/pause/resume/cancel/clear).
- ✅ **Same `/goal` subcommand grammar:** `status` (default), `create`, `pause`, `resume`,
  `cancel`, `clear`, plus `replace`.
- ✅ **`metadata.custom.goal` is reserved** on both — generic metadata updates that touch
  `goal` are rejected with `GOAL_METADATA_RESERVED` and the existing goal is preserved.

### Divergences / findings
- ❌ **`/goal create` ignores budget flags on Branch 3.** Branch 1 parses
  `--max-tokens` / `--max-turns` / `--max-minutes` (and `tokenBudget`/`turnBudget`) from the
  command text. Branch 3's parser returns `{ kind: 'create', objective: input }` — the
  whole remainder is the objective, with no flag parsing — so a TUI user can only ever get
  the default `turnBudget = 20`. Budgets are settable via the SDK (`createGoal({budgetLimits})`)
  but **not** via the slash command. Functional gap vs Branch 1.
- ⚠️ **`getGoal` returns the wrapper snapshot.** Branch 1 returns `GoalToolResult`
  (`{ goal: GoalSnapshot | null }`); Branch 3 returns `GoalSnapshot` (its
  `{ goal, remainingTokens, … }` wrapper). Direct consequence of the Phase 1a snapshot-type
  divergence; SDK consumers read different shapes.
- ⚠️ **Control payloads thread an explicit `actor`.** Branch 1 uses one shared
  `GoalControlPayload` (`{ reason? }`) for pause/resume/cancel/clear and defaults the actor
  internally. Branch 3 defines separate `Pause/Resume/Cancel/ClearGoalPayload`, each with
  `actor: string` + `reason?`, and the SDK methods accept `{ actor?, reason? }` defaulting to
  `'user'`. Branch 3 leaks the actor concept to SDK callers.
- ⚠️ **`replace` is a distinct parse `kind`.** Branch 3 parses `replace` as its own command
  kind that maps to create-with-`replace:true`; Branch 1 folds it into `create` as a boolean.
  Same outcome, different structure.
- ⚠️ **Metadata-reservation strictness.** Branch 1 rejects when the `goal` *key is present*
  (`'goal' in patchCustom`); Branch 3 rejects only when `custom.goal !== undefined`, so a
  patch carrying `goal: undefined`/`null` slips past the guard (though the existing goal is
  then restored, so no data loss).
- ⚠️ **Test coverage.** Branch 1 adds a node-sdk `session-goal.test.ts` (72 lines); Branch 3
  has no SDK-layer goal test in Phase 2 (its added tests are TUI-command + resolve/registry).

### Net assessment (Phase 2)
The user-facing and SDK surfaces line up well — same commands, same RPC/SDK methods, same
reservation guard. The one real functional gap is **budget flags not being parseable from
`/goal create`** on Branch 3. The rest are the expected downstream of earlier type choices
(wrapper snapshot, explicit actors) plus a thinner SDK test surface.

---

## Phase 3 — model goal tools: `CreateGoal` / `GetGoal` / `UpdateGoal` (`727bcf9`)

Both branches add the same three model-facing tools (`.ts` + `.md`), register them in
`tools/builtin/index.ts`, `agent/tool/index.ts`, and `profile/default/agent.yaml`. Branch 1
also adds a `goal/shared.ts` helper (41 lines); Branch 3 has none.

### The key semantic matches ✅
**`UpdateGoal` is a *report*, not a status change, on both branches.** Both call
`store.recordModelReport({ requestedStatus, reason, evidence })` and explicitly do **not**
end the goal — the continuation controller / evaluator decide later. This is the most
important design decision in this phase and the two branches agree on it.

### Divergences / findings
- ❌ **`CreateGoal` mis-attributes the actor on Branch 3.** Branch 1 passes
  `actor: 'model'` so a model-initiated goal records `startedBy: 'model'`. Branch 3 forwards
  `args` straight to `createGoal`, and `createGoal` (Phase 1a) hard-codes
  `startedBy: 'user'`. So on Branch 3 **every goal looks user-started even when the model
  created it** — audit/attribution inconsistency vs Branch 1.
- ❌ **`CreateGoal` schema omits two budget fields on Branch 3.** Branch 1's
  `BudgetLimitsSchema` exposes all five limits (`tokenBudget`, `turnBudget`,
  `wallClockBudgetMs`, **`noProgressTurnLimit`, `failureTurnLimit`**). Branch 3's schema
  exposes only the first three, so the model cannot set no-progress / failure limits through
  the tool (they exist on the type but aren't surfaced). Pairs with the Phase 2 finding that
  `/goal create` can't set budgets either.
- ❌ **`recordModelReport` storage still lacks the structured requested-status (carried over
  from Phase 1a).** Branch 1 stores `lastModelReportStatus/Reason/Evidence` as fields; Branch
  3 only appends `lastEvidence: { description: "Model report: <status>", source: 'model_report' }`.
  The tool layer is consistent, but Branch 3's later continuation/evaluator phases will have to
  recover the requested status by string-parsing that evidence entry. **Still the top thing to
  watch in Phase 4c/4d.** Branch 3's `recordModelReport` also has no active-status guard.
- ⚠️ **Tool docs (`.md`) are much terser on Branch 3** — 3 lines each vs Branch 1's
  20 / 5 / 14 lines (`create` / `get` / `update`). Since the `.md` is the tool description the
  model sees, Branch 1 gives the model substantially more guidance on when/how to use each
  tool. Factual commit difference (not judging the runtime effect).
- ⚠️ **Wiring style differs.** Branch 1 constructs tools with the `Agent` and resolves the
  store via `requireGoalStore(agent, name)` + `isGoalToolError` (the `shared.ts` helpers),
  giving a uniform "goal feature disabled" error path. Branch 3 injects
  `SessionGoalStore | undefined` directly and inlines the undefined-check / `KimiError`
  handling in each tool.
- ⚠️ **Evidence shape** (`{description, source?}` vs `{summary, detail?, source?}`) and
  **tool output** (raw wrapper snapshot vs `{ goal, goalBudgetReport }`) differ — both direct
  consequences of the Phase 1a type choices.
- ⚠️ **Schema strictness.** Branch 1's zod schemas are `.strict()` (reject unknown keys);
  Branch 3's are not.

### Net assessment (Phase 3)
The load-bearing decision — model tools *report*, they don't terminate the goal — is
**implemented identically**. The notable regressions vs Branch 1 are concrete and small:
**model-created goals attributed to `user`**, and **`noProgressTurnLimit`/`failureTurnLimit`
not settable** by the model. The dropped structured model-report fields remain the one item
that could turn into a functional problem once the continuation controller and evaluator land.

---

## Phase 4a — goal context injection / `GoalInjector` (`dc3f46a`)

Both add `agent/injection/goal.ts` (a `DynamicInjector` subclass) and register it in
`injection/manager.ts`. This is the most substantively different phase so far — the two
branches took genuinely different approaches to *how often* and *what* to inject.

### The big divergence: injection cadence
- **Branch 1 — inject the full reminder every active step.** `getInjection()` returns the
  complete goal reminder whenever the goal is `active`; there is no throttling or
  deduplication. Always fresh, simplest possible, but repeats the full block every model
  step (more tokens).
- **Branch 3 — full/sparse/skip cadence with dedup.** `GoalInjector` computes a *variant*
  from conversation history:
  - first injection → **full**;
  - a `user` message since last injection → **full** (re-prime);
  - ≥ `GOAL_FULL_REFRESH_TURNS` (5) assistant turns → **full** refresh;
  - ≥ `GOAL_DEDUP_MIN_TURNS` (2) assistant turns → **sparse** (short objective+progress);
  - otherwise → **skip** (`null`).

  This is a deliberate anti-staleness / token-saving design: re-prime the full goal
  periodically and after each user turn, with a lightweight reminder in between. It is the
  more sophisticated of the two on the specific axis of *keeping the goal alive over many
  turns*, where Branch 1 simply brute-forces it by always re-injecting in full.

### Content differences
- ❌ **Prompt-injection hardening only on Branch 1.** Branch 1 wraps the objective in
  `<untrusted_objective>` / `<untrusted_completion_criterion>` and explicitly tells the model
  to treat it as *data, not instructions* that override system/developer/tool/permission
  rules. **Branch 3 injects the raw objective as plain text** (`Objective: <text>`) with no
  untrusted framing — a security/hardening regression vs Branch 1.
- ⚠️ **Budget guidance differs.** Branch 1 emits 3-band guidance (within / ≥75% approaching /
  ≥100% over, computed from the max budget fraction across turns+tokens+time). Branch 3 emits
  budget *warnings* only at a single ≥80% threshold (per-budget), plus a "budget limit
  reached" line in the sparse variant.
- ⚠️ **Branch 3 omits self-report / evaluator surfacing.** Branch 1's reminder includes
  `Latest self-report: <status> — <reason>` (`lastModelReportStatus`) and
  `Latest evaluator verdict: …`. Branch 3 surfaces neither — a direct consequence of having
  dropped `lastModelReportStatus` in Phase 1a, so the model never sees its own last report
  echoed back.
- ⚠️ Branch 1 also surfaces wall-clock elapsed with a `formatElapsed` helper and
  remaining-budget figures; Branch 3 shows used/limit but not "remaining".

### Wiring / gating
- ⚠️ **Branch 3 self-gates inside the injector:** `if (this.agent.type !== 'main') return`
  and `if (!flags.enabled('goal-command')) return`. Branch 1's injector only checks store
  presence + active status (main-only attachment / flag gating handled elsewhere; its
  `manager.ts` change is larger, ~18 lines, vs Branch 3's +2-line registration).

### Net assessment (Phase 4a)
This is a real design fork, not a stylistic one. **Branch 3's cadence system is arguably
better at the "don't let the model forget the goal" problem** — periodic full refresh +
re-prime after user turns + sparse in between — whereas Branch 1 keeps it simple by always
re-injecting. However, Branch 3 **drops Branch 1's `<untrusted_objective>` prompt-injection
framing** (a hardening regression) and, because it has no `lastModelReportStatus`, cannot
echo the model's last self-report or the evaluator verdict back into context. Net: Branch 3
is more refined on injection frequency, less hardened on injection content.

---

## Phase 4b — goal token accounting in `TurnFlow.afterStep` (`4d2cfdf`)

Both branches hook `agent/turn/index.ts` to charge goal token usage on every session agent
step, using the same basis: `recordTokenUsage({ tokenDelta: grandTotal(usage), agentType,
source: 'agent_step' })`. Branch 3 also revises `session/goal.ts` usage APIs.

### Consistent ✅
- Same accounting trigger (every agent step) and same delta (`grandTotal(usage)`) with
  `source: 'agent_step'`.
- ✅ **Branch 3 fixed the paused-accrual issue flagged in Phase 1a.** It changed the guards in
  `recordTokenUsage` / `recordWallClockUsage` / `incrementTurn` / `recordEvaluatorVerdict`
  from `!isActiveOrPaused(status)` to `status !== 'active'`, so usage now accrues only while
  the goal is `active` — matching Branch 1.

### Divergences / findings
- ❌ **Branch 3's afterStep call is fire-and-forget.** Branch 1 `await`s
  `recordTokenUsage(...)` inside the step (and guards on `getActiveGoal() != null` first).
  Branch 3 calls `this.agent.goals?.recordTokenUsage({...})` **without `await`**. The method
  itself awaits its own write, but because the turn flow doesn't await the method, the persist
  isn't ordered against the rest of the step — rapid successive steps can interleave the
  read-modify-write of `tokensUsed`. This is the same fire-and-forget theme that Branch 3
  otherwise avoids, re-appearing at this specific call site.
- ⚠️ **Branch 3 drops `agentId` from accounting.** Branch 1 adds an `agentId` getter
  (`basename(homedir)`) and records it; Branch 3 made `agentId`/`agentType` optional on
  `RecordTokenUsageInput` and passes only `agentType`. So Branch 3's `goal.account_usage`
  audit records have no per-agent-id attribution.
- ⚠️ **Guard placement.** Branch 1 checks `getActiveGoal() != null` at the call site (skips
  the call entirely when inactive); Branch 3 always calls and relies on the method's internal
  `status !== 'active'` early-return. Equivalent outcome.
- (Aside: Branch 1's Phase 4b commit also contains a stray empty `packages/agent-code` path —
  a Branch-1 artifact, irrelevant to Branch 3.)

### Net assessment (Phase 4b)
Accounting semantics line up, and Branch 3 cleaned up its own earlier paused-accrual bug
here — a good sign it's self-correcting. The one real concern is the **non-awaited
`recordTokenUsage` in the hot turn path**, which can race the goal-state read-modify-write;
the dropped `agentId` is a minor audit-fidelity loss.

---

## Phase 4c — `GoalContinuationController` autonomous loop (`815d00e`)

Both add `agent/goal/continuation.ts` and rework `turn/index.ts` to drive autonomous
continuation after a stopped step. The control flow is structurally parallel — increment
turn, account wall-clock, accept a model terminal report, enforce hard budgets, reconcile
`maxStepsPerTurn`, otherwise append a continuation prompt and continue.

### ⭐ The payoff of the Phase 1a `lastModelReportStatus` divergence
This is where the dropped field finally matters.

- **Branch 1** reads it directly:
  ```ts
  if (goal.lastModelReportStatus === 'complete' | 'blocked' | 'impossible') {
    await store.updateGoal({ status: goal.lastModelReportStatus, actor: 'continuation',
      reason: goal.lastModelReportReason, evidence: goal.lastModelReportEvidence });
    return STOP;
  }
  ```
- **Branch 3** has no such field, so it **reverse-engineers the status out of a formatted
  evidence string**:
  ```ts
  const modelReportStatus = goal.lastEvidence?.find(e => e.source === 'model_report');
  if (modelReportStatus) {
    const reportedStatus = goal.lastEvidence?.[0]?.description;       // assumes index 0
    const match = reportedStatus?.match(/^Model report: (\w+)$/);     // parses the string
    if (match && ['complete','blocked','impossible'].includes(match[1])) {
      await updateGoal({ status: match[1], actor: 'model',
        reason: goal.lastEvidence?.slice(1).map(e => e.description).join('; ') ?? '…' });
    }
  }
  ```

**It works on the happy path** (because `recordModelReport` always writes the marker at
`lastEvidence[0]` with `source:'model_report'`), but it is exactly the brittle coupling
predicted in Phase 1a:
- ❌ **Writer/reader coupled by a string format.** The status only survives the round-trip
  while the literal `` `Model report: ${status}` `` template and the `/^Model report: (\w+)$/`
  regex stay in sync. Any wording change silently breaks terminal detection — the goal would
  then never complete via self-report.
- ❌ **`find`-anywhere vs read-`[0]` mismatch.** It locates the marker with `find()` (any
  index) but then reads `lastEvidence[0].description`. Today the marker is always at 0, so
  it's latent, but the two assumptions can drift apart.
- ⚠️ **`lastEvidence` is overloaded.** `incrementTurn` and `recordEvaluatorVerdict` also
  overwrite `lastEvidence`, so the model-report marker is fragile shared state rather than a
  dedicated field. (Step 5 runs before `incrementTurn` in the same call, so the immediate
  path is safe, but the field is doing triple duty.)
- ⚠️ **Reason/evidence fidelity.** Branch 1 forwards the structured
  `lastModelReportReason` / `lastModelReportEvidence`; Branch 3 reconstructs the reason by
  `join('; ')`-ing the remaining evidence descriptions.

### Other divergences
- ⚠️ **Terminal actor.** Branch 1 records the self-report terminal as `actor: 'continuation'`;
  Branch 3 uses `actor: 'model'`.
- ⚠️ **Turn-increment ordering.** Branch 1 increments the turn *before* the model-report
  check (the reporting step counts as a continuation turn); Branch 3 checks the report
  *before* incrementing (the reporting step is not counted). Minor accounting difference.
- ✅ **Return contract — Branch 3 is arguably cleaner here.** Branch 3 returns
  `ShouldContinueAfterStopResult | undefined`, using `undefined` for "goal mode not
  applicable, defer to default turn behavior". Branch 1 returns `STOP` (`{continue:false}`)
  when disabled, which is a firmer hand. Branch 3's "no opinion" signal is the nicer design.
- ⚠️ **Once-only wrap-up mechanism.** Branch 3 uses explicit `budgetWrapUpUsed` /
  `maxStepsWrapUpUsed` boolean latches; Branch 1 relies on `markBudgetLimited` flipping the
  goal terminal so the next step stops at the status guard. Both run the wrap-up exactly once.
- ❌ **`finalizeWallClock` is fire-and-forget on Branch 3** (`void recordWallClockUsage(...)`,
  and it's a sync method) and it *skips* the final interval if the goal is no longer active;
  Branch 1 `await`s it and records regardless of terminal state. Same fire-and-forget theme
  as Phase 4b.
- ✅ Continuation + budget-wrap-up prompts are semantically equivalent; Branch 3 additionally
  re-states the `Objective:` inline in both prompts (consistent with its no-`<untrusted>`
  injection style).

### Net assessment (Phase 4c)
Functionally the two controllers should behave the same on normal runs, **including
self-report termination** — Branch 3 did make the model's `complete/blocked/impossible`
report end the goal. But it pays for the Phase 1a type shortcut here: terminal detection now
hinges on a **string template matched by regex**, which is the single most fragile line in
the whole Branch 3 implementation. Recommend Branch 3 either restore a structured
`lastModelReportStatus` field or, at minimum, centralize the marker format as a shared
constant used by both writer and reader. The fire-and-forget `finalizeWallClock` is a
secondary concern.

---

## Phase 4d — independent `GoalEvaluator`, integrated into continuation (`ceafdd5`)

Both branches add an LLM-based `agent/goal/evaluator.ts` and rewire the continuation loop so
that **goal completion is evaluator-driven**. Strong architectural convergence here.

### ⭐ Important: this largely *moots* the Phase 4c fragility finding
Phase 4c flagged Branch 3's regex parse of the model-report string as "the single most
fragile line." **Phase 4d removes that block entirely** (on both branches):
- **Branch 1** deletes its `lastModelReportStatus` "Level-1 terminal decision" and instead
  passes the report to the evaluator as advisory `modelReport` evidence; the **evaluator's
  verdict** is now the terminal trigger.
- **Branch 3** deletes the regex-parse terminal block and replaces it with
  `extractModelReport()` → fed to the evaluator as an advisory string.

So the model-report status is **no longer load-bearing** on either branch. Branch 3's
string extraction still exists (`extractModelReport` finds `source:'model_report'` and joins
descriptions), but if it ever broke, the evaluator would simply lose a hint and still judge
from conversation context. **Net: the 4c risk drops from "could prevent goal completion" to
"could lose an advisory hint."** A good example of why watching consecutive commits matters —
the 4c snapshot looked dangerous in isolation; 4d resolved it.

### What matches Branch 1 ✅
- Independent evaluator over the main agent's `llm`, strict-JSON output.
- **Identical verdict taxonomy:** `continue | complete | blocked | impossible | no_progress`.
- Completion is **evaluator-driven**; the model self-report is advisory only.
- Evaluator tokens are charged to the goal budget with `source: 'goal_evaluator'`.
- Terminal verdicts (`complete/blocked/impossible`) → `updateGoal(actor:'evaluator')` → stop.
- `no_progress` honored against `noProgressTurnLimit`; evaluator failures tracked against
  `failureTurnLimit` → `markError`. Budgets re-checked after the (token-spending) evaluator call.

### Divergences / findings
- ⚠️ **Evaluator testability seam.** Branch 1 injects a `createEvaluator` factory +
  `GoalEvaluatorLike` interface so tests (and future variants) can swap the judge. Branch 3
  hard-codes `new GoalEvaluator(ctx.llm)` inside the controller — no seam, harder to unit-test
  the loop without a live LLM.
- ⚠️ **Error modeling.** Branch 1 keeps evaluator failure separate (`recordEvaluatorFailure`
  + an ok/error result union). Branch 3 folds it into the verdict union as a pseudo-verdict
  `'error'` (`GoalEvaluatorVerdict | 'error'`) routed through `recordEvaluatorVerdict`.
  Branch 3's is more compact but overloads the verdict field.
- ⚠️ **Evaluator token sum.** Branch 1 uses `grandTotal(result.usage)`; Branch 3 hand-sums
  `inputOther + output + inputCacheRead + inputCacheCreation`. If `grandTotal` covers any
  other component, Branch 3 will under/over-count evaluator tokens versus the rest of its
  accounting (which *does* use `grandTotal` in Phase 4b). Worth reconciling to one helper.
- ❌ **Budget re-check ordered *before* the terminal verdict on Branch 3.** In Branch 3 the
  post-evaluator code runs the budget re-check (step "8") and `markBudgetLimited` **before**
  it applies a `complete/blocked/impossible` verdict (step "7" — note the stale, out-of-order
  comment numbers). Consequence: if the evaluator returns `complete` *and* its own token cost
  tipped the goal over budget, the goal is marked **`budget_limited` instead of `complete`**.
  A genuinely-finished goal can be mislabeled. Recommend applying the terminal verdict before
  the budget re-check. (Branch 1 records the verdict and checks the terminal verdict in a
  flow that doesn't appear to subordinate completion to the post-eval budget check — worth a
  side-by-side confirm, but Branch 3's ordering is the riskier of the two.)
- ❌ **`noProgressTurnLimit` / `failureTurnLimit` are effectively unreachable on Branch 3.**
  This is the concrete payoff of the Phase 2/3 gaps: those two limits can't be set from
  `/goal create` (Phase 2) or the `CreateGoal` tool schema (Phase 3) — only via the raw SDK.
  So Branch 3's `no_progress`-limit and evaluator-failure-limit stop conditions exist in code
  but **almost never fire** in practice, because the limits default to `undefined`. Branch 1
  exposes all five budget fields in the `CreateGoal` schema, so these stops are reachable.
- ⚠️ Evidence shape in the evaluator prompt differs (`{description,source?}` vs `{summary}`),
  consistent with the long-standing evidence-shape divergence.
- ✅ Branch 3 added the `consecutiveNoProgressTurns` / `consecutiveFailureTurns` counting to
  `recordEvaluatorVerdict` in this phase (it was absent in its 1a version), so the counters
  the limits rely on are now maintained.

### Net assessment (Phase 4d)
The core decision — **an independent evaluator owns completion, the model only reports** — is
implemented the same on both branches, and it retroactively neutralizes the 4c fragility.
The remaining Branch 3 concerns are (1) the **terminal-verdict-vs-budget ordering**, which can
mislabel a completed goal as budget-limited, and (2) the **unreachable no-progress/failure
limits** stemming from the earlier surface gaps. The missing test seam and the bespoke token
sum are lower-severity polish items.

---

## Phase 5 — end-to-end integration + gates (`8265869`)

Both branches add an end-to-end harness test `test/harness/goal-session.test.ts` (Branch 1
214 lines, Branch 3 193). Beyond that the two Phase 5 commits have **different character**:
- **Branch 1** is a clean integration commit: harness test + **flag/env-var docs**
  (`docs/en/configuration/env-vars.md`, +15) + a one-line turn fix + a dispatch test tweak.
- **Branch 3** bundles the harness test with a **lint-cleanup sweep across the goal modules**
  (removing now-unused `ErrorCodes`/type imports, `_`-prefixing unused params, type
  narrowing). This implies earlier Branch 3 phases were committed carrying lint debt that's
  only being paid down now; Branch 1 kept each phase clean.

### ✅ Two more self-corrections on Branch 3
The Phase 5 cleanup quietly fixes two issues, one of which I flagged earlier:
- ✅ **`await this.agent.goals?.recordTokenUsage(...)`** in `turn/index.ts` afterStep — the
  missing `await` I flagged in **Phase 4b** is now added, closing the read-modify-write race
  on `tokensUsed`.
- ✅ **`await this.markGoalOnCancel()`** — another missing-await fixed on the cancel path.
- ⚠️ Also narrows `error.details?.['maxSteps'] !== undefined` → `typeof … === 'number'`
  (more robust maxSteps detection).

### Findings / remaining gaps
- ❌ **No user-facing flag/env-var docs on Branch 3.** Branch 1's Phase 5 documents the goal
  feature flag / env vars in `docs/en/configuration/env-vars.md`; Branch 3 ships none. A
  documentation gap for shipping the feature.
- ❌ **The two Phase 4d bugs are still unaddressed** — the terminal-verdict-vs-budget
  ordering (completed goal can be mislabeled `budget_limited`) and the unreachable
  `noProgressTurnLimit`/`failureTurnLimit`. Phase 5's sweep was lint-only and didn't touch
  these.
- ⚠️ **`clearGoalInternal(_actor, _reason)`** — Branch 3 now formally ignores the actor and
  reason on clear (params `_`-prefixed), confirming the lighter clear-audit attribution noted
  back in Phase 1b. Branch 1 threads actor/reason through clear.
- ⚠️ `UpdateGoal` input `status` type narrowed from `GoalStatus` to the literal
  `'complete' | 'blocked' | 'impossible'` — a small correctness tightening unique to Branch 3.

### Net assessment (Phase 5)
Both reach an end-to-end-tested state. Branch 3 continues its pattern of **fixing its own
earlier rough edges** (two missing awaits closed here), which is reassuring. The notable
deltas vs Branch 1 are process/polish: Branch 3 carried lint debt into a late catch-up
commit and **still lacks the feature-flag documentation** Branch 1 shipped. The substantive
4d behavioral bugs remain open going into Phase 6.

---

## Phase 6 — headless goal mode + hardening (`b22fc19`)

Both add headless `/goal` execution with a terminal-status → exit-code mapping and a printed
summary. Branch 1 puts it in a dedicated `cli/goal-prompt.ts`; Branch 3 puts
`resolveGoalExitCode` in `cli/run-prompt.ts` and extracts shared parsing into a new
`apps/kimi-code/src/utils/goal.ts`. Branch 3's phase also adds **SDK events**, which
Branch 1 does not have.

### ✅ Branch 3 capabilities Branch 1 lacks
- ✅ **SDK goal lifecycle events.** Branch 3 emits `goal.created`, `goal.updated`
  (with `previousStatus`), `goal.evaluated`, `goal.continued`, `goal.cleared` over the SDK
  event stream (store gets an injected `emitEvent`; the continuation controller emits
  `goal.continued`). Branch 1 has only the internal audit *records* from Phase 1b — no
  real-time SDK event surface. This is a genuine observability win for Branch 3.
- ✅ **The Phase 2 budget-flag gap is fixed here.** The new `utils/goal.ts` parses
  `--max-tokens` / `--max-turns` / `--max-minutes` (→ `tokenBudget` / `turnBudget` /
  `wallClockBudgetMs`), shared by both the `/goal` slash command and headless mode. The
  `tui/commands/goal.ts` shrank by ~92 lines as it adopted the shared parser. Good
  deduplication and a real fix to the earlier gap.

### ❌ Findings
- ❌ **Headless exit-code contracts are incompatible — and Branch 3 conflates failure with
  success.** Only `complete = 0` agrees. Otherwise:

  | status | Branch 1 | Branch 3 |
  |---|---|---|
  | complete | 0 | 0 |
  | error | **1** | **0** (default) |
  | blocked | 3 | 10 |
  | impossible | 4 | 11 |
  | budget_limited | 5 | 12 |
  | interrupted | 6 | **0** (default) |
  | cancelled | 7 | 130 |

  The values simply differ (fine on its own), but **Branch 3 maps `error` and `interrupted`
  to `0`**, so a script can't distinguish an errored or interrupted goal from a completed
  one. Branch 1 gives every non-complete terminal state a distinct non-zero code. This is a
  real headless-usability regression on Branch 3.
- ❌ **`noProgressTurnLimit` / `failureTurnLimit` are *still* unreachable.** The new
  `utils/goal.ts` parser handles only the three basic budgets — it does not parse the
  no-progress / failure limits, and the `CreateGoal` tool schema still omits them (Phase 3).
  So the Phase 4d no-progress and evaluator-failure stop conditions remain effectively
  dormant for all non-SDK callers. This is now the longest-standing open gap.
- ❌ **The Phase 4d terminal-verdict-vs-budget ordering bug remains** (completed goal can be
  mislabeled `budget_limited`). Not touched in Phase 6.
- ⚠️ Branch 3's `goal.ts` adds a `GoalEventEmitter` typed as
  `(event: { type: string; [k:string]: unknown }) => void` — loosely typed (untyped payload),
  whereas the `rpc/events.ts` event interfaces are precise; the store-side emit isn't checked
  against them.

### Net assessment (Phase 6)
Branch 3 ends strong on *features* — it ships **SDK lifecycle events Branch 1 never added**
and finally closes the budget-flag parsing gap. But its **headless exit-code contract is
weaker** (error/interrupted indistinguishable from success), and the two structural problems
carried from Phase 4d (verdict/budget ordering; unreachable no-progress/failure limits)
survive to the end.

---

## Overall verdict (Phases 1a–6 complete on both branches)

Branch 3 reached **full phase parity** with Branch 1. It is a *hybrid* design: it took
Branch 2's cleaner type layout (wrapper `GoalSnapshot`, `string` actors, no dedicated
`lastModelReport*` fields) but restored Branch 1's safer **awaited, single-source-of-truth
persistence**. The two implementations are **behaviorally equivalent on the core happy path**
— create → inject → autonomous continuation → evaluator-driven completion — and they made the
same load-bearing decisions (audit-only records, replay-ignore, resume→paused normalization,
model-reports-are-advisory, evaluator owns completion).

**Where Branch 3 is genuinely better than Branch 1:**
- Smarter injection cadence (full/sparse/refresh dedup) vs Branch 1's always-full re-inject —
  more relevant to keeping the goal alive over long runs.
- SDK goal lifecycle events (Branch 1 has none).
- Cleaner continuation return contract (`undefined` = defer vs Branch 1's blanket `STOP`).
- A visible pattern of **self-correcting its own earlier issues** (paused-accrual in 4b,
  missing awaits in 5, budget-flag parsing in 6).

**Open issues on Branch 3, by severity:**
1. ❌ **4d ordering bug** — a `complete` verdict can be overridden to `budget_limited` when the
   evaluator's own tokens cross the budget. Mislabels finished goals. *Highest priority.*
2. ❌ **`noProgressTurnLimit` / `failureTurnLimit` unreachable** outside the raw SDK — the
   evaluator's no-progress / failure stops rarely fire.
3. ❌ **Headless exit codes conflate `error`/`interrupted` with success (`0`).**
4. ⚠️ **No `<untrusted_objective>` prompt-injection framing** in context injection (Branch 1
   hardens this; security regression).
5. ⚠️ **Fragile model-report string coupling** — mostly mooted by 4d (advisory only) but still
   present via `extractModelReport`.
6. ⚠️ Weakest goal-ID scheme (`goal-${Date.now()}`, same-ms collision); missing flag/env-var
   docs; thinner type-safety (no `GoalActor`, non-`.strict()` schemas, third distinct
   `GoalEvidence` shape); no evaluator test seam; bespoke evaluator token sum vs `grandTotal`.

**Bottom line:** Branch 3 is a credible, broadly-consistent reimplementation that even
surpasses Branch 1 on a few axes (injection cadence, SDK events). It is *not* a drop-in match
— the public types (snapshot shape, evidence shape, exit codes, event surface) differ enough
that consumers are not interchangeable. Before it could be considered on par with the
finished Branch 1, the items worth fixing are, in order: the **4d verdict/budget ordering**,
the **unreachable no-progress/failure limits**, the **headless exit-code conflation**, and
restoring the **`<untrusted_objective>` hardening**.

