const COMPACT_RUN_ID_LENGTH = 16;

export function toCompactRunId(runId: string): string {
  if (runId.length <= COMPACT_RUN_ID_LENGTH) {
    return runId;
  }

  return runId.slice(0, COMPACT_RUN_ID_LENGTH);
}
