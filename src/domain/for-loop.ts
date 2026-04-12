import type { SubItem } from "./parser.js";

const LOOP_HANDLER_SEGMENT_PATTERN = /(^|[;,]\s*)(?:for|each|foreach)\s*:/i;
const FOR_ITEM_PATTERN = /^for-item\s*:\s*(.*)$/i;
const FOR_CURRENT_PATTERN = /^for-current\s*:\s*(.*)$/i;

export function isForLoopTaskText(taskText: string): boolean {
  return LOOP_HANDLER_SEGMENT_PATTERN.test(taskText.trim());
}

export function parseForItemValue(text: string): string | undefined {
  const match = text.match(FOR_ITEM_PATTERN);
  if (!match) {
    return undefined;
  }

  return (match[1] ?? "").trim();
}

export function parseForCurrentValue(text: string): string | undefined {
  const match = text.match(FOR_CURRENT_PATTERN);
  if (!match) {
    return undefined;
  }

  return (match[1] ?? "").trim();
}

export function getForItemValues(subItems: readonly SubItem[]): string[] {
  const values: string[] = [];
  for (const subItem of subItems) {
    const value = parseForItemValue(subItem.text);
    if (value === undefined) {
      continue;
    }
    values.push(value);
  }
  return values;
}

export function getForCurrentValue(subItems: readonly SubItem[]): string | undefined {
  for (const subItem of subItems) {
    const value = parseForCurrentValue(subItem.text);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}
