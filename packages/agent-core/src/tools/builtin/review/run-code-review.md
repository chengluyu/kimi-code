Run a code review by fanning out fresh reviewer subagents over the selected changes.

Call this after your pilot analysis of the diff. You supply what the reviewers cannot work out on their own:

- `background`: a briefing for the reviewers — what the change is, its intent, and the context needed to judge it. Write it from your knowledge of the change. Keep it factual orientation, not a verdict; do not tell the reviewers whether the code is correct.
- `directions`: the review angles to cover. Each direction becomes one reviewer's focus (thorough), or is multiplied across file groups (deep). Lead with the user's stated review instruction when one was given, then add the angles the change most warrants. Provide at least 2 directions for `deep`.
- `target`: the scope to review (`working_tree`, `current_branch` with a `baseRef`, or `single_commit` with a `commit`). Use the scope the user selected.
- `intensity`: `standard` (one reviewer), `thorough` (one reviewer per direction, then reconciliation), or `deep` (directions × file groups via an agent swarm, then reconciliation).
- `change_type` (optional): a short label for the change, e.g. "TUI refactor".

The reviewers are read-only and independent; they only see the background, their assigned files, and their direction. The tool returns the consolidated review (summary and comments) and saves it as a browsable review artifact.
