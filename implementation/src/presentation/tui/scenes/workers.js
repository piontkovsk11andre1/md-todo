import pc from "picocolors";

const COMMAND_OVERRIDE_ORDER = [
  "run",
  "plan",
  "discuss",
  "help",
  "research",
  "reverify",
  "verify",
  "memory",
];

const ROUTING_PHASE_ORDER = ["execute", "verify", "repair", "resolve", "resolveRepair", "reset"];

export function createWorkersSceneState() {
  return {
    config: {},
    healthStatus: {
      entries: [],
    },
    configPath: ".rundown/config.json",
    banner: "",
  };
}

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function withSectionGap(lines, sectionGap) {
  const gap = Number.isInteger(sectionGap) && sectionGap > 0 ? sectionGap : 0;
  for (let index = 0; index < gap; index += 1) {
    lines.push("");
  }
}

function formatCommand(command) {
  if (!Array.isArray(command) || command.length === 0) {
    return "(empty command)";
  }
  return command.join(" ");
}

function parseWorkerIdentityFromKey(key) {
  if (typeof key !== "string" || !key.startsWith("worker:")) {
    return "";
  }
  const payload = key.slice("worker:".length);
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed) && parsed.every((part) => typeof part === "string")) {
      return parsed.join(" ");
    }
  } catch {
    return "";
  }
  return "";
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
  const ss = String(time.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function buildHealthIndex(healthStatus) {
  const entries = Array.isArray(healthStatus?.entries) ? healthStatus.entries : [];
  const byIdentity = new Map();

  for (const entry of entries) {
    if (entry?.source !== "worker") {
      continue;
    }

    const identityFromKey = parseWorkerIdentityFromKey(entry.key);
    if (identityFromKey.length > 0 && !byIdentity.has(identityFromKey)) {
      byIdentity.set(identityFromKey, entry);
    }

    if (typeof entry.identity === "string" && entry.identity.length > 0 && !byIdentity.has(entry.identity)) {
      byIdentity.set(entry.identity, entry);
    }
  }

  return byIdentity;
}

function formatHealth(entry) {
  if (!entry || typeof entry !== "object") {
    return pc.dim("-");
  }

  if (entry.status === "ready") {
    return pc.green("✓ ready");
  }

  if (entry.status === "cooling_down") {
    const until = formatClock(entry.cooldownUntil);
    const failureClass = typeof entry.lastFailureClass === "string" && entry.lastFailureClass.length > 0
      ? ` (${entry.lastFailureClass})`
      : "";
    if (until) {
      return pc.yellow(`⚠ cooling until ${until}${failureClass}`);
    }
    return pc.yellow(`⚠ cooling${failureClass}`);
  }

  if (entry.status === "unavailable") {
    return pc.red("✗ unavailable");
  }

  return pc.dim("-");
}

function formatRoutingSummary(phase, routeConfig) {
  if (!routeConfig || typeof routeConfig !== "object") {
    if (phase === "reset") {
      return pc.green("✓ not configured (semantic reset disabled)");
    }
    return pc.green("✓ inherits");
  }

  if (phase === "repair" || phase === "resolveRepair") {
    const attempts = Array.isArray(routeConfig.attempts) ? routeConfig.attempts.length : 0;
    if (attempts > 0) {
      const ruleLabel = attempts === 1 ? "attempt rule" : "attempt rules";
      return pc.yellow(`⚙ overridden · ${attempts} ${ruleLabel}`);
    }
  }

  return pc.yellow("⚙ overridden");
}

function pushLabeledRow(lines, label, value, healthText = "") {
  const labelColumn = label.padEnd(18, " ");
  const base = `  ${labelColumn}${value}`;
  if (!healthText) {
    lines.push(base);
    return;
  }
  lines.push(`${base}  ${healthText}`);
}

export function renderWorkersSceneLines({ state, sectionGap = 1 } = {}) {
  const sceneState = state ?? createWorkersSceneState();
  const config = safeObject(sceneState.config);
  const workers = safeObject(config.workers);
  const commands = safeObject(config.commands);
  const routing = safeObject(safeObject(config.run).workerRouting);
  const healthByIdentity = buildHealthIndex(sceneState.healthStatus);

  const lines = [
    pc.bold("Workers"),
    pc.dim(sceneState.configPath || ".rundown/config.json"),
  ];

  if (typeof sceneState.banner === "string" && sceneState.banner.length > 0) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.red(`! ${sceneState.banner}`));
  }

  withSectionGap(lines, sectionGap);
  lines.push(pc.bold("Pool"));

  const hasDefault = Object.hasOwn(workers, "default");
  const hasTui = Object.hasOwn(workers, "tui");
  const fallbacks = Array.isArray(workers.fallbacks) ? workers.fallbacks : [];
  const hasWorkerTimeout = typeof config.workerTimeoutMs === "number";

  if (!hasDefault && !hasTui && fallbacks.length === 0 && !hasWorkerTimeout) {
    lines.push(pc.dim("  No worker defaults configured."));
  } else {
    if (hasDefault) {
      const value = formatCommand(workers.default);
      pushLabeledRow(lines, "default", value, formatHealth(healthByIdentity.get(value)));
    }

    if (hasTui) {
      const value = formatCommand(workers.tui);
      pushLabeledRow(lines, "tui", value, formatHealth(healthByIdentity.get(value)));
    }

    if (fallbacks.length > 0) {
      for (let index = 0; index < fallbacks.length; index += 1) {
        const fallbackValue = formatCommand(fallbacks[index]);
        const label = index === 0 ? "fallbacks" : "";
        pushLabeledRow(
          lines,
          label,
          `${index + 1}. ${fallbackValue}`,
          formatHealth(healthByIdentity.get(fallbackValue)),
        );
      }
    }

    if (hasWorkerTimeout) {
      pushLabeledRow(lines, "workerTimeoutMs", String(config.workerTimeoutMs));
    }
  }

  const commandKeys = Object.keys(commands);
  const orderedCommandKeys = [
    ...COMMAND_OVERRIDE_ORDER.filter((key) => Object.hasOwn(commands, key)),
    ...commandKeys.filter((key) => key.startsWith("tools.")).sort(),
    ...commandKeys
      .filter((key) => !COMMAND_OVERRIDE_ORDER.includes(key) && !key.startsWith("tools."))
      .sort(),
  ];

  if (orderedCommandKeys.length > 0) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.bold("Per-command overrides (commands.<name>)"));
    for (const key of orderedCommandKeys) {
      const value = formatCommand(commands[key]);
      pushLabeledRow(lines, key, value, formatHealth(healthByIdentity.get(value)));
    }
  }

  if (Object.keys(routing).length > 0) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.bold("Phase routing (run.workerRouting) - summary"));
    for (const phase of ROUTING_PHASE_ORDER) {
      pushLabeledRow(lines, phase, formatRoutingSummary(phase, routing[phase]));
    }
  }

  withSectionGap(lines, sectionGap);
  lines.push(pc.dim("[e] edit config.json   [E] edit global config   [r] reload"));
  lines.push(pc.dim("[Esc] Back to menu"));
  return lines;
}

export function handleWorkersInput({ rawInput, state } = {}) {
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: state ?? createWorkersSceneState(),
      backToParent: true,
    };
  }
  return {
    handled: false,
    state: state ?? createWorkersSceneState(),
    backToParent: false,
  };
}
