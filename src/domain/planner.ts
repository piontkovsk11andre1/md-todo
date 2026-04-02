import type { Task } from "./parser.js";

/** Re-export the task shape used by planner insertion helpers. */
export type { Task } from "./parser.js";

/** Canonical unchecked TODO line emitted by planner output parsing. */
export type PlannerSubitemLine = string;

/** Options that control how planner TODO lines are inserted. */
export interface InsertTodoOptions {
  /** Indicates whether the source already contains TODO lines. */
  hasExistingTodos: boolean;
}

/** Result of applying planner output to source Markdown content. */
export interface InsertTodoResult {
  /** Updated Markdown source after insertion succeeds or is skipped. */
  updatedSource: string;
  /** Number of newly inserted TODO lines. */
  insertedCount: number;
  /** Signals that insertion was rejected by additive/syntax guardrails. */
  rejected: boolean;
  /** Optional reason describing why planner output was rejected. */
  rejectionReason?: string;
}

/** Options for normalizing planner additions against existing TODO items. */
export interface NormalizePlannerTodoAdditionsOptions {
  /** Existing TODO lines used to suppress duplicate planner suggestions. */
  existingTodoLines?: Iterable<string>;
}

/**
 * Extracts unchecked Markdown TODO lines from planner stdout.
 *
 * @param output Raw planner output text.
 * @returns Normalized list-item lines that use unchecked checkbox syntax.
 */
export function parsePlannerOutput(output: string): PlannerSubitemLine[] {
  const lines = output.split(/\r?\n/);
  const taskPattern = /^\s*[-*+]\s+\[ \]\s+\S/;

  return lines
    .filter((line) => taskPattern.test(line))
    .map((line) => line.replace(/^\s+/, ""));
}

/**
 * Inserts additive planner TODO lines into a Markdown source document.
 *
 * The insertion path enforces additive-only behavior, validates stdout
 * contract compliance, deduplicates against existing TODOs, and appends
 * additions at the end of the document.
 *
 * @param source Original Markdown source.
 * @param plannerOutput Raw output returned by the planner phase.
 * @param options Controls whether source already has TODO content.
 * @returns Insertion result including updated source and rejection metadata.
 */
export function insertPlannerTodos(
  source: string,
  plannerOutput: string,
  options: InsertTodoOptions,
): InsertTodoResult {
  // Reject outputs that attempt non-additive edits to existing TODO lines.
  const rejectionReason = detectNonAdditivePlannerOutput(source, plannerOutput);
  if (rejectionReason) {
    return {
      updatedSource: source,
      insertedCount: 0,
      rejected: true,
      rejectionReason,
    };
  }

  // Enforce planner stdout contract: only unchecked TODO list lines.
  const stdoutContractReason = validatePlannerStdoutContract(plannerOutput);
  if (stdoutContractReason) {
    return {
      updatedSource: source,
      insertedCount: 0,
      rejected: true,
      rejectionReason: stdoutContractReason,
    };
  }

  // Normalize and remove duplicates against document and planner output.
  const additions = normalizePlannerTodoAdditions(plannerOutput, {
    existingTodoLines: parsePlannerOutput(source),
  });
  if (additions.length === 0) {
    return { updatedSource: source, insertedCount: 0, rejected: false };
  }

  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  if (options.hasExistingTodos) {
    return {
      updatedSource: appendPlannerTodosToExistingList(source, additions, eol),
      insertedCount: additions.length,
      rejected: false,
    };
  }

  const updatedSource = appendPlannerTodosAtEnd(source, additions, eol);
  return { updatedSource, insertedCount: additions.length, rejected: false };
}

/**
 * Normalizes planner output into deduplicated unchecked TODO list lines.
 *
 * @param plannerOutput Raw planner output text.
 * @param options Optional existing TODO lines used for identity checks.
 * @returns Stable list of TODO additions ready for insertion.
 */
