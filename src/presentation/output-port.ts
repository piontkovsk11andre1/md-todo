import type { ApplicationOutputEvent, ApplicationOutputPort } from "../domain/ports/output-port.js";
import pc from "picocolors";
import { sleep, typeText } from "./animation.js";

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAME_INTERVAL_MS = 80;
const CLI_TYPING_DELAY_MS = 10;
const CLI_CASCADE_DELAY_MS = 45;

interface ProgressPayload {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  unit?: string;
}

interface ProgressRenderState {
  active: boolean;
  frameIndex: number;
  lineWidth: number;
  timer: ReturnType<typeof setInterval> | null;
  latestProgress: ProgressPayload | null;
}

const progressRenderState: ProgressRenderState = {
  active: false,
  frameIndex: 0,
  lineWidth: 0,
  timer: null,
  latestProgress: null,
};

let groupDepth = 0;

let animatedLineQueue: Promise<void> = Promise.resolve();

/**
 * Waits for all queued line animations to finish before returning.
 */
export function drainAnimationQueue(): Promise<void> {
  return animatedLineQueue;
}

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
function formatProgressLine(progress: ProgressPayload): string {
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
 * Indicates whether typed CLI line animations are safe for this session.
 */
function isInteractiveLineAnimationEnabled(): boolean {
  return isInteractiveProgressEnabled();
}

/**
 * Queues asynchronous typed line animations to preserve output order.
 */
function enqueueAnimatedLine(render: () => Promise<void>): void {
  animatedLineQueue = animatedLineQueue.then(render).catch(() => undefined);
}

/**
 * Renders a prefixed line with a subtle typewriter effect.
 */
async function renderTypedLine(prefix: string, message: string): Promise<void> {
  process.stdout.write(`${prefix} `);
  await typeText(message, undefined, CLI_TYPING_DELAY_MS);
  process.stdout.write("\n");
}

/**
 * Renders a line instantly, then briefly pauses to create a cascade effect.
 */
async function renderCascadeLine(prefix: string, message: string): Promise<void> {
  console.log(`${prefix} ${message}`);
  await sleep(CLI_CASCADE_DELAY_MS);
}

/**
 * Determines whether an info line should be rendered with a reveal effect.
 */
function shouldAnimateInfoMessage(message: string): boolean {
  void message;
  return false;
}

/**
 * Determines whether a success line should be rendered with a reveal effect.
 */
function shouldAnimateSuccessMessage(message: string): boolean {
  return message.startsWith("All tasks completed")
    || message.startsWith("Initialized ");
}

/**
 * Determines whether a success line should be rendered with a cascade-style reveal.
 */
function shouldCascadeSuccessMessage(message: string): boolean {
  return message.startsWith("Created ");
}

/**
 * Returns the active group line prefix for nested task output.
 */
function groupLinePrefix(): string {
  if (groupDepth <= 0) {
    return "";
  }

  return isInteractiveProgressEnabled() ? "│  " : "    ";
}

/**
 * Prefixes a single-line message when rendering inside a task group.
 */
function withGroupPrefix(message: string): string {
  return `${groupLinePrefix()}${message}`;
}

/**
 * Prefixes each line of a multiline message when rendering inside a task group.
 */
function withGroupPrefixMultiline(message: string): string {
  const prefix = groupLinePrefix();
  if (prefix === "") {
    return message;
  }

  const normalized = message.replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }
  const prefixed = lines.map((line) => `${prefix}${line}`).join("\n");
  return hasTrailingNewline ? `${prefixed}\n` : prefixed;
}

/**
 * Applies lightweight styling to dry-run revert output while preserving message text.
 */
function styleInfoMessage(message: string): string {
  if (message.startsWith("Dry run - would revert ")) {
    return pc.yellow(message);
  }

  if (message.startsWith("- git revert ") || message.startsWith("- git reset ")) {
    return pc.yellow(message);
  }

  if (message.startsWith("- run=")) {
    return pc.dim(message);
  }

  return message;
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
    stopSpinnerTimer();
    progressRenderState.latestProgress = null;
    return;
  }

  process.stdout.write("\n");
  progressRenderState.active = false;
  progressRenderState.lineWidth = 0;
  progressRenderState.latestProgress = null;
  stopSpinnerTimer();
}

/**
 * Renders bounded progress payloads with a deterministic block-style progress bar.
 */
