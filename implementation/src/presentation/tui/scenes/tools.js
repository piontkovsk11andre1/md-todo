import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";

const TOOLS_DIRECTORY_NAME = "tools";
const CONFIG_FILE_NAME = "config.json";
const TOOL_TEMPLATE_EXTENSION = ".md";
const TOOL_JS_EXTENSION = ".js";

function readConfigJson(configDirPath) {
  if (typeof configDirPath !== "string" || configDirPath.length === 0) {
    return undefined;
  }
  const configPath = path.join(configDirPath, CONFIG_FILE_NAME);
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Resolves the ordered list of tool directories for the given config directory.
 *
 * Each entry from `toolDirs` is resolved relative to `<config-dir>` unless it is
 * an absolute path. Entries that are not non-empty strings are skipped. Order is
 * preserved as given in the configuration. When `toolDirs` is missing or empty,
 * the default `<config-dir>/tools` directory is returned.
 */
export function resolveToolDirectories(configDirPath, configValue) {
  if (typeof configDirPath !== "string" || configDirPath.length === 0) {
    return [];
  }

  const config = configValue && typeof configValue === "object" && !Array.isArray(configValue)
    ? configValue
    : readConfigJson(configDirPath);

  const candidates = config && Array.isArray(config.toolDirs) ? config.toolDirs : undefined;
  const resolved = [];

  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (typeof candidate !== "string") {
        continue;
      }
      const trimmed = candidate.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const resolvedDir = path.isAbsolute(trimmed)
        ? trimmed
        : path.resolve(configDirPath, trimmed);
      resolved.push(resolvedDir);
    }
  }

  if (resolved.length === 0) {
    resolved.push(path.join(configDirPath, TOOLS_DIRECTORY_NAME));
  }

  return resolved;
}

function listToolFiles(directoryPath) {
  let entries;
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const lowerName = entry.name.toLowerCase();
    if (lowerName.endsWith(TOOL_JS_EXTENSION)) {
      const baseName = entry.name.slice(0, -TOOL_JS_EXTENSION.length);
      const trimmedName = baseName.trim();
      if (trimmedName.length === 0) {
        continue;
      }
      files.push({
        name: trimmedName.toLowerCase(),
        extension: TOOL_JS_EXTENSION,
        fileName: entry.name,
        filePath: path.join(directoryPath, entry.name),
        directory: directoryPath,
      });
      continue;
    }
    if (lowerName.endsWith(TOOL_TEMPLATE_EXTENSION)) {
      const baseName = entry.name.slice(0, -TOOL_TEMPLATE_EXTENSION.length);
      const trimmedName = baseName.trim();
      if (trimmedName.length === 0) {
        continue;
      }
      files.push({
        name: trimmedName.toLowerCase(),
        extension: TOOL_TEMPLATE_EXTENSION,
        fileName: entry.name,
        filePath: path.join(directoryPath, entry.name),
        directory: directoryPath,
      });
    }
  }

  files.sort((left, right) => {
    if (left.name === right.name) {
      return left.fileName.localeCompare(right.fileName);
    }
    return left.name.localeCompare(right.name);
  });

  return files;
}

function readCommandsToolsOverrides(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return new Map();
  }
  const commands = config.commands;
  if (!commands || typeof commands !== "object" || Array.isArray(commands)) {
    return new Map();
  }
  const tools = commands.tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    return new Map();
  }

  const overrides = new Map();
  for (const [rawName, rawValue] of Object.entries(tools)) {
    if (typeof rawName !== "string") {
      continue;
    }
    const trimmedName = rawName.trim();
    if (trimmedName.length === 0) {
      continue;
    }
    const normalized = trimmedName.toLowerCase();
    const tokens = Array.isArray(rawValue)
      ? rawValue.filter((token) => typeof token === "string")
      : [];
    overrides.set(normalized, {
      configuredName: trimmedName,
      worker: tokens,
    });
  }
  return overrides;
}

function summarizeWorkerTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return "";
  }
  return tokens.join(" ");
}

function buildOverrideAnnotation(toolName, overrideEntry) {
  if (!overrideEntry) {
    return undefined;
  }
  const configuredName = overrideEntry.configuredName ?? toolName;
  const overrideKey = `commands.tools.${configuredName}`;
  const description = `${overrideKey} overrides worker for this prefix`;
  const workerSummary = summarizeWorkerTokens(overrideEntry.worker);
  return {
    key: overrideKey,
    configuredName,
    worker: overrideEntry.worker.slice(),
    workerSummary,
    description,
  };
}

