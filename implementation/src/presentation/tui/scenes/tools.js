import fs from "node:fs";
import path from "node:path";

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

/**
 * Discovers custom tools across the resolved tool directories, in configured
 * order. Each `.md` and `.js` file becomes an entry whose `name` is the file
 * basename without extension (lowercased). Discovery preserves directory order
 * so callers can apply first-wins precedence in later steps.
 */
export function discoverCustomTools({ configDirPath, config } = {}) {
  if (typeof configDirPath !== "string" || configDirPath.length === 0) {
    return { directories: [], entries: [] };
  }

  const directories = resolveToolDirectories(configDirPath, config);
  const entries = [];
  for (const directory of directories) {
    const files = listToolFiles(directory);
    for (const file of files) {
      entries.push(file);
    }
  }

  return { directories, entries };
}

export function createToolsSceneState() {
  return {
    configDirPath: "",
    toolDirectories: [],
    customTools: [],
    loading: true,
    banner: "",
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

  const { directories, entries } = discoverCustomTools({ configDirPath });

  return {
    ...sceneState,
    configDirPath,
    toolDirectories: directories,
    customTools: entries,
    loading: false,
  };
}