export function normalizePlannerTodoAdditions(
  plannerOutput: string,
  options: NormalizePlannerTodoAdditionsOptions = {},
): string[] {
  const parsed = parsePlannerOutput(plannerOutput);
  if (parsed.length === 0) {
    return [];
  }

  const existing = new Set<string>();
  for (const existingLine of options.existingTodoLines ?? []) {
    const existingIdentity = normalizeTodoIdentity(existingLine);
    if (existingIdentity.length > 0) {
      existing.add(existingIdentity);
    }
  }

  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const line of parsed) {
    const normalized = normalizeTodoLine(line);
    const identity = normalizeTodoIdentity(normalized);
    if (identity.length === 0 || seen.has(identity) || existing.has(identity)) {
      continue;
    }

    seen.add(identity);
    deduped.push(normalized);
  }

  return deduped;
}

/** Normalizes list markers/checkboxes to canonical `- [ ]` TODO syntax. */
function normalizeTodoLine(line: string): string {
  return line.replace(/^\s*[-*+]\s+\[ \]\s+/, "- [ ] ").trim();
}

/** Builds a whitespace-insensitive identity key for TODO deduplication. */
function normalizeTodoIdentity(line: string): string {
  const normalizedLine = normalizeTodoLine(line);
  if (normalizedLine.length === 0) {
    return "";
  }

  const content = normalizedLine.replace(/^- \[ \]\s+/, "").replace(/\s+/g, " ").trim();
  if (content.length === 0) {
    return "";
  }

  return `- [ ] ${content}`;
}

/** Converts checked/unchecked checkbox lines into canonical unchecked form. */
function normalizeTodoCheckboxLine(line: string): string {
  return line.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "- [ ] ").trim();
}

/**
 * Validates planner stdout against the TODO-only output contract.
 *
 * @param plannerOutput Raw planner output text.
 * @returns Rejection reason when invalid; otherwise `null`.
 */
function validatePlannerStdoutContract(plannerOutput: string): string | null {
  if (plannerOutput.trim().length === 0) {
    return null;
  }

  const lines = plannerOutput.split(/\r?\n/);
  const uncheckedTodoPattern = /^\s*[-*+]\s+\[ \]\s+\S/;

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    if (!uncheckedTodoPattern.test(line)) {
      return "Planner output violated stdout contract. Return only unchecked TODO lines using `- [ ]` syntax.";
    }
  }

  return null;
}

interface ParsedTodoCheckboxLine {
  normalized: string;
  checked: boolean;
}

/**
 * Detects non-additive planner behavior against existing TODO items.
 *
 * Disallows completion-state changes, partial echoing that implies removals,
 * and reordering of existing TODO lines.
 */
function detectNonAdditivePlannerOutput(source: string, plannerOutput: string): string | null {
  const existingTodos = parsePlannerOutput(source).map(normalizeTodoLine);
  if (existingTodos.length === 0) {
    return null;
  }

  const existingSet = new Set(existingTodos);
  const checkboxLines = parseTodoCheckboxLines(plannerOutput);

  for (const line of checkboxLines) {
    if (!line.checked) {
      continue;
    }

    if (existingSet.has(line.normalized)) {
      return "Planner output attempted to change the completion state of existing TODO items. Only additive TODO operations are allowed.";
    }
  }

  const echoedExistingInOutput = checkboxLines
    .filter((line) => !line.checked && existingSet.has(line.normalized))
    .map((line) => line.normalized);

  if (
    echoedExistingInOutput.length > 0
    && !includesAllExistingTodos(existingTodos, echoedExistingInOutput)
  ) {
    return "Planner output attempted to remove existing TODO items. Only additive TODO operations are allowed.";
  }

  if (!isInDocumentOrder(existingTodos, echoedExistingInOutput)) {
    return "Planner output attempted to reorder existing TODO items. Only additive TODO operations are allowed.";
  }

  return null;
}

/** Verifies that planner output echoed every existing TODO item. */
function includesAllExistingTodos(existingInDocumentOrder: string[], echoedExistingInOutput: string[]): boolean {
  const echoedSet = new Set(echoedExistingInOutput);

  for (const existing of existingInDocumentOrder) {
    if (!echoedSet.has(existing)) {
      return false;
    }
  }

  return true;
}

