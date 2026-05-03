import pc from "picocolors";
import { createConfigBridge } from "../bridges/config-bridge.js";

const SUPPORTED_SCOPES = ["effective", "local", "global"];

function isSupportedScope(value) {
  return typeof value === "string" && SUPPORTED_SCOPES.includes(value);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function withSectionGap(lines, sectionGap) {
  const gap = Number.isInteger(sectionGap) && sectionGap > 0 ? sectionGap : 0;
  for (let index = 0; index < gap; index += 1) {
    lines.push("");
  }
}

function toErrorMessage(error, fallback = "Unexpected error.") {
  if (error instanceof Error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flattenConfigEntries(config, prefix = "") {
  const entries = [];
  const source = safeObject(config);
  const keys = Object.keys(source);
  for (const key of keys) {
    const value = source[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      const nested = flattenConfigEntries(value, fullKey);
      if (nested.length === 0) {
        entries.push({ key: fullKey, value });
      } else {
        entries.push(...nested);
      }
      continue;
    }
    entries.push({ key: fullKey, value });
  }
  return entries;
}

function formatValueOneLine(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : String(value);
  } catch {
    return String(value);
  }
}

const ARRAY_PREVIEW_LIMIT = 3;
const MIN_VALUE_WIDTH = 12;
const DEFAULT_VIEWPORT_COLUMNS = 80;

function truncateInline(text, maxLength) {
  const value = String(text);
  if (maxLength <= 0) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength === 1) {
    return "…";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatArrayPreview(value, maxLength) {
  if (!Array.isArray(value)) {
    return null;
  }
  const head = value.slice(0, ARRAY_PREVIEW_LIMIT).map((item) => formatValueOneLine(item));
  const suffix = value.length > ARRAY_PREVIEW_LIMIT ? ", …" : "";
  const candidate = `[${head.join(", ")}${suffix}]`;
  if (candidate.length <= maxLength) {
    return candidate;
  }
  return null;
}

function formatRowValue(value, maxLength) {
  const safeMax = Math.max(1, Math.floor(maxLength));
  const oneLine = formatValueOneLine(value);
  if (oneLine.length <= safeMax) {
    return oneLine;
  }
  if (Array.isArray(value)) {
    const preview = formatArrayPreview(value, safeMax);
    if (preview !== null) {
      return preview;
    }
  }
  return truncateInline(oneLine, safeMax);
}

function resolveValueColumnWidth(viewportColumns, keyColumnWidth, provenanceReserve) {
  const cols = Number.isFinite(viewportColumns) && viewportColumns > 0
    ? viewportColumns
    : DEFAULT_VIEWPORT_COLUMNS;
  // Layout: "  " (2) + key (keyColumnWidth) + "  " (2) + value + "  " + marker
  const available = cols - 2 - keyColumnWidth - 2 - provenanceReserve;
  return Math.max(MIN_VALUE_WIDTH, available);
}

export function createSettingsSceneState() {
  return {
    scope: "effective",
    entries: [],
    sources: undefined,
    selectedIndex: 0,
    banner: "",
    hint: "",
    pager: null,
    pendingGlobalCreate: false,
    loading: false,
    lastError: "",
  };
}

export async function reloadSettingsSceneState({
  state,
  currentWorkingDirectory = process.cwd(),
  keepBanner = false,
} = {}) {
  const previous = state ?? createSettingsSceneState();
  const scope = isSupportedScope(previous.scope) ? previous.scope : "effective";
  const sceneState = {
    ...previous,
    scope,
    loading: true,
  };
  if (!keepBanner) {
    sceneState.banner = "";
  }

  try {
    const bridge = createConfigBridge({ cwd: currentWorkingDirectory });
    const config = await bridge.listConfig(scope);
    const entries = flattenConfigEntries(config);
    return {
      ...sceneState,
      entries,
      sources: undefined,
      selectedIndex: Math.min(sceneState.selectedIndex ?? 0, Math.max(0, entries.length - 1)),
      loading: false,
      lastError: "",
    };
  } catch (error) {
    const message = `Failed to load ${scope} config: ${toErrorMessage(error)}`;
    return {
      ...sceneState,
      entries: [],
      sources: undefined,
      selectedIndex: 0,
      loading: false,
      lastError: message,
      banner: message,
    };
  }
}

function buildHeaderLine(scope) {
  const scopeLabel = isSupportedScope(scope) ? scope : "effective";
  const provenanceSuffix = scopeLabel === "effective" ? " ─ provenance shown" : "";
  return pc.bold(`Settings ─ scope: ${scopeLabel}${provenanceSuffix}`);
}

function formatProvenanceMarker(source) {
  if (typeof source !== "string" || source.length === 0) {
    return "";
  }
  return pc.dim(`◀ ${source}`);
}

export function renderSettingsSceneLines({ state, sectionGap = 1, viewportColumns } = {}) {
  const sceneState = state ?? createSettingsSceneState();
  const scope = isSupportedScope(sceneState.scope) ? sceneState.scope : "effective";
  const lines = [buildHeaderLine(scope)];

  if (sceneState.loading) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.dim(`Loading ${scope} configuration...`));
    lines.push(pc.dim("[Esc] Back to menu"));
    return lines;
  }

  if (typeof sceneState.banner === "string" && sceneState.banner.length > 0) {
    withSectionGap(lines, sectionGap);
    const bannerLines = sceneState.banner.split(/\r?\n/);
    for (let index = 0; index < bannerLines.length; index += 1) {
      const prefix = index === 0 ? "! " : "  ";
      lines.push(pc.red(`${prefix}${bannerLines[index]}`));
    }
  }

  if (typeof sceneState.hint === "string" && sceneState.hint.length > 0) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.yellow(sceneState.hint));
  }

  withSectionGap(lines, sectionGap);

  const entries = Array.isArray(sceneState.entries) ? sceneState.entries : [];
  const showProvenance = scope === "effective";
  const sources = safeObject(sceneState.sources);

  if (entries.length === 0) {
    lines.push(pc.dim(`  No configuration values to show for scope "${scope}".`));
  } else {
    const longestKey = entries.reduce((max, entry) => {
      const length = typeof entry?.key === "string" ? entry.key.length : 0;
      return length > max ? length : max;
    }, 0);
    const keyColumnWidth = Math.min(Math.max(longestKey, 12), 36);
    // Reserve approximate width for the provenance marker ("◀ built-in" ≈ 11 chars + leading "  ").
    const provenanceReserve = showProvenance ? 14 : 0;
    const valueColumnWidth = resolveValueColumnWidth(viewportColumns, keyColumnWidth, provenanceReserve);
    for (const entry of entries) {
      const keyText = typeof entry?.key === "string" ? entry.key : "";
      const valueText = formatRowValue(entry?.value, valueColumnWidth);
      const paddedKey = keyText.padEnd(keyColumnWidth, " ");
      let row = `  ${paddedKey}  ${valueText}`;
      if (showProvenance) {
        const marker = formatProvenanceMarker(sources[keyText]);
        if (marker) {
          row = `${row}  ${marker}`;
        }
      }
      lines.push(row);
    }
  }

  withSectionGap(lines, sectionGap);
  lines.push(pc.dim("[s] scope ▸ effective | local | global"));
  lines.push(pc.dim("[e] edit current scope file in $EDITOR   [o] reveal config file path"));
  lines.push(pc.dim("[↵] inspect value (full text + raw JSON)"));
  lines.push(pc.dim("[Esc] Back to menu"));
  return lines;
}

export function handleSettingsInput({ rawInput, state } = {}) {
  const sceneState = state ?? createSettingsSceneState();
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: sceneState,
      backToParent: true,
    };
  }
  return {
    handled: false,
    state: sceneState,
    backToParent: false,
  };
}
