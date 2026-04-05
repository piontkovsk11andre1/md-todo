import type {
  GlobalOutputLogEntry,
  GlobalOutputLogKind,
  GlobalOutputLogLevel,
  GlobalOutputLogStream,
} from "../domain/global-output-log.js";
import type { ApplicationOutputEvent, ApplicationOutputPort } from "../domain/ports/output-port.js";

/**
 * Writes structured global output log entries to the configured sink.
 */
export interface GlobalOutputEntryWriter {
  write(entry: GlobalOutputLogEntry): void;
}

/**
 * Carries immutable invocation metadata attached to every emitted log record.
 */
export interface LoggedOutputContext {
  command: string;
  argv: string[];
  cwd: string;
  pid: number;
  version: string;
  sessionId: string;
}

/**
 * Defines dependencies required to create an output port that also logs globally.
 */
export interface CreateLoggedOutputPortOptions {
  output: ApplicationOutputPort;
  writer: GlobalOutputEntryWriter;
  context: LoggedOutputContext;
  now?: () => string;
}

/**
 * Creates an output port wrapper that mirrors application output to structured logs.
 *
 * The wrapper is intentionally fail-safe: log write failures are swallowed so primary
 * user-facing output delivery is never interrupted.
 */
export function createLoggedOutputPort(options: CreateLoggedOutputPortOptions): ApplicationOutputPort {
  // Allow deterministic timestamps in tests while defaulting to wall-clock time.
  const now = options.now ?? (() => new Date().toISOString());

  return {
    // Emit to the structured logger first, then always forward to the real output port.
    emit(event) {
      try {
        options.writer.write({
          ts: now(),
          level: resolveLogLevel(event),
          stream: resolveLogStream(event),
          kind: resolveLogKind(event),
          message: resolveLogMessage(event),
          command: options.context.command,
          argv: options.context.argv,
          cwd: options.context.cwd,
          pid: options.context.pid,
          version: options.context.version,
          session_id: options.context.sessionId,
        });
      } catch {
        // best-effort logging: never interrupt output flow on log write failures
      }

      options.output.emit(event);
    },
  };
}

/**
 * Maps output event kinds to persisted log kind values.
 */
function resolveLogKind(event: ApplicationOutputEvent): GlobalOutputLogKind {
  switch (event.kind) {
    case "group-start":
      return "group-start";
    case "group-end":
      return "group-end";
    case "info":
      return "info";
    case "warn":
      return "warn";
    case "error":
      return "error";
    case "success":
      return "success";
    case "progress":
      return "progress";
    case "task":
      return "task";
    case "text":
      return "text";
    case "stderr":
      return "stderr";
  }
}

/**
 * Maps output events to severity levels used by global log consumers.
 */
function resolveLogLevel(event: ApplicationOutputEvent): GlobalOutputLogLevel {
  switch (event.kind) {
    case "warn":
      return "warn";
    case "error":
    case "stderr":
      return "error";
    case "group-start":
    case "group-end":
    case "info":
    case "success":
    case "progress":
    case "task":
    case "text":
    default:
      return "info";
  }
}

/**
 * Selects the canonical output stream associated with an output event kind.
 */
function resolveLogStream(event: ApplicationOutputEvent): GlobalOutputLogStream {
  switch (event.kind) {
    case "error":
    case "stderr":
      return "stderr";
    case "group-start":
    case "group-end":
    case "info":
    case "warn":
    case "success":
    case "progress":
    case "task":
    case "text":
    default:
      return "stdout";
  }
}

/**
 * Produces the log message payload for any application output event.
 */
