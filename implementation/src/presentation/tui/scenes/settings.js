import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { createConfigBridge } from "../bridges/config-bridge.js";
import { launchEditor } from "../components/editor-launch.js";

const SUPPORTED_SCOPES = ["effective", "local", "global"];

function getNextScope(scope) {
  const currentIndex = SUPPORTED_SCOPES.indexOf(scope);
  if (currentIndex < 0) {
    return SUPPORTED_SCOPES[0];
  }
  return SUPPORTED_SCOPES[(currentIndex + 1) % SUPPORTED_SCOPES.length];
}

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
const EMPTY_JSON_WITH_NEWLINE = "{}\n";

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

export async function runSettingsSceneAction({
  action,
  state,
  currentWorkingDirectory = process.cwd(),
  suspendTui,
  resumeTui,
} = {}) {
  const sceneState = state ?? createSettingsSceneState();
  if (!action || typeof action !== "object") {
    return sceneState;
  }

  if (action.type === "reload") {
    return reloadSettingsSceneState({
      state: {
        ...sceneState,
        loading: true,
      },
      currentWorkingDirectory,
    });
  }

  if (action.type === "edit") {
    const scope = isSupportedScope(sceneState.scope) ? sceneState.scope : "effective";
    if (scope === "effective") {
      return {
        ...sceneState,
        pendingGlobalCreate: false,
        hint: "effective is a merged read-only view; switch to local or global to edit.",
      };
    }

    const bridge = createConfigBridge({ cwd: currentWorkingDirectory });
    let filePath;
    try {
      filePath = scope === "local"
        ? await bridge.resolveConfigPath("local")
        : await bridge.resolveGlobalConfigPath();
    } catch (error) {
      return {
        ...sceneState,
        pendingGlobalCreate: false,
        banner: `Unable to resolve ${scope} config path: ${toErrorMessage(error)}`,
      };
    }

    if (typeof filePath !== "string" || filePath.length === 0 || filePath === bridge.unresolvedPathMarker) {
      return {
        ...sceneState,
        pendingGlobalCreate: false,
        banner: `${scope} config path is unresolved.`,
      };
    }

    if (scope === "global" && !fs.existsSync(filePath)) {
      if (!sceneState.pendingGlobalCreate) {
        return {
          ...sceneState,
          pendingGlobalCreate: true,
          hint: `Global config missing at ${filePath}. Press [e] again to create {} and edit.`,
        };
      }
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, EMPTY_JSON_WITH_NEWLINE, "utf8");
      } catch (error) {
        return {
          ...sceneState,
          pendingGlobalCreate: false,
          banner: `Failed to bootstrap global config at ${filePath}: ${toErrorMessage(error)}`,
        };
      }
    }

    let launchResult;
    suspendTui?.();
    try {
      launchResult = launchEditor(filePath, { cwd: currentWorkingDirectory });
    } catch (error) {
      launchResult = {
        ok: false,
        message: `Failed to launch editor for ${filePath}: ${toErrorMessage(error)}`,
      };
    } finally {
      resumeTui?.();
    }

    if (!launchResult.ok) {
      return {
        ...sceneState,
        pendingGlobalCreate: false,
        banner: launchResult.message || "Failed to open editor.",
      };
    }

    return reloadSettingsSceneState({
      state: {
        ...sceneState,
        pendingGlobalCreate: false,
        hint: "",
      },
      currentWorkingDirectory,
      keepBanner: false,
    });
  }

  return sceneState;
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

  const input = typeof rawInput === "string" ? rawInput : "";
  const normalized = input.toLowerCase();
  if (normalized === "s") {
    const nextScope = getNextScope(sceneState.scope);
    return {
      handled: true,
      state: {
        ...sceneState,
        scope: nextScope,
        loading: true,
        selectedIndex: 0,
        banner: "",
        hint: "",
        pendingGlobalCreate: false,
      },
      backToParent: false,
      action: { type: "reload" },
    };
  }

  if (normalized === "e") {
    return {
      handled: true,
      state: {
        ...sceneState,
        banner: "",
      },
      backToParent: false,
      action: { type: "edit" },
    };
  }

  return {
    handled: false,
    state: sceneState,
    backToParent: false,
  };
}
