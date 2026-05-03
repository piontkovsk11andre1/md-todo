// @ts-nocheck
import pc from "picocolors";
import { createConfigBridge } from "../bridges/config-bridge.ts";
import { createWorkspaceScanBridge } from "../bridges/workspace-scan.ts";

const PROFILE_SCAN_TTL_MS = 30_000;

export function createProfilesSceneState() {
  return {
    config: {},
    configPath: ".rundown/config.json",
    references: [],
    referencesScannedAt: 0,
    referencesScanned: false,
    banner: "",
    loading: true,
  };
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

function formatCommandPreview(commandValue) {
  if (!Array.isArray(commandValue)) {
    return "(invalid command)";
  }
  const tokens = commandValue.filter((part) => typeof part === "string");
  if (tokens.length === 0) {
    return "(empty command)";
  }
  return tokens.join(" ");
}

function collectUsageByProfile(references) {
  const byProfile = new Map();
  const entries = Array.isArray(references) ? references : [];

  for (const reference of entries) {
    const profileName = typeof reference?.profile === "string" ? reference.profile : "";
    const kind = typeof reference?.kind === "string" ? reference.kind : "";
    if (profileName.length === 0) {
      continue;
    }
    if (kind !== "frontmatter" && kind !== "directive" && kind !== "prefix") {
      continue;
    }

    if (!byProfile.has(profileName)) {
      byProfile.set(profileName, {
        frontmatter: 0,
        directive: 0,
        prefix: 0,
      });
    }

    const aggregate = byProfile.get(profileName);
    aggregate[kind] += 1;
  }

  return byProfile;
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

function buildBridgeBundle(currentWorkingDirectory, {
  configBridgeFactory = createConfigBridge,
  workspaceScanBridgeFactory = createWorkspaceScanBridge,
} = {}) {
  return {
    configBridge: configBridgeFactory({ cwd: currentWorkingDirectory }),
    workspaceScanBridge: workspaceScanBridgeFactory({ cwd: currentWorkingDirectory }),
  };
}

export async function reloadProfilesSceneState({
  state,
  currentWorkingDirectory = process.cwd(),
  forceRescan = false,
  keepBanner = false,
  now = Date.now,
  configBridgeFactory,
  workspaceScanBridgeFactory,
} = {}) {
  const sceneState = {
    ...(state ?? createProfilesSceneState()),
    loading: true,
  };
  if (!keepBanner) {
    sceneState.banner = "";
  }

  const { configBridge, workspaceScanBridge } = buildBridgeBundle(currentWorkingDirectory, {
    configBridgeFactory,
    workspaceScanBridgeFactory,
  });
  const configPathPromise = configBridge.resolveConfigPath("local");
  const configPromise = configBridge.loadWorkerConfig();

  const scanStale = now() - (sceneState.referencesScannedAt || 0) >= PROFILE_SCAN_TTL_MS;
  const shouldScan = forceRescan || !sceneState.referencesScanned || scanStale;
  const scanPromise = shouldScan
    ? workspaceScanBridge.scanProfileReferences({ sourcePath: currentWorkingDirectory })
    : Promise.resolve(sceneState.references);

  const [configPathResult, configResult, scanResult] = await Promise.allSettled([
    configPathPromise,
    configPromise,
    scanPromise,
  ]);

  const errors = [];

  if (configPathResult.status === "fulfilled" && typeof configPathResult.value === "string" && configPathResult.value.length > 0) {
    sceneState.configPath = configPathResult.value;
  } else if (configPathResult.status === "rejected") {
    errors.push(`Config path failed: ${toErrorMessage(configPathResult.reason)}`);
  }

  if (configResult.status === "fulfilled") {
    sceneState.config = safeObject(configResult.value);
  } else {
    errors.push(`Config load failed: ${toErrorMessage(configResult.reason)}`);
  }

  if (scanResult.status === "fulfilled") {
    sceneState.references = Array.isArray(scanResult.value) ? scanResult.value : [];
    if (shouldScan) {
      sceneState.referencesScannedAt = now();
      sceneState.referencesScanned = true;
    }
  } else {
    errors.push(`Workspace scan failed: ${toErrorMessage(scanResult.reason)}`);
  }

  if (errors.length > 0) {
    sceneState.banner = errors.join(" | ");
  }

  sceneState.loading = false;
  return sceneState;
}

export function renderProfilesSceneLines({ state, sectionGap = 1 } = {}) {
  const sceneState = state ?? createProfilesSceneState();
  const config = safeObject(sceneState.config);
  const profiles = safeObject(config.profiles);
  const usageByProfile = collectUsageByProfile(sceneState.references);
  const profileNames = Object.keys(profiles);

  const lines = [
    pc.bold("Profiles"),
    pc.dim(sceneState.configPath || ".rundown/config.json"),
  ];

  if (sceneState.loading) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.dim("Loading profiles..."));
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

  if (profileNames.length === 0) {
    lines.push(pc.dim("No profiles defined."));
    withSectionGap(lines, sectionGap);
    lines.push(pc.dim("[Esc] Back to menu"));
    return lines;
  }

  const nameColumnWidth = Math.max(
    8,
    profileNames.reduce((max, name) => Math.max(max, name.length), 0),
  );

  for (const profileName of profileNames) {
    const preview = formatCommandPreview(profiles[profileName]);
    lines.push(`  ${profileName.padEnd(nameColumnWidth, " ")}  ${preview}`);

    const usage = usageByProfile.get(profileName);
    if (!usage) {
      lines.push(pc.dim("            used by: (no references found)"));
      continue;
    }

    lines.push(pc.dim(
      `            used by: ${usage.frontmatter} frontmatter · ${usage.directive} directives · ${usage.prefix} prefix`,
    ));
  }

  withSectionGap(lines, sectionGap);
  lines.push(pc.dim("[u] full scan"));
  lines.push(pc.dim("[Esc] Back to menu"));
  return lines;
}

export function handleProfilesInput({ rawInput, state } = {}) {
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: state ?? createProfilesSceneState(),
      backToParent: true,
    };
  }

  const input = String(rawInput ?? "").toLowerCase();
  if (input === "u") {
    return {
      handled: true,
      state: state ?? createProfilesSceneState(),
      backToParent: false,
      action: { type: "full-rescan" },
    };
  }

  return {
    handled: false,
    state: state ?? createProfilesSceneState(),
    backToParent: false,
  };
}

export async function runProfilesSceneAction({
  action,
  state,
  currentWorkingDirectory = process.cwd(),
} = {}) {
  if (!action || typeof action.type !== "string") {
    return state ?? createProfilesSceneState();
  }

  if (action.type === "full-rescan") {
    return reloadProfilesSceneState({
      state,
      currentWorkingDirectory,
      forceRescan: true,
      keepBanner: false,
    });
  }

  return state ?? createProfilesSceneState();
}
