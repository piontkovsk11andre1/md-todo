import pc from "picocolors";

export const OPERATION_BADGE_COLOR = {
  scan: pc.cyan,
  execute: pc.yellow,
  verify: pc.blue,
  repair: pc.red,
  resolve: pc.magenta,
  resolverepair: pc.magenta,
  plan: pc.cyan,
  research: pc.cyan,
  discuss: pc.yellow,
  finalize: pc.green,
  summarize: pc.blue,
  agent: pc.yellow,
};

const BADGE_OPERATION_KEYS = new Set(Object.keys(OPERATION_BADGE_COLOR));

export function normalizeOperationKey(label) {
  if (typeof label !== "string" || label.trim().length === 0) {
    return "";
  }
  const firstToken = label.toLowerCase().split(/\s+/)[0] || "";
  return firstToken.replace(/[^a-z]/g, "");
}

export function isBadgeOperationKey(operation) {
  return BADGE_OPERATION_KEYS.has(operation);
}

export function paintOperationBadge(operation, text) {
  const key = normalizeOperationKey(operation);
  const painter = OPERATION_BADGE_COLOR[key] ?? ((value) => value);
  return painter(String(text));
}
