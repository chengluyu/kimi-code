Set the status of the current goal. This is how you end or yield an autonomous goal.

- `complete` — the objective is satisfied and any stated validation has passed. The goal ends and a completion summary is recorded.
- `blocked` — an external condition or required user input prevents progress, or the objective cannot be completed as stated. The goal stops but can be resumed later.
- `paused` — set the goal aside for now (e.g. to hand control back to the user). It can be resumed later.

If you do not call this, the goal keeps running: after your turn ends you will be prompted to continue. Call this as soon as the goal is genuinely complete or cannot proceed — don't keep working once there is nothing left to do. Explain your reasoning in your reply; this tool only records the status.
