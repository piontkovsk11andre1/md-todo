import type { Task } from "./parser.js";

export type { Task } from "./parser.js";

export type PlannerSubitemLine = string;

interface HeadingLine {
  lineIndex: number;
  level: number;
  text: string;
}

export interface InsertTodoOptions {
  hasExistingTodos: boolean;
}

export interface InsertTodoResult {
  updatedSource: string;
  insertedCount: number;
  rejected: boolean;
  rejectionReason?: string;
}

export interface NormalizePlannerTodoAdditionsOptions {
  existingTodoLines?: Iterable<string>;
}

export function parsePlannerOutput(output: string): PlannerSubitemLine[] {
  const lines = output.split(/\r?\n/);
  const taskPattern = /^\s*[-*+]\s+\[ \]\s+\S/;

  return lines
    .filter((line) => taskPattern.test(line))
    .map((line) => line.replace(/^\s+/, ""));
}

export function insertPlannerTodos(
  source: string,
  plannerOutput: string,
  options: InsertTodoOptions,
): InsertTodoResult {
  const rejectionReason = detectNonAdditivePlannerOutput(source, plannerOutput);
  if (rejectionReason) {
    return {
      updatedSource: source,
      insertedCount: 0,
      rejected: true,
      rejectionReason,
    };
  }

  const stdoutContractReason = validatePlannerStdoutContract(plannerOutput);
  if (stdoutContractReason) {
    return {
      updatedSource: source,
      insertedCount: 0,
      rejected: true,
      rejectionReason: stdoutContractReason,
    };
  }

  const additions = normalizePlannerTodoAdditions(plannerOutput, {
    existingTodoLines: parsePlannerOutput(source),
  });
  if (additions.length === 0) {
    return { updatedSource: source, insertedCount: 0, rejected: false };
  }

  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  if (options.hasExistingTodos) {
    const prefix = source.length === 0 || source.endsWith("\n") || source.endsWith("\r") ? "" : eol;
    return {
      updatedSource: source + prefix + additions.join(eol) + eol,
      insertedCount: additions.length,
      rejected: false,
    };
  }

  const insertion = chooseTodoInsertionPoint(source, additions);
  const updatedSource = insertLinesAt(source, additions, insertion, eol);
  return { updatedSource, insertedCount: additions.length, rejected: false };
}

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

function normalizeTodoLine(line: string): string {
  return line.replace(/^\s*[-*+]\s+\[ \]\s+/, "- [ ] ").trim();
}

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

function normalizeTodoCheckboxLine(line: string): string {
  return line.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "- [ ] ").trim();
}

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

function includesAllExistingTodos(existingInDocumentOrder: string[], echoedExistingInOutput: string[]): boolean {
  const echoedSet = new Set(echoedExistingInOutput);

  for (const existing of existingInDocumentOrder) {
    if (!echoedSet.has(existing)) {
      return false;
    }
  }

  return true;
}

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

const SEMANTIC_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "todo",
  "task",
  "tasks",
  "item",
  "items",
  "step",
  "steps",
  "plan",
]);

interface HeadingScore {
  heading: HeadingLine;
  semanticScore: number;
  proximityScore: number;
  totalScore: number;
}

function chooseTodoInsertionPoint(source: string, additions: string[]): number {
  const lines = source.split(/\r?\n/);
  const headings = findHeadingLines(lines);
  if (headings.length === 0) {
    return lines.length;
  }

  const fallbackHeading = findExplicitFallbackHeading(headings);
  const fallbackHeadingIndex = fallbackHeading
    ? headings.findIndex((heading) => heading.lineIndex === fallbackHeading.lineIndex)
    : -1;

  const scored = scoreHeadingCandidates(headings, additions, fallbackHeadingIndex);
  const best = scored[0];

  if (best && best.totalScore > 0) {
    return findSectionEndLine(lines, best.heading, headings);
  }

  if (fallbackHeading) {
    return findSectionEndLine(lines, fallbackHeading, headings);
  }

  return lines.length;
}

function scoreHeadingCandidates(
  headings: HeadingLine[],
  additions: string[],
  fallbackHeadingIndex: number,
): HeadingScore[] {
  return headings
    .map((heading, headingIndex) => {
      const semanticScore = scoreHeadingSemantics(heading.text, additions);
      const proximityScore = scoreHeadingProximity(headingIndex, fallbackHeadingIndex, headings.length);

      return {
        heading,
        semanticScore,
        proximityScore,
        totalScore: semanticScore * 100 + proximityScore,
      };
    })
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      if (b.semanticScore !== a.semanticScore) {
        return b.semanticScore - a.semanticScore;
      }
      if (b.proximityScore !== a.proximityScore) {
        return b.proximityScore - a.proximityScore;
      }
      return a.heading.lineIndex - b.heading.lineIndex;
    });
}

