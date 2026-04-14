/**
 * Canonical human-readable timestamp format for CLI terminal rendering.
 */
export const CLI_TIMESTAMP_FORMAT = "UTC ISO-8601";

/**
 * Formats a Date/string value into UTC ISO-8601 for CLI display.
 *
 * When the input string is not parseable as a date, the original value is
 * returned to keep output deterministic.
 */
export function formatCliTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return value;
  }

  return new Date(parsedMs).toISOString();
}
