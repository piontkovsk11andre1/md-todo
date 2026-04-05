/** Canonical unchecked TODO list line used across worker parsing flows. */
export type UncheckedTodoLine = string;

/**
 * Extracts unchecked Markdown TODO lines from arbitrary text.
 *
 * Accepts `-`, `*`, and `+` list markers and trims leading indentation.
 */
export function parseUncheckedTodoLines(source: string): UncheckedTodoLine[] {
  const lines = source.split(/\r?\n/);
  const taskPattern = /^\s*[-*+]\s+\[ \]\s+\S/;

  return lines
    .filter((line) => taskPattern.test(line))
    .map((line) => line.replace(/^\s+/, ""));
}
