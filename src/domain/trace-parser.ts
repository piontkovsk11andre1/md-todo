const TRACE_BLOCK_PATTERN = /```rundown-trace[\t ]*\r?\n([\s\S]*?)\r?\n```/;

export function parseTraceBlock(stdout: string): Record<string, string> | null {
  const match = TRACE_BLOCK_PATTERN.exec(stdout);

  if (!match || !match[1]) {
    return null;
  }

  const lines = match[1].split(/\r?\n/);
  const parsed: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0) {
      continue;
    }

    const value = line.slice(separatorIndex + 1).trim();
    parsed[key] = value;
  }

  return parsed;
}
