export const GLOBAL_OUTPUT_LOG_SCHEMA_VERSION = 1 as const;

export type GlobalOutputLogSchemaVersion = typeof GLOBAL_OUTPUT_LOG_SCHEMA_VERSION;

export type GlobalOutputLogLevel = "info" | "warn" | "error";

export type GlobalOutputLogStream = "stdout" | "stderr";

export interface GlobalOutputLogEntry {
  ts: string;
  level: GlobalOutputLogLevel;
  stream: GlobalOutputLogStream;
  kind: string;
  message: string;
  command: string;
  argv: string[];
  cwd: string;
  pid: number;
  version: string;
  session_id: string;
}

export function serializeGlobalOutputLogEntry(entry: GlobalOutputLogEntry): string {
  return `${JSON.stringify(sanitizeGlobalOutputLogEntry(entry))}\n`;
}

export function sanitizeGlobalOutputLogEntry(entry: GlobalOutputLogEntry): GlobalOutputLogEntry {
  return {
    ts: stripAnsi(entry.ts),
    level: entry.level,
    stream: entry.stream,
    kind: stripAnsi(entry.kind),
    message: stripAnsi(entry.message),
    command: stripAnsi(entry.command),
    argv: entry.argv.map((arg) => stripAnsi(arg)),
    cwd: stripAnsi(entry.cwd),
    pid: entry.pid,
    version: stripAnsi(entry.version),
    session_id: stripAnsi(entry.session_id),
  };
}

const ANSI_ESCAPE_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}