/**
 * Discovers custom tools across the resolved tool directories, in configured
 * order. Each `.md` and `.js` file becomes an entry whose `name` is the file
 * basename without extension (lowercased). Discovery preserves directory order.
 *
 * First-wins precedence: when the same tool name appears in multiple
 * directories, the first one encountered wins (`shadowed: false`) and any
 * later duplicates are marked `shadowed: true`. Each winning entry receives a
 * `shadows` array holding shadowed duplicates in discovery order so the scene
 * can render them grouped beneath the winner. The flat `entries` array still
 * contains every discovered file in discovery order for callers that need it.
 *
 * The result also exposes a `tools` array containing only winning entries in
 * discovery order, suitable for direct rendering of the custom tool list.
 *
 * Each winning entry that has a matching `commands.tools.<name>` worker
 * override in the configuration is annotated with an `override` object
 * containing the override key, configured tool name, worker tokens, a
 * concise space-joined `workerSummary`, and a human-readable `description`
 * sub-line ("commands.tools.<name> overrides worker for this prefix").
 */
export function discoverCustomTools({ configDirPath, config } = {}) {
  if (typeof configDirPath !== "string" || configDirPath.length === 0) {
    return { directories: [], entries: [], tools: [] };
  }

  const effectiveConfig = config && typeof config === "object" && !Array.isArray(config)
    ? config
    : readConfigJson(configDirPath);
  const overrides = readCommandsToolsOverrides(effectiveConfig);

  const directories = resolveToolDirectories(configDirPath, config);
  const entries = [];
  const winnersByName = new Map();
  const tools = [];

  for (const directory of directories) {
    const files = listToolFiles(directory);
    for (const file of files) {
      const winner = winnersByName.get(file.name);
      if (winner === undefined) {
        const overrideAnnotation = buildOverrideAnnotation(file.name, overrides.get(file.name));
        const winningEntry = {
          ...file,
          shadowed: false,
          shadows: [],
          override: overrideAnnotation,
        };
        winnersByName.set(file.name, winningEntry);
        entries.push(winningEntry);
        tools.push(winningEntry);
      } else {
        const shadowedEntry = {
          ...file,
          shadowed: true,
          shadowedBy: {
            filePath: winner.filePath,
            directory: winner.directory,
          },
        };
        winner.shadows.push(shadowedEntry);
        entries.push(shadowedEntry);
      }
    }
  }

  return { directories, entries, tools };
}

export function createToolsSceneState() {
  return {
    configDirPath: "",
    toolDirectories: [],
    customTools: [],
    customToolWinners: [],
    loading: true,
    banner: "",
    builtInsVisible: true,
  };
}

export async function reloadToolsSceneState({
  state,
  currentWorkingDirectory = process.cwd(),
} = {}) {
  const sceneState = {
    ...(state ?? createToolsSceneState()),
    loading: true,
    banner: "",
  };

  const { createConfigBridge } = await import("../bridges/config-bridge.js");
  const configBridge = createConfigBridge({ cwd: currentWorkingDirectory });
  const configDirPath = configBridge.configDirPath;

  const { directories, entries, tools } = discoverCustomTools({ configDirPath });

  return {
    ...sceneState,
    configDirPath,
    toolDirectories: directories,
    customTools: entries,
    customToolWinners: tools,
    loading: false,
  };
}

/**
 * Hand-maintained catalog of built-in prefix handlers shipped with rundown.
 * Mirrors the rows shown in migration 164. Each entry includes a docs anchor
 * (under `implementation/docs/configuration.md`) that future navigation
 * subtasks (165+) will use for read-only inspection links.
 */
export const BUILT_IN_TOOL_CATALOG = [
  {
    label: "Verify-only",
    prefixes: ["verify:", "confirm:", "check:"],
    docsAnchor: "verify-only-prefixes",
  },
  {
    label: "Memory capture",
    prefixes: ["memory:", "memorize:", "remember:", "inventory:"],
    docsAnchor: "memory-capture-prefixes",
  },
  {
    label: "Fast execution",
    prefixes: ["fast:", "raw:", "quick:"],
    docsAnchor: "fast-execution-prefixes",
  },
  {
    label: "Conditional skip",
    prefixes: ["optional:", "skip:"],
    docsAnchor: "conditional-skip-prefixes",
  },
  {
    label: "Terminal stop",
    prefixes: ["quit:", "exit:", "end:", "break:", "return:"],
    docsAnchor: "terminal-stop-prefixes",
  },
  {
    label: "Include another md",
    prefixes: ["include:"],
    docsAnchor: "include-prefix",
  },
  {
    label: "Outer retry wrapper",
    prefixes: ["force:"],
    docsAnchor: "force-prefix",
  },
  {
    label: "Modifier",
    prefixes: ["profile="],
    docsAnchor: "profile-modifier",
  },
];