function resolveLogMessage(event: ApplicationOutputEvent): string {
  switch (event.kind) {
    case "group-start": {
      const counter = event.counter ? `[${event.counter.current}/${event.counter.total}] ` : "";
      return `${counter}${event.label}`;
    }
    case "group-end":
      return event.message ? `${event.status} - ${event.message}` : event.status;
    case "info":
    case "warn":
    case "error":
    case "success":
      return event.message;
    case "progress":
      return formatProgressMessage(event.progress);
    case "task": {
      // Render the primary task line, then append ordered child and sub-item lines.
      const task = formatTaskLine(event.task);
      const parentLine = event.blocked ? `${task} (blocked)` : task;
      const children = event.children ?? event.task.children;
      const subItems = event.subItems ?? event.task.subItems;
      const detailLines = formatTaskDetailLines({
        file: event.task.file,
        parentDepth: event.task.depth,
        children,
        subItems,
        indentLevel: 1,
      });

      if (detailLines.length === 0) {
        return parentLine;
      }

      // Preserve multi-line readability in downstream logs.
      return [parentLine, ...detailLines].join("\n");
    }
    case "text":
    case "stderr":
      return event.text;
    default:
      return "";
  }
}

/**
 * Builds a log-safe progress message from structured progress metadata.
 */
function formatProgressMessage(progress: {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  unit?: string;
}): string {
  const hasCounters = typeof progress.current === "number"
    && typeof progress.total === "number"
    && Number.isFinite(progress.current)
    && Number.isFinite(progress.total)
    && progress.total > 0;
  const current = hasCounters ? Math.max(0, Math.floor(progress.current!)) : 0;
  const total = hasCounters ? Math.max(1, Math.floor(progress.total!)) : 0;
  const counter = hasCounters
    ? ` (${current}/${total}${progress.unit ? ` ${progress.unit}` : ""})`
    : "";
  const detail = progress.detail ? ` - ${progress.detail}` : "";
  return `${progress.label}${counter}${detail}`;
}

/**
 * Formats one task reference using file, line, index, and text metadata.
 */
function formatTaskLine(task: { file: string; line: number; index: number; text: string }): string {
  return `${task.file}:${task.line} [#${task.index}] ${task.text}`;
}

/**
 * Defines optional task tree data used to render nested detail lines.
 */
interface TaskDetailLineOptions {
  file: string;
  parentDepth: number;
  children?: unknown;
  subItems?: unknown;
  indentLevel: number;
}

/**
 * Represents the minimum shape required to render a nested task node.
 */
interface TaskLike {
  file: string;
  line: number;
  index: number;
  text: string;
  depth: number;
  children?: unknown;
  subItems?: unknown;
}

/**
 * Represents a leaf checklist/sub-item emitted under a task node.
 */
interface SubItemLike {
  text: string;
  line: number;
  depth: number;
}

/**
 * Builds sorted, indented detail lines for nested task and sub-item structures.
 */
function formatTaskDetailLines(options: TaskDetailLineOptions): string[] {
  // Accept only arrays to guard against malformed runtime payloads.
  const children = Array.isArray(options.children) ? (options.children as TaskLike[]) : [];
  const subItems = Array.isArray(options.subItems) ? (options.subItems as SubItemLike[]) : [];

  const detailGroups: Array<{ line: number; lines: string[] }> = [];

  for (const child of children) {
    // Render each child line and recursively include all nested descendants.
    const childLines = [
      `${"  ".repeat(options.indentLevel)}${formatTaskLine(child)}`,
      ...formatTaskDetailLines({
        file: child.file,
        parentDepth: child.depth,
        children: child.children,
        subItems: child.subItems,
        indentLevel: options.indentLevel + 1,
      }),
    ];
    detailGroups.push({ line: child.line, lines: childLines });
  }

  for (const subItem of subItems) {
    // Preserve relative indentation depth for nested checklist entries.
    const extraIndent = Math.max(0, subItem.depth - (options.parentDepth + 1));
    const indent = options.indentLevel + extraIndent;
    detailGroups.push({
      line: subItem.line,
      lines: [`${"  ".repeat(indent)}${options.file}:${subItem.line} - ${subItem.text}`],
    });
  }

  // Keep task children and sub-items in source-file order for stable log output.
  detailGroups.sort((left, right) => left.line - right.line);
  return detailGroups.flatMap((group) => group.lines);
}