function findExplicitFallbackHeading(headings: HeadingLine[]): HeadingLine | null {
  const scored = headings
    .map((heading) => ({ heading, score: scoreFallbackHeading(heading.text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.heading.lineIndex - b.heading.lineIndex;
    });

  return scored[0]?.heading ?? null;
}

function scoreFallbackHeading(text: string): number {
  const fallbackKeywords: Array<{ pattern: RegExp; score: number }> = [
    { pattern: /\btodo\b/, score: 100 },
    { pattern: /\bchecklist\b/, score: 95 },
    { pattern: /\bnext steps?\b/, score: 90 },
    { pattern: /\baction items?\b/, score: 85 },
    { pattern: /\btask(s)?\b/, score: 80 },
  ];

  let score = 0;
  for (const keyword of fallbackKeywords) {
    if (keyword.pattern.test(text)) {
      score += keyword.score;
    }
  }

  return score;
}

function scoreHeadingSemantics(text: string, additions: string[]): number {
  const headingKeywordScore = scoreHeadingRelevance(text);
  const semanticOverlapScore = scoreSemanticOverlap(text, additions);
  return headingKeywordScore + semanticOverlapScore;
}

function scoreHeadingProximity(
  headingIndex: number,
  fallbackHeadingIndex: number,
  headingCount: number,
): number {
  if (fallbackHeadingIndex < 0 || headingCount <= 1) {
    return 0;
  }

  const maxDistance = headingCount - 1;
  const distance = Math.abs(headingIndex - fallbackHeadingIndex);
  return Math.max(0, maxDistance - distance);
}

function scoreSemanticOverlap(text: string, additions: string[]): number {
  const headingTokens = tokenizeForSemanticMatching(text);
  if (headingTokens.size === 0) {
    return 0;
  }

  const additionTokens = new Set<string>();
  for (const addition of additions) {
    for (const token of tokenizeForSemanticMatching(addition)) {
      additionTokens.add(token);
    }
  }

  if (additionTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of headingTokens) {
    if (additionTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap * 3;
}

function tokenizeForSemanticMatching(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const tokens = new Set<string>();

  for (const token of matches) {
    if (token.length < 3 || SEMANTIC_STOP_WORDS.has(token)) {
      continue;
    }
    tokens.add(token);
  }

  return tokens;
}

function findHeadingLines(lines: string[]): HeadingLine[] {
  const headings: HeadingLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }

    headings.push({
      lineIndex: index,
      level: match[1].length,
      text: match[2].trim().toLowerCase(),
    });
  }

  return headings;
}

function scoreHeadingRelevance(text: string): number {
  const keywords: Array<{ pattern: RegExp; score: number }> = [
    { pattern: /\btodo\b/, score: 10 },
    { pattern: /\bchecklist\b/, score: 9 },
    { pattern: /\btask(s)?\b/, score: 8 },
    { pattern: /\bnext steps?\b/, score: 7 },
    { pattern: /\baction items?\b/, score: 7 },
    { pattern: /\bplan\b/, score: 6 },
    { pattern: /\bimplementation\b/, score: 5 },
    { pattern: /\broadmap\b/, score: 4 },
  ];

  let score = 0;
  for (const keyword of keywords) {
    if (keyword.pattern.test(text)) {
      score += keyword.score;
    }
  }

  return score;
}

function findSectionEndLine(lines: string[], target: HeadingLine, headings: HeadingLine[]): number {
  for (const heading of headings) {
    if (heading.lineIndex <= target.lineIndex) {
      continue;
    }
    if (heading.level <= target.level) {
      return heading.lineIndex;
    }
  }

  return lines.length;
}

function insertLinesAt(source: string, additions: string[], insertionLine: number, eol: string): string {
  const lines = source.split(/\r?\n/);
  let insertionIndex = Math.max(0, Math.min(insertionLine, lines.length));

  while (insertionIndex > 0 && (lines[insertionIndex - 1] ?? "").trim().length === 0) {
    if (insertionIndex === lines.length) {
      break;
    }
    lines.splice(insertionIndex - 1, 1);
    insertionIndex -= 1;
  }

  const insertionBlock = ["", ...additions];
  lines.splice(insertionIndex, 0, ...insertionBlock);

  const updated = lines.join(eol);
  return updated.endsWith(eol) ? updated : updated + eol;
}

export function computeChildIndent(parentLine: string): string {
  const leadingWhitespace = parentLine.match(/^(\s*)/)?.[1] ?? "";
  const indentUnit = "  ";
  return leadingWhitespace + indentUnit;
}

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
