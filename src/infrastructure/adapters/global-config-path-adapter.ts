import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GLOBAL_CONFIG_DIR_NAME = "rundown";
const GLOBAL_CONFIG_FILE_NAME = "config.json";

export interface GlobalConfigPathResolution {
  readonly canonicalPath: string | undefined;
  readonly discoveredPath: string | undefined;
  readonly candidates: readonly string[];
}

interface ResolveGlobalConfigPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homedir?: string;
  readonly fileExists?: (filePath: string) => boolean;
}

function normalizeNonEmptyPath(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toConfigFilePathForPlatform(configRoot: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return path.win32.join(configRoot, GLOBAL_CONFIG_DIR_NAME, GLOBAL_CONFIG_FILE_NAME);
  }

  return path.posix.join(configRoot, GLOBAL_CONFIG_DIR_NAME, GLOBAL_CONFIG_FILE_NAME);
}

function pushCandidate(candidates: string[], candidate: string | undefined): void {
  const normalized = normalizeNonEmptyPath(candidate);
  if (!normalized) {
    return;
  }

  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

/**
 * Resolves ordered user-level global config discovery candidates and picks a
 * canonical write location for the current platform.
 */
export function resolveGlobalConfigPath(
  options: ResolveGlobalConfigPathOptions = {},
): GlobalConfigPathResolution {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homedir = normalizeNonEmptyPath(options.homedir ?? os.homedir());
  const fileExists = options.fileExists ?? ((filePath: string) => fs.existsSync(filePath));

  const candidates: string[] = [];

  if (platform === "win32") {
    pushCandidate(candidates, normalizeNonEmptyPath(env.APPDATA)
      ? toConfigFilePathForPlatform(env.APPDATA as string, platform)
      : undefined);
    pushCandidate(candidates, normalizeNonEmptyPath(env.LOCALAPPDATA)
      ? toConfigFilePathForPlatform(env.LOCALAPPDATA as string, platform)
      : undefined);
    pushCandidate(candidates, homedir
      ? toConfigFilePathForPlatform(path.win32.join(homedir, "AppData", "Roaming"), platform)
      : undefined);
    pushCandidate(candidates, normalizeNonEmptyPath(env.USERPROFILE)
      ? toConfigFilePathForPlatform(path.win32.join(env.USERPROFILE as string, "AppData", "Roaming"), platform)
      : undefined);
    pushCandidate(candidates, homedir
      ? toConfigFilePathForPlatform(path.win32.join(homedir, ".config"), platform)
      : undefined);
  } else if (platform === "darwin") {
    pushCandidate(candidates, homedir
      ? toConfigFilePathForPlatform(path.posix.join(homedir, "Library", "Application Support"), platform)
      : undefined);
    pushCandidate(candidates, normalizeNonEmptyPath(env.XDG_CONFIG_HOME)
      ? toConfigFilePathForPlatform(env.XDG_CONFIG_HOME as string, platform)
      : undefined);
    pushCandidate(candidates, homedir
      ? toConfigFilePathForPlatform(path.posix.join(homedir, ".config"), platform)
      : undefined);
  } else {
    pushCandidate(candidates, normalizeNonEmptyPath(env.XDG_CONFIG_HOME)
      ? toConfigFilePathForPlatform(env.XDG_CONFIG_HOME as string, platform)
      : undefined);
    pushCandidate(candidates, homedir
      ? toConfigFilePathForPlatform(path.posix.join(homedir, ".config"), platform)
      : undefined);
  }

  const canonicalPath = candidates[0];
  const discoveredPath = candidates.find((candidate) => fileExists(candidate));

  return {
    canonicalPath,
    discoveredPath,
    candidates,
  };
}
