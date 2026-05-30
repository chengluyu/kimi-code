import type { AutocompleteItem } from '@earendil-works/pi-tui';

/**
 * A completable token (subcommand or flag) for a slash command's argument
 * position. Generic across commands — any `KimiSlashCommand` can build a
 * `getArgumentCompletions` from a list of these via {@link completeLeadingArg}.
 */
export interface ArgCompletionSpec {
  /** The token inserted on completion, e.g. `pause` or `--max-turns`. */
  readonly value: string;
  /** Short description shown in the autocomplete menu. */
  readonly description: string;
}

/**
 * Generic leading-token completer for slash-command arguments.
 *
 * pi-tui passes `argumentPrefix` = everything typed after `/<command> `. We only
 * complete the *first* token: once the user has typed a space after it (moved on
 * to an objective, a flag value, etc.) we return `null` so completion never
 * clobbers free text. Matching is case-insensitive prefix match on `value`.
 */
export function completeLeadingArg(
  specs: readonly ArgCompletionSpec[],
  argumentPrefix: string,
): AutocompleteItem[] | null {
  if (argumentPrefix.includes(' ')) return null;
  const lower = argumentPrefix.toLowerCase();
  const items = specs
    .filter((spec) => spec.value.toLowerCase().startsWith(lower))
    .map((spec) => ({ value: spec.value, label: spec.value, description: spec.description }));
  return items.length > 0 ? items : null;
}
