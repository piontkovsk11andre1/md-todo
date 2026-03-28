import type {
  GlobalOutputLogEntry,
  GlobalOutputLogLevel,
  GlobalOutputLogStream,
} from "../domain/global-output-log.js";
import type { ApplicationOutputEvent, ApplicationOutputPort } from "../domain/ports/output-port.js";

export interface GlobalOutputEntryWriter {
  write(entry: GlobalOutputLogEntry): void;
}

export interface LoggedOutputContext {
  command: string;
  argv: string[];
  cwd: string;
  pid: number;
  version: string;
  sessionId: string;
}

export interface CreateLoggedOutputPortOptions {
  output: ApplicationOutputPort;
  writer: GlobalOutputEntryWriter;
  context: LoggedOutputContext;
  now?: () => string;
}

export function createLoggedOutputPort(options: CreateLoggedOutputPortOptions): ApplicationOutputPort {
  const now = options.now ?? (() => new Date().toISOString());

  return {
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

function resolveLogKind(event: ApplicationOutputEvent): string {
  switch (event.kind) {
    case "info":
      return "info";
    case "warn":
      return "warn";
    case "error":
      return "error";
    case "success":
      return "success";
    case "task":
      return "task";
    case "text":
      return "text";
    case "stderr":
      return "stderr";
  }
}

function resolveLogLevel(event: ApplicationOutputEvent): GlobalOutputLogLevel {
  switch (event.kind) {
    case "warn":
      return "warn";
    case "error":
    case "stderr":
      return "error";
    case "info":
    case "success":
    case "task":
    case "text":
    default:
      return "info";
  }
}

function resolveLogStream(event: ApplicationOutputEvent): GlobalOutputLogStream {
  switch (event.kind) {
    case "error":
    case "stderr":
      return "stderr";
    case "info":
    case "warn":
    case "success":
    case "task":
    case "text":
    default:
      return "stdout";
  }
}

function resolveLogMessage(event: ApplicationOutputEvent): string {
  switch (event.kind) {
    case "info":
    case "warn":
    case "error":
    case "success":
      return event.message;
    case "task": {
      const task = `${event.task.file}:${event.task.line} [#${event.task.index}] ${event.task.text}`;
      return event.blocked ? `${task} (blocked)` : task;
    }
    case "text":
    case "stderr":
      return event.text;
    default:
      return "";
  }
}
