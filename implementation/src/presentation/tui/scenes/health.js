import pc from "picocolors";
import { createConfigBridge } from "../bridges/config-bridge.js";
import { createHealthBridge } from "../bridges/health-bridge.js";

const FAILURE_CLASS_ORDER = [
  "usage_limit",
  "transport_unavailable",
  "execution_failure_other",
];

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function withSectionGap(lines, sectionGap) {
  const gap = Number.isInteger(sectionGap) && sectionGap > 0 ? sectionGap : 0;
  for (let index = 0; index < gap; index += 1) {
    lines.push("");
  }
}

function buildBridgeBundle(currentWorkingDirectory) {
  const configBridge = createConfigBridge({ cwd: currentWorkingDirectory });
  const healthBridge = createHealthBridge({
    cwd: currentWorkingDirectory,
    configDirPath: configBridge.configDirPath,
  });
  return { configBridge, healthBridge };
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

function formatClock(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return "";
  }
  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function entryLabel(entry, index, fallbackOrderIndex) {
  if (entry?.source === "profile") {
    return `profile:${entry.identity || entry.key || `#${index + 1}`}`;
  }
  if (typeof fallbackOrderIndex === "number") {
    if (fallbackOrderIndex === 0) {
      return "default";
    }
    return `fallback#${fallbackOrderIndex}`;
  }
  return entry?.identity || entry?.key || `entry#${index + 1}`;
}

function entryIdentity(entry) {
  if (typeof entry?.identity === "string" && entry.identity.length > 0) {
    return entry.identity;
  }
  if (typeof entry?.key === "string" && entry.key.length > 0) {
    return entry.key;
  }
  return "";
}

function statusBadge(entry) {
  if (!entry || typeof entry !== "object") {
    return pc.dim("-");
  }
  if (entry.status === "ready") {
    return pc.green("✓ ready");
  }
  if (entry.status === "cooling_down") {
    const until = formatClock(entry.cooldownUntil);
    return until ? pc.yellow(`⚠ cooling_down  until ${until}`) : pc.yellow("⚠ cooling_down");
  }
  if (entry.status === "unavailable") {
    return pc.red("✗ unavailable");
  }
  return pc.dim(`- ${entry.status || "unknown"}`);
}

function buildFallbackOrderIndex(state) {
  // Build an identity → fallback-order index from the worker config so Workers
  // rows can render as `default` / `fallback#N` like the migration mockup.
  const config = safeObject(state?.config);
  const workers = safeObject(config.workers);
  const order = new Map();

  if (Array.isArray(workers.default)) {
    order.set(workers.default.join(" "), 0);
  }
  const fallbacks = Array.isArray(workers.fallbacks) ? workers.fallbacks : [];
  for (let index = 0; index < fallbacks.length; index += 1) {
    const command = fallbacks[index];
    if (Array.isArray(command)) {
      const identity = command.join(" ");
      if (!order.has(identity)) {
        order.set(identity, index + 1);
      }
    }
  }
  return order;
}

export function createHealthSceneState() {
  return {
    healthStatus: { entries: [], generatedAt: "", filePath: "", configDir: "" },
    config: {},
    configPath: ".rundown/config.json",
    selectedIndex: 0,
    banner: "",
    loading: true,
  };
}

export async function reloadHealthSceneState({
  state,
  currentWorkingDirectory = process.cwd(),
  keepBanner = false,
} = {}) {
  const sceneState = {
    ...(state ?? createHealthSceneState()),
    loading: true,
  };
  if (!keepBanner) {
    sceneState.banner = "";
  }

  const { configBridge, healthBridge } = buildBridgeBundle(currentWorkingDirectory);
  const [healthResult, configResult, pathResult] = await Promise.allSettled([
    healthBridge.loadHealthStatus(),
    configBridge.loadWorkerConfig(),
    configBridge.resolveConfigPath("local"),
  ]);

  if (healthResult.status === "fulfilled") {
    sceneState.healthStatus = safeObject(healthResult.value);
  }
  if (configResult.status === "fulfilled") {
    sceneState.config = safeObject(configResult.value);
  }
  if (pathResult.status === "fulfilled" && typeof pathResult.value === "string" && pathResult.value.length > 0) {
    sceneState.configPath = pathResult.value;
  }

  const errors = [];
  if (healthResult.status === "rejected") {
    errors.push(`Health load failed: ${toErrorMessage(healthResult.reason)}`);
  }
  if (configResult.status === "rejected") {
    errors.push(`Config load failed: ${toErrorMessage(configResult.reason)}`);
  }
  if (pathResult.status === "rejected") {
    errors.push(`Config path failed: ${toErrorMessage(pathResult.reason)}`);
  }
  if (errors.length > 0) {
    sceneState.banner = errors.join(" | ");
  }

  const entries = Array.isArray(sceneState.healthStatus?.entries) ? sceneState.healthStatus.entries : [];
  if (entries.length === 0) {
    sceneState.selectedIndex = 0;
  } else if (sceneState.selectedIndex >= entries.length) {
    sceneState.selectedIndex = entries.length - 1;
  } else if (sceneState.selectedIndex < 0) {
    sceneState.selectedIndex = 0;
  }

  sceneState.loading = false;
  return sceneState;
}

function renderHeader(state, lines) {
  const policy = safeObject(safeObject(state.config).healthPolicy);
  const reeval = safeObject(policy.unavailableReevaluation);
  const mode = typeof reeval.mode === "string" && reeval.mode.length > 0 ? reeval.mode : "(default)";
  lines.push(pc.bold("Health"));
  lines.push(pc.dim(`unavailableReevaluation: ${mode}`));
}

function renderWorkers(state, lines, sectionGap) {
  withSectionGap(lines, sectionGap);
  lines.push(pc.bold("Workers"));

  const entries = Array.isArray(state.healthStatus?.entries) ? state.healthStatus.entries : [];
  if (entries.length === 0) {
    lines.push(pc.dim("  (no health entries — empty snapshot)"));
    return;
  }

  const fallbackOrder = buildFallbackOrderIndex(state);
  const selectedIndex = Number.isInteger(state.selectedIndex) ? state.selectedIndex : 0;

  const rows = entries.map((entry, index) => {
    const identity = entryIdentity(entry);
    const orderIndex = fallbackOrder.get(identity);
    const label = entryLabel(entry, index, orderIndex);
    return { entry, index, label, identity };
  });

  const labelWidth = Math.max(10, ...rows.map((row) => row.label.length));
  const identityWidth = Math.max(8, ...rows.map((row) => row.identity.length));

  for (const row of rows) {
    const cursor = row.index === selectedIndex ? pc.cyan("›") : " ";
    const labelColumn = row.label.padEnd(labelWidth, " ");
    const identityColumn = (row.identity || "(unknown)").padEnd(identityWidth, " ");
    const statusColumn = statusBadge(row.entry);
    lines.push(`  ${cursor} ${labelColumn}  ${identityColumn}  ${statusColumn}`);

    if (row.entry?.status === "cooling_down" && typeof row.entry.lastFailureClass === "string" && row.entry.lastFailureClass.length > 0) {
      const indent = " ".repeat(2 + 2 + labelWidth + 2 + identityWidth + 2);
      lines.push(`${indent}${pc.dim(`failure: ${row.entry.lastFailureClass}`)}`);
    }
  }
}

function renderPolicy(state, lines, sectionGap) {
  const policy = safeObject(safeObject(state.config).healthPolicy);
  const cooldown = safeObject(policy.cooldownSecondsByFailureClass);
  const reeval = safeObject(policy.unavailableReevaluation);

  withSectionGap(lines, sectionGap);
  lines.push(pc.bold("Policy"));

  const hasCooldown = FAILURE_CLASS_ORDER.some((key) => typeof cooldown[key] === "number");
  if (hasCooldown) {
    lines.push("  cooldown by failure class:");
    for (const key of FAILURE_CLASS_ORDER) {
      if (typeof cooldown[key] === "number") {
        const padded = key.padEnd(26, " ");
        lines.push(`    ${padded}${cooldown[key]}s`);
      }
    }
  } else {
    lines.push(pc.dim("  cooldown by failure class: (defaults)"));
  }

  const failoverPerTask = policy.maxFailoverAttemptsPerTask;
  const failoverPerRun = policy.maxFailoverAttemptsPerRun;
  if (typeof failoverPerTask === "number" || typeof failoverPerRun === "number") {
    lines.push("  failover budget:");
    if (typeof failoverPerTask === "number") {
      lines.push(`    ${"maxFailoverAttemptsPerTask".padEnd(26, " ")}${failoverPerTask}`);
    }
    if (typeof failoverPerRun === "number") {
      lines.push(`    ${"maxFailoverAttemptsPerRun".padEnd(26, " ")}${failoverPerRun}`);
    }
  } else {
    lines.push(pc.dim("  failover budget: (defaults)"));
  }

  if (typeof policy.fallbackStrategy === "string" && policy.fallbackStrategy.length > 0) {
    lines.push(`  fallbackStrategy:           ${policy.fallbackStrategy}`);
  } else {
    lines.push(pc.dim("  fallbackStrategy:           (default)"));
  }

  lines.push("  unavailableReevaluation:");
  if (typeof reeval.mode === "string" && reeval.mode.length > 0) {
    lines.push(`    ${"mode".padEnd(24, " ")}${reeval.mode}`);
  } else {
    lines.push(pc.dim(`    ${"mode".padEnd(24, " ")}(default)`));
  }
  if (typeof reeval.probeCooldownSeconds === "number") {
    lines.push(`    ${"probeCooldownSeconds".padEnd(24, " ")}${reeval.probeCooldownSeconds}`);
  }
}

export function renderHealthSceneLines({ state, sectionGap = 1 } = {}) {
  const sceneState = state ?? createHealthSceneState();
  const lines = [];

  renderHeader(sceneState, lines);
  lines.push(pc.dim(sceneState.configPath || ".rundown/config.json"));

  if (sceneState.loading) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.dim("Loading health status..."));
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

  renderWorkers(sceneState, lines, sectionGap);
  renderPolicy(sceneState, lines, sectionGap);

  withSectionGap(lines, sectionGap);
  lines.push(pc.dim("[↵] view recent failures   [r] reset entry   [p] probe now"));
  lines.push(pc.dim("[e] edit healthPolicy in config.json   [R] reload"));
  lines.push(pc.dim("[Esc] Back to menu"));
  return lines;
}

