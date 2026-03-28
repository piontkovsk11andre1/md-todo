import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import type {
  ArtifactRunMetadata,
  ArtifactStore,
  Clock,
  WorkingDirectoryPort,
} from "../domain/ports/index.js";
import pc from "picocolors";
import { formatRelativeTimestamp } from "../domain/relative-time.js";
import { toCompactRunId } from "../domain/run-id.js";

export interface LogRunsDependencies {
  artifactStore: ArtifactStore;
  workingDirectory: WorkingDirectoryPort;
  clock: Clock;
  output: ApplicationOutputPort;
}

export interface LogRunsOptions {
  revertable: boolean;
  commandName?: string;
  limit?: number;
  json: boolean;
  cwd?: string;
}

interface LogRunEntry {
  runId: string;
  shortRunId: string;
  commandName: string;
  status: string;
  relativeTime: string;
  taskSummary: string;
  source: string;
  commitSha: string | null;
  shortCommitSha: string | null;
  revertable: boolean;
  startedAt: string;
  completedAt?: string;
}

export function createLogRuns(
  dependencies: LogRunsDependencies,
): (options: LogRunsOptions) => number {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return function logRuns(options: LogRunsOptions): number {
    const cwd = options.cwd ?? dependencies.workingDirectory.cwd();
    const normalizedCommandFilter = normalizeOptionalLower(options.commandName);
    const now = dependencies.clock.now();
    const runs = dependencies.artifactStore
      .listSaved(cwd)
      .filter((run) => run.status === "completed")
      .filter((run) => {
        if (!normalizedCommandFilter) {
          return true;
        }
        return run.commandName.toLowerCase() === normalizedCommandFilter;
      })
      .filter((run) => options.revertable ? isRevertableRun(run) : true)
      .slice(0, options.limit);

    if (runs.length === 0) {
      emit({ kind: "info", message: "No matching completed runs found." });
      return 0;
    }

    const entries = runs.map((run) => toLogRunEntry(run, now));

    if (options.json) {
      emit({ kind: "text", text: JSON.stringify(entries, null, 2) });
      return 0;
    }

    for (const entry of entries) {
      emit({ kind: "text", text: formatLogLine(entry) });
    }

    return 0;
  };
}

function toLogRunEntry(run: ArtifactRunMetadata, now: Date): LogRunEntry {
  const commitSha = getCommitSha(run);
  const revertable = run.status === "completed" && commitSha !== null;
  const timestamp = run.completedAt ?? run.startedAt;

  return {
    runId: run.runId,
    shortRunId: toCompactRunId(run.runId),
    commandName: run.commandName,
    status: run.status ?? "unknown",
    relativeTime: formatRelativeTimestamp(now, timestamp),
    taskSummary: summarizeTask(run.task?.text),
    source: formatSource(run),
    commitSha,
    shortCommitSha: commitSha ? shortCommitSha(commitSha) : null,
    revertable,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function formatLogLine(entry: LogRunEntry): string {
  const line = [
    entry.shortRunId,
    entry.relativeTime,
    formatStatus(entry.status),
    entry.taskSummary,
    `source=${entry.source}`,
    `command=${entry.commandName}`,
    `sha=${entry.shortCommitSha ?? "-"}`,
    `revertable=${entry.revertable ? "yes" : "no"}`,
  ].join(" | ");

  return entry.revertable ? line : pc.dim(line);
}

function formatStatus(status: string): string {
  const label = `[${status}]`;
  switch (status.toLowerCase()) {
    case "completed":
      return pc.green(label);
    case "failed":
      return pc.red(label);
    case "cancelled":
    case "canceled":
      return pc.yellow(label);
    default:
      return pc.blue(label);
  }
}

function shortCommitSha(sha: string): string {
  return sha.length <= 12 ? sha : sha.slice(0, 12);
}

function getCommitSha(run: ArtifactRunMetadata): string | null {
  const commitSha = run.extra?.["commitSha"];
  if (typeof commitSha !== "string") {
    return null;
  }

  const normalized = commitSha.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRevertableRun(run: ArtifactRunMetadata): boolean {
  return run.status === "completed" && getCommitSha(run) !== null;
}

function summarizeTask(taskText: string | undefined): string {
  if (!taskText) {
    return "(task metadata unavailable)";
  }

  const singleLine = taskText.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 80) {
    return singleLine;
  }

  return singleLine.slice(0, 77) + "...";
}

function formatSource(run: ArtifactRunMetadata): string {
  if (run.task?.file && Number.isInteger(run.task.line) && run.task.line > 0) {
    return `${run.task.file}:${run.task.line}`;
  }

  if (run.task?.file) {
    return run.task.file;
  }

  if (typeof run.source === "string" && run.source.trim().length > 0) {
    return run.source;
  }

  return "(unknown source)";
}

function normalizeOptionalLower(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}