function renderBoundedProgress(progress: ProgressPayload): string {
  const width = 28;
  const current = Math.max(0, progress.current ?? 0);
  const total = Math.max(1, progress.total ?? 1);
  const ratio = Math.min(1, current / total);
  const filled = Math.round(ratio * width);
  const bar = `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
  const unit = progress.unit ? ` ${progress.unit}` : "";
  const detail = progress.detail ? ` - ${progress.detail}` : "";
  return `${progress.label} ${bar} ${current}/${total}${unit}${detail}`;
}

/**
 * Updates an in-place progress line when interactive rendering is enabled.
 */
function renderProgressFrame(progress: ProgressPayload): void {
  const hasCounters = typeof progress.current === "number" && typeof progress.total === "number";
  const frame = SPINNER_FRAMES[progressRenderState.frameIndex % SPINNER_FRAMES.length];

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
 * Starts the spinner timer when unbounded progress is active.
 */
function startSpinnerTimer(): void {
  if (progressRenderState.timer) {
    return;
  }

  progressRenderState.timer = setInterval(() => {
    progressRenderState.frameIndex = (progressRenderState.frameIndex + 1) % SPINNER_FRAMES.length;

    if (!progressRenderState.active || !progressRenderState.latestProgress) {
      return;
    }

    renderProgressFrame(progressRenderState.latestProgress);
  }, SPINNER_FRAME_INTERVAL_MS);
  progressRenderState.timer.unref?.();
}

/**
 * Stops and clears the spinner timer.
 */
function stopSpinnerTimer(): void {
  if (!progressRenderState.timer) {
    return;
  }

  clearInterval(progressRenderState.timer);
  progressRenderState.timer = null;
}

/**
 * Updates an in-place progress line when interactive rendering is enabled.
 */
function renderInteractiveProgress(progress: ProgressPayload): void {
  const hasCounters = typeof progress.current === "number" && typeof progress.total === "number";
  progressRenderState.latestProgress = progress;

  if (hasCounters) {
    stopSpinnerTimer();
  } else {
    startSpinnerTimer();
  }

  renderProgressFrame(progress);
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
      case "group-start": {
        flushProgressLine();
        const counter = event.counter ? `[${event.counter.current}/${event.counter.total}] ` : "";
        if (isInteractiveProgressEnabled()) {
          console.log(`┌ ${counter}${event.label}`);
        } else {
          console.log(`${counter}${event.label}`);
        }
        groupDepth = 1;
        return;
      }
      case "group-end": {
        flushProgressLine();
        const isSuccess = event.status === "success";
        const statusLabel = isSuccess ? `${pc.green("✔")} Done` : `${pc.red("✖")} Failed`;
        const suffix = event.message ? ` — ${event.message}` : "";

        if (isInteractiveProgressEnabled()) {
          console.log(`└ ${statusLabel}${suffix}`);
        } else {
          console.log(`${statusLabel}${suffix}`);
        }

        groupDepth = 0;
        return;
      }
      case "info":
        flushProgressLine();
        {
          const linePrefix = withGroupPrefix(pc.blue("ℹ"));
          if (isInteractiveLineAnimationEnabled() && shouldAnimateInfoMessage(event.message)) {
            enqueueAnimatedLine(() => renderTypedLine(linePrefix, styleInfoMessage(event.message)));
            return;
          }
          console.log(`${linePrefix} ${styleInfoMessage(event.message)}`);
        }
        return;
      case "warn":
        flushProgressLine();
        console.log(withGroupPrefix(`${pc.yellow("⚠")} ${event.message}`));
        return;
      case "error":
        flushProgressLine();
        console.error(withGroupPrefix(`${pc.red("✖")} ${event.message}`));
        return;
      case "success":
        flushProgressLine();
        {
          const linePrefix = withGroupPrefix(pc.green("✔"));
          if (isInteractiveLineAnimationEnabled() && shouldCascadeSuccessMessage(event.message)) {
            enqueueAnimatedLine(() => renderCascadeLine(linePrefix, event.message));
            return;
          }
          if (isInteractiveLineAnimationEnabled() && shouldAnimateSuccessMessage(event.message)) {
            enqueueAnimatedLine(() => renderTypedLine(linePrefix, event.message));
            return;
          }
          console.log(`${linePrefix} ${event.message}`);
        }
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
        console.log(withGroupPrefixMultiline(event.text));
        return;
      case "stderr":
        flushProgressLine();
        process.stderr.write(withGroupPrefixMultiline(event.text));
        return;
      default:
        return;
    }
  },
};
