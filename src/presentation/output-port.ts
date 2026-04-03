import type { ApplicationOutputEvent, ApplicationOutputPort } from "../domain/ports/output-port.js";
import pc from "picocolors";

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;
const SPINNER_FRAMES = ["-", "\\", "|", "/"];

interface ProgressRenderState {
  active: boolean;
  frameIndex: number;
  lineWidth: number;
}

const progressRenderState: ProgressRenderState = {
  active: false,
  frameIndex: 0,
  lineWidth: 0,
};

/**
 * Applies a dimmed terminal style to supporting status text.
 */
function dim(message: string): string {
  return pc.dim(message);
}

/**
 * Builds the primary CLI label for a task entry.
 */
function taskLabel(task: { text: string; file: string; line: number; index: number }): string {
  return `${pc.cyan(task.file)}:${pc.yellow(String(task.line))} ${pc.dim(`[#${task.index}]`)} ${task.text}`;
}

interface TaskLike {
  text: string;
  file: string;
  line: number;
  index: number;
  depth: number;
  children?: unknown;
  subItems?: unknown;
}

interface SubItemLike {
  text: string;
  line: number;
  depth: number;
}

interface TaskDetailLineOptions {
  file: string;
  parentDepth: number;
  children?: unknown;
  subItems?: unknown;
  indentLevel: number;
}

/**
 * Renders a progress payload into a stable one-line status string.
 */
function formatProgressLine(progress: {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  unit?: string;
}): string {
  const hasCounters = typeof progress.current === "number" && typeof progress.total === "number";
  const counter = hasCounters
    ? ` (${progress.current}/${progress.total}${progress.unit ? ` ${progress.unit}` : ""})`
    : "";
  const detail = progress.detail ? ` — ${progress.detail}` : "";
  return `${progress.label}${counter}${detail}`;
}

/**
 * Determines whether animated progress rendering is safe for this terminal session.
 */
function isInteractiveProgressEnabled(): boolean {
  if (!process.stdout.isTTY) {
    return false;
  }

  const ci = process.env["CI"];
  if (typeof ci !== "string") {
    return true;
  }

  const normalized = ci.trim().toLowerCase();
  return normalized === "" || normalized === "0" || normalized === "false";
}

/**
 * Computes the printable width of text by removing ANSI color sequences.
 */
function printableWidth(text: string): number {
  return text.replace(ANSI_ESCAPE_PATTERN, "").length;
}

/**
 * Commits any in-place progress line before emitting a normal newline-based message.
 */
function flushProgressLine(): void {
  if (!progressRenderState.active) {
    return;
  }

  process.stdout.write("\n");
  progressRenderState.active = false;
  progressRenderState.lineWidth = 0;
}

/**
 * Renders bounded progress payloads with a deterministic ASCII progress bar.
 */
function renderBoundedProgress(progress: {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  unit?: string;
}): string {
  const width = 16;
  const current = Math.max(0, progress.current ?? 0);
  const total = Math.max(1, progress.total ?? 1);
  const ratio = Math.min(1, current / total);
  const filled = Math.round(ratio * width);
  const bar = `[${"=".repeat(filled)}${" ".repeat(width - filled)}]`;
  const unit = progress.unit ? ` ${progress.unit}` : "";
  const detail = progress.detail ? ` - ${progress.detail}` : "";
  return `${progress.label} ${bar} ${current}/${total}${unit}${detail}`;
}

/**
 * Updates an in-place progress line when interactive rendering is enabled.
 */
function renderInteractiveProgress(progress: {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  unit?: string;
}): void {
  const hasCounters = typeof progress.current === "number" && typeof progress.total === "number";
  const frame = SPINNER_FRAMES[progressRenderState.frameIndex % SPINNER_FRAMES.length];
  progressRenderState.frameIndex += 1;

  const message = hasCounters
    ? `${pc.blue("#")} ${renderBoundedProgress(progress)}`
    : `${pc.blue(frame)} ${formatProgressLine(progress)}`;
  const width = printableWidth(message);
  const padding = Math.max(0, progressRenderState.lineWidth - width);

  process.stdout.write(`\r${message}${" ".repeat(padding)}`);
  progressRenderState.active = true;
  progressRenderState.lineWidth = width;
}

/**
 * Flattens nested child tasks and sub-items into ordered, indented CLI output lines.
 */
function formatTaskDetailLines(options: TaskDetailLineOptions): string[] {
  // Normalize optional collections to arrays so downstream rendering is deterministic.
  const children = Array.isArray(options.children) ? (options.children as TaskLike[]) : [];
  const subItems = Array.isArray(options.subItems) ? (options.subItems as SubItemLike[]) : [];

  const detailGroups: Array<{ line: number; lines: string[] }> = [];

  for (const child of children) {
    // Render each child task and recursively include its nested detail lines.
    const childLines = [
      `${"  ".repeat(options.indentLevel)}${taskLabel(child)}`,
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
    // Preserve relative indentation for sub-items based on their markdown depth.
    const extraIndent = Math.max(0, subItem.depth - (options.parentDepth + 1));
    const indent = options.indentLevel + extraIndent;
    detailGroups.push({
      line: subItem.line,
      lines: [
        `${"  ".repeat(indent)}${pc.cyan(options.file)}:${pc.yellow(String(subItem.line))} - ${subItem.text}`,
      ],
    });
  }

  // Sort by source line so mixed children and sub-items print in document order.
  detailGroups.sort((left, right) => left.line - right.line);
  return detailGroups.flatMap((group) => group.lines);
}

/**
 * CLI implementation of the application output port.
 *
 * Routes domain output events to console channels with consistent color and structure.
 */
export const cliOutputPort: ApplicationOutputPort = {
  /**
   * Emits a single application output event to the terminal.
   */
  emit(event: ApplicationOutputEvent): void {
    // Delegate formatting by event kind to keep each output path explicit.
    switch (event.kind) {
      case "info":
        flushProgressLine();
        console.log(pc.blue("ℹ") + " " + event.message);
        return;
      case "warn":
        flushProgressLine();
        console.log(pc.yellow("⚠") + " " + event.message);
        return;
      case "error":
        flushProgressLine();
        console.error(pc.red("✖") + " " + event.message);
        return;
      case "success":
        flushProgressLine();
        console.log(pc.green("✔") + " " + event.message);
        return;
      case "progress":
        if (isInteractiveProgressEnabled()) {
          renderInteractiveProgress(event.progress);
          return;
        }

        flushProgressLine();
        console.log(pc.blue("⏳") + " " + formatProgressLine(event.progress));
        return;
      case "task":
        {
          flushProgressLine();
          // Prefer explicitly supplied nested details, then fall back to task payload data.
          const children = event.children ?? event.task.children;
          const subItems = event.subItems ?? event.task.subItems;
          const lines = [
            taskLabel(event.task)
            + (event.blocked ? dim(" (blocked — has unchecked subtasks)") : ""),
            ...formatTaskDetailLines({
              file: event.task.file,
              parentDepth: event.task.depth,
              children,
              subItems,
              indentLevel: 1,
            }),
          ];
          console.log(lines.join("\n"));
        }
        return;
      case "text":
        flushProgressLine();
        console.log(event.text);
        return;
      case "stderr":
        flushProgressLine();
        process.stderr.write(event.text);
        return;
      default:
        return;
    }
  },
};