/** Parses checkbox list lines and records normalized content plus checked state. */
function parseTodoCheckboxLines(source: string): ParsedTodoCheckboxLine[] {
  const lines = source.split(/\r?\n/);
  const checkboxPattern = /^\s*[-*+]\s+\[([ xX])\]\s+\S/;
  const parsed: ParsedTodoCheckboxLine[] = [];

  for (const line of lines) {
    const match = line.match(checkboxPattern);
    if (!match) {
      continue;
    }

    parsed.push({
      normalized: normalizeTodoCheckboxLine(line),
      checked: /[xX]/.test(match[1]),
    });
  }

  return parsed;
}

/** Confirms planner-echoed existing TODO lines preserve original document order. */
function isInDocumentOrder(existingInDocumentOrder: string[], echoedExistingInOutput: string[]): boolean {
  if (echoedExistingInOutput.length <= 1) {
    return true;
  }

  let fromIndex = 0;
  for (const echoed of echoedExistingInOutput) {
    const position = existingInDocumentOrder.indexOf(echoed, fromIndex);
    if (position === -1) {
      return false;
    }
    fromIndex = position + 1;
  }

  return true;
}

/**
 * Appends TODO lines to the end of a document with stable separation.
 *
 * @param source Original Markdown source.
 * @param additions Normalized TODO lines to append.
 * @param eol End-of-line sequence detected from source.
 * @returns Updated source with TODO block appended and trailing newline.
 */
function appendPlannerTodosAtEnd(source: string, additions: string[], eol: string): string {
  const sourceWithoutTrailingNewlines = source.replace(/(?:\r?\n)+$/g, "");
  const separator = sourceWithoutTrailingNewlines.length === 0 ? "" : `${eol}${eol}`;
  return sourceWithoutTrailingNewlines + separator + additions.join(eol) + eol;
}

/**
 * Appends TODO lines immediately after the last existing TODO checkbox line.
 *
 * Falls back to end-of-document insertion if no TODO checkbox can be located.
 */
function appendPlannerTodosToExistingList(source: string, additions: string[], eol: string): string {
  const lines = source.split(/\r?\n/);
  const checkboxPattern = /^\s*[-*+]\s+\[[ xX]\]\s+\S/;
  let lastTodoIndex = -1;

  for (const [index, line] of lines.entries()) {
    if (checkboxPattern.test(line)) {
      lastTodoIndex = index;
    }
  }

  if (lastTodoIndex === -1) {
    return appendPlannerTodosAtEnd(source, additions, eol);
  }

  lines.splice(lastTodoIndex + 1, 0, ...additions);
  const updatedSource = lines.join(eol);
  return updatedSource.endsWith(eol) ? updatedSource : `${updatedSource}${eol}`;
}

/**
 * Computes two-space child indentation from a parent list-item line.
 *
 * @param parentLine Parent task line from source Markdown.
 * @returns Child indentation prefix that preserves leading whitespace.
 */
export function computeChildIndent(parentLine: string): string {
  const leadingWhitespace = parentLine.match(/^(\s*)/)?.[1] ?? "";
  const indentUnit = "  ";
  return leadingWhitespace + indentUnit;
}

/**
 * Inserts planner-generated sub-items directly beneath a selected task.
 *
 * @param source Original Markdown source.
 * @param task Task that will receive inserted sub-items.
 * @param subitemLines Planner-generated sub-item list lines.
 * @returns Updated source with correctly indented child list items.
 */
export function insertSubitems(
  source: string,
  task: Task,
  subitemLines: PlannerSubitemLine[],
): string {
  if (subitemLines.length === 0) return source;

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const parentLineIndex = task.line - 1;

  if (parentLineIndex < 0 || parentLineIndex >= lines.length) {
    throw new Error(`Task line ${task.line} is out of range.`);
  }

  const parentLine = lines[parentLineIndex]!;
  const indent = computeChildIndent(parentLine);

  const indented = subitemLines.map((item) => {
    const text = item.replace(/^[-*+]\s+/, "");
    return `${indent}- ${text}`;
  });

  lines.splice(parentLineIndex + 1, 0, ...indented);

  return lines.join(eol);
}