export function handleHealthInput({ rawInput, state } = {}) {
  const sceneState = state ?? createHealthSceneState();
  const input = String(rawInput ?? "");
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return { handled: true, state: sceneState, backToParent: true };
  }

  const entries = Array.isArray(sceneState.healthStatus?.entries) ? sceneState.healthStatus.entries : [];
  const lastIndex = entries.length > 0 ? entries.length - 1 : 0;
  const currentIndex = Number.isInteger(sceneState.selectedIndex) ? sceneState.selectedIndex : 0;

  if (rawInput === "\u001b[A" || input === "k") {
    if (entries.length === 0) {
      return { handled: true, state: sceneState, backToParent: false };
    }
    return {
      handled: true,
      state: { ...sceneState, selectedIndex: Math.max(0, currentIndex - 1) },
      backToParent: false,
    };
  }

  if (rawInput === "\u001b[B" || input === "j") {
    if (entries.length === 0) {
      return { handled: true, state: sceneState, backToParent: false };
    }
    return {
      handled: true,
      state: { ...sceneState, selectedIndex: Math.min(lastIndex, currentIndex + 1) },
      backToParent: false,
    };
  }

  if (input === "R") {
    return {
      handled: true,
      state: sceneState,
      backToParent: false,
      action: { type: "reload" },
    };
  }

  return { handled: false, state: sceneState, backToParent: false };
}

export async function runHealthSceneAction({
  action,
  state,
  currentWorkingDirectory = process.cwd(),
} = {}) {
  const sceneState = state ?? createHealthSceneState();
  if (!action || typeof action.type !== "string") {
    return sceneState;
  }
  if (action.type === "reload") {
    return reloadHealthSceneState({ state: sceneState, currentWorkingDirectory, keepBanner: false });
  }
  return sceneState;
}