const BUILT_IN_LABEL_COLUMN_WIDTH = 20;

function withSectionGap(lines, sectionGap) {
  const gap = Number.isInteger(sectionGap) && sectionGap > 0 ? sectionGap : 0;
  for (let index = 0; index < gap; index += 1) {
    lines.push("");
  }
}

function formatToolDirsHeader(toolDirectories, configDirPath) {
  if (!Array.isArray(toolDirectories) || toolDirectories.length === 0) {
    return "toolDirs: []";
  }
  const labels = toolDirectories.map((dir) => {
    if (typeof dir !== "string" || dir.length === 0) {
      return "";
    }
    if (typeof configDirPath === "string" && configDirPath.length > 0) {
      const relative = path.relative(configDirPath, dir);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return relative;
      }
    }
    return dir;
  });
  return `toolDirs: [${labels.join(", ")}]`;
}

function formatToolPath(filePath, configDirPath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return "";
  }
  if (typeof configDirPath === "string" && configDirPath.length > 0) {
    const relative = path.relative(configDirPath, filePath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
  }
  return filePath;
}

function paddedName(name, columnWidth) {
  const safe = typeof name === "string" ? name : "";
  if (safe.length >= columnWidth) {
    return `${safe} `;
  }
  return safe.padEnd(columnWidth, " ");
}

function computeNameColumnWidth(winners) {
  let width = 16;
  if (!Array.isArray(winners)) {
    return width;
  }
  for (const tool of winners) {
    if (tool && typeof tool.name === "string" && tool.name.length > width) {
      width = tool.name.length;
    }
  }
  return width;
}

export function renderToolsSceneLines({ state, sectionGap = 1 } = {}) {
  const sceneState = state ?? createToolsSceneState();
  const headerSummary = formatToolDirsHeader(
    sceneState.toolDirectories,
    sceneState.configDirPath,
  );

  const lines = [pc.bold("Tools"), pc.dim(headerSummary)];

  if (sceneState.loading) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.dim("Loading custom tools..."));
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

  withSectionGap(lines, sectionGap);
  lines.push(pc.bold("Custom (project)"));

  const winners = Array.isArray(sceneState.customToolWinners)
    ? sceneState.customToolWinners
    : [];

  if (winners.length === 0) {
    lines.push(pc.dim("  No custom tools discovered."));
  } else {
    const nameColumnWidth = computeNameColumnWidth(winners);
    for (const tool of winners) {
      const namePart = paddedName(tool.name, nameColumnWidth);
      const pathPart = formatToolPath(tool.filePath, sceneState.configDirPath);
      lines.push(`  ${namePart} ${pathPart}`);
      if (tool.override && typeof tool.override.description === "string") {
        const overrideLine = tool.override.workerSummary
          ? `${tool.override.description} (${tool.override.workerSummary})`
          : tool.override.description;
        lines.push(pc.cyan(`      ${overrideLine}`));
      }
      if (Array.isArray(tool.shadows) && tool.shadows.length > 0) {
        for (const shadow of tool.shadows) {
          const shadowPath = formatToolPath(shadow.filePath, sceneState.configDirPath);
          lines.push(pc.dim(`      shadowed: ${shadowPath}`));
        }
      }
    }
  }

  withSectionGap(lines, sectionGap);
  const builtInsVisible = sceneState.builtInsVisible !== false;
  if (builtInsVisible) {
    lines.push(pc.bold("Built-in (read-only)"));
    for (const row of BUILT_IN_TOOL_CATALOG) {
      const label = row.label.padEnd(BUILT_IN_LABEL_COLUMN_WIDTH, " ");
      lines.push(pc.dim(`  ${label}${row.prefixes.join(" ")}`));
    }
  } else {
    lines.push(pc.dim("Built-in catalog hidden. [b] to show."));
  }

  withSectionGap(lines, sectionGap);
  lines.push(pc.dim("[↵] inspect template   [e] edit prompt   [r] reload tool dirs   [b] toggle built-ins"));
  lines.push(pc.dim("[Esc] Back to menu"));
  return lines;
}
