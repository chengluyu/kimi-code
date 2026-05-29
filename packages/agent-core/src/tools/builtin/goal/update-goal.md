Report your terminal judgment about the current goal. This records a *report* — it does not end
the goal by itself. The runtime continuation controller and an independent evaluator decide
whether your report ends the goal.

Use:

- `complete` only when no required work remains and any stated validation has passed.
- `blocked` only when the same external condition or required user input prevents progress.
- `impossible` when the objective cannot be completed as stated.

Always include a short `reason`. Include `evidence` (validation results, command output
summaries, file references) when available — the evaluator uses it to confirm your report.

Expect the continuation controller or evaluator to decide whether the goal actually ends.
