import type {
  CommandExecutionOptions,
  CommandExecutor,
  CommandResult,
} from "./ports/command-executor.js";

export interface CliBlock {
  startOffset: number;
  endOffset: number;
  commands: string[];
}

interface ActiveFence {
  marker: "`" | "~";
  ticks: number;
  isCli: boolean;
  startOffset: number;
  commands: string[];
}

interface FenceInfo {
  marker: "`" | "~";
  ticks: number;
  info: string;
}

function parseFenceOpen(line: string): FenceInfo | null {
  const match = line.match(/^([`~])\1{2,}(.*)$/);
  if (!match) {
    return null;
  }

  const marker = match[1] as "`" | "~";
  const fullFence = match[0].match(/^([`~]{3,})/)?.[1] ?? "";

  return {
    marker,
    ticks: fullFence.length,
    info: match[2] ?? "",
  };
}

function isFenceClose(line: string, marker: "`" | "~", ticks: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length < ticks) {
    return false;
  }

  const markerPattern = marker === "`" ? /^`+$/ : /^~+$/;
  return markerPattern.test(trimmed);
}

function isCliFenceInfo(info: string): boolean {
  return /^cli[\t ]*$/.test(info);
}

function isCommentLine(line: string): boolean {
  return line.startsWith("#");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXmlBlock(command: string, result: CommandResult): string {
  const hasNonZeroExit =
    typeof result.exitCode === "number" && result.exitCode !== 0;
  const isTimeout =
    result.exitCode === 124 && /timed out/i.test(result.stderr);
  const exitCodeAttribute = hasNonZeroExit
    ? ` exit_code=\"${escapeXml(isTimeout ? "timeout" : String(result.exitCode ?? -1))}\"`
    : "";
  const output = hasNonZeroExit
    ? isTimeout
      ? ["ERROR: command timed out", result.stderr].filter((entry) => entry.length > 0).join("\n")
      : result.stderr
    : result.stdout;
  const escapedOutput = escapeXml(output);

  return `<command${exitCodeAttribute}>${escapeXml(command)}</command>\n<output>\n${escapedOutput}\n</output>`;
}

export function extractCliBlocks(source: string): CliBlock[] {
  const blocks: CliBlock[] = [];
  let offset = 0;
  let activeFence: ActiveFence | null = null;

  while (offset < source.length) {
    const lineStart = offset;
    const nextLineFeed = source.indexOf("\n", offset);
    const lineEndWithTerminator =
      nextLineFeed === -1 ? source.length : nextLineFeed + 1;
    let line = source.slice(offset, lineEndWithTerminator);

    offset = lineEndWithTerminator;

    if (line.endsWith("\n")) {
      line = line.slice(0, -1);
    }

    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }

    if (activeFence) {
      if (isFenceClose(line, activeFence.marker, activeFence.ticks)) {
        if (activeFence.isCli) {
          blocks.push({
            startOffset: activeFence.startOffset,
            endOffset: lineStart + line.length,
            commands: activeFence.commands,
          });
        }

        activeFence = null;
        continue;
      }

      if (activeFence.isCli) {
        const trimmedLine = line.trim();
        if (trimmedLine.length > 0 && !isCommentLine(trimmedLine)) {
          activeFence.commands.push(trimmedLine);
        }
      }

      continue;
    }

    const openedFence = parseFenceOpen(line);
    if (!openedFence) {
      continue;
    }

    activeFence = {
      marker: openedFence.marker,
      ticks: openedFence.ticks,
      isCli: openedFence.ticks === 3 && isCliFenceInfo(openedFence.info),
      startOffset: lineStart,
      commands: [],
    };
  }

  if (activeFence?.isCli) {
    blocks.push({
      startOffset: activeFence.startOffset,
      endOffset: source.length,
      commands: activeFence.commands,
    });
  }

  return blocks;
}

export async function expandCliBlocks(
  source: string,
  executor: CommandExecutor,
  cwd: string,
  options?: CommandExecutionOptions,
): Promise<string> {
  const blocks = extractCliBlocks(source);

  if (blocks.length === 0) {
    return source;
  }

  let expanded = "";
  let cursor = 0;
  let artifactCommandOrdinal = 0;

  for (const block of blocks) {
    expanded += source.slice(cursor, block.startOffset);
    cursor = block.endOffset;

    const commandBlocks: string[] = [];

    for (const command of block.commands) {
      artifactCommandOrdinal += 1;
      const startedAt = Date.now();
      const executionOptions = options?.artifactContext
        ? {
          ...options,
          artifactCommandOrdinal,
        }
        : options;
      const result = await executor.execute(command, cwd, executionOptions);
      const durationMs = Math.max(0, Date.now() - startedAt);
      await options?.onCommandExecuted?.({
        command,
        exitCode: result.exitCode,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
        durationMs,
      });
      commandBlocks.push(toXmlBlock(command, result));
    }

    expanded += commandBlocks.join("\n\n");
  }

  expanded += source.slice(cursor);

  return expanded;
}
