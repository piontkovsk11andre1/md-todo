#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import pc from "picocolors";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../dist/index.js";

const SPINNER_FRAMES = ["-", "\\", "|", "/"];

const operationColor = {
  scan: pc.cyan,
  execute: pc.yellow,
  verify: pc.blue,
  repair: pc.red,
  resolve: pc.magenta,
  resolverepair: pc.magenta,
  finalize: pc.green,
  discuss: pc.yellow,
  plan: pc.cyan,
  research: pc.cyan,
  summarize: pc.blue,
  agent: pc.yellow,
};

const MENU_ITEMS = [
  { key: "m", label: "Materialize" },
  { key: "a", label: "Discuss the Agent" },
  { key: "o", label: "Open Agent" },
];

const MATERIALIZE_MODES = [
  { key: "1", id: "migrations", label: "Materialize Migrations" },
  { key: "2", id: "path", label: "Materialize Specific Path" },
];

const DEFAULT_WORKER_PATTERN = {
  command: [],
  usesBootstrap: false,
  usesFile: false,
  appendFile: true,
};

const AGENT_PROMPT_FILES = {
  a: ".rundown/discuss-agent.md",
  o: ".rundown/agent.md",
};

const ACTION_LABELS = {
  m: "materialize",
  a: "discuss-agent",
  o: "open-agent",
};

function orange(text) {
  return `\u001B[38;5;208m${text}\u001B[39m`;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseFps(value) {
  const parsed = parsePositiveInteger(value, "FPS");
  if (parsed > 60) {
    throw new InvalidArgumentError("FPS must be <= 60.");
  }
  return parsed;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(remainingSeconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatTimestamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "--";
  }
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function progressBar(width, ratio) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  const complete = Math.round(width * safeRatio);
  const done = "#".repeat(complete);
  const pending = "-".repeat(Math.max(0, width - complete));
  return `[${pc.green(done)}${pc.dim(pending)}]`;
}

function formatTaskLines(kind, task, checked, tone) {
  const isMuted = tone === "muted";
  const label = isMuted ? pc.dim(kind.padEnd(8, " ")) : kind.padEnd(8, " ");
  const tokenStyle = (() => {
    if (kind === "previous") {
      return pc.green;
    }
    if (kind === "current") {
      return orange;
    }
    return pc.dim;
  })();
  const textStyle = isMuted ? pc.dim : pc.white;

  if (!task) {
    return [`${label} ${pc.dim("(none)")}`];
  }

  const checkbox = checked ? "[x]" : "[ ]";
  const textLines = task.textLines && task.textLines.length > 0 ? task.textLines : [""];
  const [firstLine, ...restLines] = textLines;
  const lines = [
    `${label} ${tokenStyle(String(task.line).padStart(3, "0"))} ${tokenStyle("-")} ${tokenStyle(checkbox)} ${textStyle(firstLine)}`,
  ];
  restLines.forEach((lineText, index) => {
    const lineNumber = task.line + index + 1;
    lines.push(`${" ".repeat(8)} ${tokenStyle(String(lineNumber).padStart(3, "0"))}     ${textStyle(lineText)}`);
  });
  return lines;
}

function formatMenuLine(item, activeKey) {
  const isActive = item.key === activeKey;
  const keyToken = isActive ? pc.black(pc.bgYellow(` ${item.key.toUpperCase()} `)) : pc.cyan(`[${item.key.toUpperCase()}]`);
  const label = isActive ? pc.bold(pc.yellow(item.label)) : pc.white(item.label);
  return `${keyToken} ${label}`;
}

function formatMaterializeModeLine(mode, activeMode) {
  const isActive = mode.id === activeMode;
  const keyToken = isActive ? pc.black(pc.bgYellow(` ${mode.key} `)) : pc.cyan(`[${mode.key}]`);
  const label = isActive ? pc.bold(pc.yellow(mode.label)) : pc.white(mode.label);
  return `${keyToken} ${label}`;
}

function resolveMaterializeSource(activeMaterializeMode, customPath) {
  if (activeMaterializeMode === "migrations") {
    return "migrations/";
  }
  return customPath.trim();
}

function evaluateMaterializePath(pathInput, workingDirectory) {
  const value = pathInput.trim();
  if (value.length === 0) {
    return { isValid: false, exists: false, error: "Specific path is empty. Type a path before pressing Enter." };
  }
  if (/[^\x20-\x7E]/.test(value)) {
    return { isValid: false, exists: false, error: "Path contains unsupported characters. Use visible ASCII characters only." };
  }
  const resolvedPath = path.resolve(workingDirectory, value);
  const exists = fs.existsSync(resolvedPath);
  if (!exists) {
    return { isValid: false, exists, error: `Path not found: ${value}` };
  }
  return { isValid: true, exists, error: "" };
}

function validateMaterializePath(pathInput, workingDirectory) {
  return evaluateMaterializePath(pathInput, workingDirectory).error;
}

function containsWildcardPattern(value) {
  return /[\*\?\[\]\{\}]/.test(value);
}

function longestCommonPrefix(values) {
  if (values.length === 0) {
    return "";
  }
  let prefix = values[0] ?? "";
  for (let index = 1; index < values.length; index += 1) {
    const candidate = values[index] ?? "";
    let cursor = 0;
    while (cursor < prefix.length && cursor < candidate.length && prefix[cursor] === candidate[cursor]) {
      cursor += 1;
    }
    prefix = prefix.slice(0, cursor);
    if (prefix.length === 0) {
      break;
    }
  }
  return prefix;
}

function resolvePathSeparator(pathInput) {
  if (pathInput.includes("/") && !pathInput.includes("\\")) {
    return "/";
  }
  return path.sep;
}

function completeMaterializePathInput(pathInput, workingDirectory) {
  if (containsWildcardPattern(pathInput)) {
    return { nextInput: pathInput, hint: "Tab completion is disabled for wildcard paths." };
  }
  const lastSeparatorIndex = Math.max(pathInput.lastIndexOf("/"), pathInput.lastIndexOf("\\"));
  const hasDirPart = lastSeparatorIndex >= 0;
  const dirPart = hasDirPart ? pathInput.slice(0, lastSeparatorIndex + 1) : "";
  const partialName = hasDirPart ? pathInput.slice(lastSeparatorIndex + 1) : pathInput;
  const directoryToScan = path.resolve(workingDirectory, dirPart || ".");

  let entries;
  try {
    const stats = fs.statSync(directoryToScan);
    if (!stats.isDirectory()) {
      return { nextInput: pathInput, hint: "Tab completion failed: base path is not a directory." };
    }
    entries = fs.readdirSync(directoryToScan, { withFileTypes: true });
  } catch {
    return { nextInput: pathInput, hint: "Tab completion failed: base path does not exist." };
  }

  const normalizedPartial = partialName.toLowerCase();
  const matches = entries.filter((entry) => entry.name.toLowerCase().startsWith(normalizedPartial));
  if (matches.length === 0) {
    return { nextInput: pathInput, hint: "No matching paths for tab completion." };
  }
  const separator = resolvePathSeparator(pathInput);
  if (matches.length === 1) {
    const only = matches[0];
    const suffix = only.isDirectory() ? separator : "";
    return {
      nextInput: `${dirPart}${only.name}${suffix}`,
      hint: only.isDirectory() ? "Path completed (directory)." : "Path completed.",
    };
  }
  const sharedPrefix = longestCommonPrefix(matches.map((entry) => entry.name));
  if (sharedPrefix.length > partialName.length) {
    return { nextInput: `${dirPart}${sharedPrefix}`, hint: `${matches.length} matches (expanded to common prefix).` };
  }
  return { nextInput: pathInput, hint: `${matches.length} matches. Type more characters and press Tab again.` };
}

function buildMaterializeCommand(sourceTarget) {
  return `rundown materialize ${sourceTarget}`;
}

/**
 * Run listTasks against `source`, returning both the task count and a flat
 * array of tasks suitable for the running view (line + textLines).
 */
async function listTasksFromSource(source) {
  const items = [];
  const app = createApp({
    ports: {
      output: {
        emit(event) {
          if (event.kind === "task" && event.task) {
            const task = event.task;
            items.push({
              line: typeof task.line === "number" ? task.line : 0,
              textLines: Array.isArray(task.textLines) && task.textLines.length > 0
                ? task.textLines
                : [task.text ?? ""],
            });
          }
        },
      },
    },
  });

  try {
    const exitCode = await app.listTasks({ source, sortMode: "name-sort", includeAll: false });
    return { ok: exitCode === 0 || exitCode === 3, taskItems: items, exitCode };
  } catch (error) {
    return { ok: false, taskItems: items, error: String(error) };
  } finally {
    app.releaseAllLocks?.();
    await app.awaitShutdown?.();
  }
}

function getWorkerHealthSummary() {
  const outputLines = [];
  const app = createApp({
    ports: {
      output: {
        emit(event) {
          if (event.kind === "text") {
            outputLines.push(event.text);
          }
        },
      },
    },
  });

  try {
    const exitCode = app.viewWorkerHealthStatus({ json: true });
    if (exitCode !== 0) {
      return "Worker health summary unavailable.";
    }
    const jsonPayload = outputLines.join("\n").trim();
    if (jsonPayload.length === 0) {
      return "Worker health: no data.";
    }
    const parsed = JSON.parse(jsonPayload);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const fallbackOrderSnapshots = Array.isArray(parsed.fallbackOrderSnapshots) ? parsed.fallbackOrderSnapshots : [];
    const eligibleCount = entries.filter((entry) => entry?.eligible === true).length;
    const coolingDownCount = entries.filter((entry) => entry?.reason === "cooling_down").length;
    const unavailableCount = entries.filter((entry) => entry?.reason === "unavailable").length;
    return "Worker health: "
      + `${eligibleCount}/${entries.length} eligible, `
      + `${coolingDownCount} cooling down, `
      + `${unavailableCount} unavailable, `
      + `${fallbackOrderSnapshots.length} fallback snapshots.`;
  } catch (error) {
    return "Worker health unavailable: " + String(error);
  } finally {
    app.releaseAllLocks?.();
    void app.awaitShutdown?.();
  }
}

function readAgentPrompt(actionKey, workingDirectory) {
  const relativePath = AGENT_PROMPT_FILES[actionKey];
  if (!relativePath) {
    return { content: "", source: "(none)", exists: false };
  }
  const resolved = path.resolve(workingDirectory, relativePath);
  if (!fs.existsSync(resolved)) {
    return { content: "", source: relativePath, exists: false };
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    return { content, source: relativePath, exists: true };
  } catch (error) {
    return { content: "", source: relativePath, exists: false, error: String(error) };
  }
}

function renderStatusBadge(uiState, spinner) {
  if (uiState === "running") {
    return `${pc.black(pc.bgYellow(" RUNNING "))} ${pc.bold(spinner)}`;
  }
  if (uiState === "done") {
    return pc.black(pc.bgGreen(" DONE "));
  }
  if (uiState === "failed") {
    return pc.black(pc.bgRed(" FAILED "));
  }
  if (uiState === "materialize-form" || uiState === "materialize-confirm") {
    return pc.black(pc.bgCyan(" WAITING INPUT "));
  }
  return pc.black(pc.bgBlue(" READY "));
}

function pushGap(lines, count) {
  for (let index = 0; index < count; index += 1) {
    lines.push("");
  }
}

function formatLabeledValue(label, value, labelWidth) {
  const key = `${label}:`.padEnd(labelWidth + 1, " ");
  return `${pc.bold(key)} ${value}`;
}

function resolveLayoutSpacing(viewportRows) {
  if (Number.isFinite(viewportRows) && viewportRows > 0 && viewportRows < 34) {
    return {
      afterBanner: 1,
      afterStatus: 0,
      sectionGap: 1,
      menuInstructionGap: 1,
      hintGap: 1,
      errorGap: 1,
      beforeFooter: 1,
    };
  }
  return {
    afterBanner: 2,
    afterStatus: 1,
    sectionGap: 1,
    menuInstructionGap: 1,
    hintGap: 1,
    errorGap: 1,
    beforeFooter: 1,
  };
}

function createInitialRunState() {
  return {
    actionKey: null,
    actionLabel: "",
    sourceTarget: "",
    runStartedAt: 0,
    currentTaskStartedAt: 0,
    completedTasks: 0,
    totalTasks: 0,
    currentTaskIndex: -1,
    currentOperation: "scan",
    failures: 0,
    repairs: 0,
    resolvings: 0,
    resets: 0,
    recentMessages: [],
    statusMessage: "",
    finished: false,
    exitCode: null,
    error: null,
    app: null,
  };
}

function pushRecentMessage(runState, kind, message) {
  if (typeof message !== "string" || message.length === 0) {
    return;
  }
  runState.recentMessages.push({ kind, message, at: Date.now() });
  while (runState.recentMessages.length > 6) {
    runState.recentMessages.shift();
  }
}

/**
 * Maps an ApplicationOutputEvent to mutations on the run state. Drives the
 * progress display, operation phase, and aggregate counters.
 */
function applyOutputEvent(runState, event) {
  switch (event.kind) {
    case "group-start": {
      runState.currentTaskStartedAt = Date.now();
      if (event.counter) {
        if (typeof event.counter.current === "number") {
          runState.currentTaskIndex = Math.max(0, event.counter.current - 1);
        }
        if (typeof event.counter.total === "number" && event.counter.total > 0) {
          runState.totalTasks = event.counter.total;
        }
      }
      runState.currentOperation = "execute";
      runState.statusMessage = event.label ?? "";
      return;
    }
    case "group-end": {
      if (event.status === "success") {
        runState.completedTasks += 1;
        runState.currentOperation = "finalize";
      } else {
        runState.failures += 1;
        runState.currentOperation = "repair";
        if (event.message) {
          pushRecentMessage(runState, "error", event.message);
        }
      }
      return;
    }
    case "progress": {
      const progress = event.progress ?? {};
      if (typeof progress.label === "string" && progress.label.length > 0) {
        runState.currentOperation = progress.label.toLowerCase().split(/\s+/)[0] || runState.currentOperation;
      }
      if (typeof progress.detail === "string" && progress.detail.length > 0) {
        pushRecentMessage(runState, "info", progress.detail);
      }
      return;
    }
    case "info":
    case "warn":
    case "error":
    case "success": {
      const message = event.message ?? "";
      if (/repair/i.test(message)) {
        runState.repairs += 1;
        runState.currentOperation = "repair";
      } else if (/resolve|resolving/i.test(message)) {
        runState.resolvings += 1;
      } else if (/reset/i.test(message)) {
        runState.resets += 1;
      } else if (/verify|verifying/i.test(message)) {
        runState.currentOperation = "verify";
      }
      pushRecentMessage(runState, event.kind, message);
      return;
    }
    case "text":
    case "stderr":
      // Suppress raw text streams from the TUI to avoid corrupting layout.
      return;
    default:
      return;
  }
}

function buildFrame(state) {
  const {
    uiState,
    spinner,
    activeMenuKey,
    activeMaterializeMode,
    materializePathInput,
    materializePathError,
    uiHint,
    viewportRows,
    currentWorkingDirectory,
    taskItems,
    runState,
  } = state;

  const totalTasks = runState.totalTasks > 0 ? runState.totalTasks : taskItems.length;
  const completedTasks = Math.min(totalTasks, runState.completedTasks);
  const elapsedMs = runState.runStartedAt > 0 ? Date.now() - runState.runStartedAt : 0;
  const completedRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const operationPainter = operationColor[runState.currentOperation] ?? ((v) => v);
  const spacing = resolveLayoutSpacing(viewportRows);

  const banner = [
    "██████  ██   ██ ███    ██ ██████   ██████  ██     ██ ███    ██",
    "██   ██ ██   ██ ████   ██ ██   ██ ██    ██ ██     ██ ████   ██",
    "██████  ██   ██ ██ ██  ██ ██   ██ ██    ██ ██  █  ██ ██ ██  ██",
    "██   ██ ██   ██ ██  ██ ██ ██   ██ ██    ██ ██ ███ ██ ██  ██ ██",
    "██   ██  █████  ██   ████ ██████   ██████   ███ ███  ██   ████",
  ].map((line) => pc.bold(pc.magenta(line)));
  const statusToken = renderStatusBadge(uiState, spinner);

  const isComplete = runState.finished || (totalTasks > 0 && completedTasks >= totalTasks);
  const taskListIndex = runState.currentTaskIndex >= 0 ? runState.currentTaskIndex : completedTasks;
  const previousTask = isComplete
    ? taskItems[taskItems.length - 1]
    : (taskListIndex > 0 ? taskItems[taskListIndex - 1] : undefined);
  const currentTask = isComplete ? undefined : taskItems[taskListIndex];
  const nextTask = isComplete ? undefined : taskItems[taskListIndex + 1];

  const lines = [...banner];
  pushGap(lines, spacing.afterBanner);
  lines.push(`${pc.bold("Status:")} ${statusToken}`, pc.dim("=".repeat(74)));
  pushGap(lines, spacing.afterStatus);

  if (uiState === "menu") {
    const menuItems = MENU_ITEMS.map((item) => formatMenuLine(item, activeMenuKey));
    lines.push(
      `${pc.bold("Welcome:")} ${pc.white("Choose action with hotkeys.")}`,
      `${pc.bold("Start Menu:")} ${pc.dim("(press Enter to continue)")}`,
    );
    pushGap(lines, spacing.sectionGap);
    lines.push(...menuItems);
    pushGap(lines, spacing.menuInstructionGap);
    lines.push(
      pc.dim("Press M/A/O or Up/Down to select, Enter to continue, Q to quit."),
      pc.dim("Press H for worker health summary."),
    );
    if (uiHint) {
      pushGap(lines, spacing.hintGap);
      lines.push(pc.yellow(uiHint));
    }
  }

  if (uiState === "materialize-form") {
    const resolvedSource = resolveMaterializeSource(activeMaterializeMode, materializePathInput);
    const pathCheck = evaluateMaterializePath(materializePathInput, currentWorkingDirectory);
    const commandPreview = (() => {
      if (activeMaterializeMode !== "path") {
        return pc.cyan(buildMaterializeCommand(resolvedSource));
      }
      const commandPrefix = "rundown materialize ";
      if (materializePathInput.trim().length === 0) {
        return `${pc.cyan(commandPrefix)}${pc.dim("<path>")}`;
      }
      const pathToken = pathCheck.exists ? pc.green(resolvedSource) : pc.red(resolvedSource);
      return `${pc.cyan(commandPrefix)}${pathToken}`;
    })();

    const pathDisplay = (() => {
      if (activeMaterializeMode !== "path") {
        return pc.dim("(not used)");
      }
      if (materializePathInput.length > 0) {
        return `${pc.white(materializePathInput)}${pc.yellow("▌")}`;
      }
      return `${pc.yellow("▌")} ${pc.dim("(type target path...)")}`;
    })();

    lines.push(`${pc.bold("Materialize target:")} ${pc.dim("(confirm before run starts)")}`);
    pushGap(lines, spacing.sectionGap);
    lines.push(...MATERIALIZE_MODES.map((mode) => formatMaterializeModeLine(mode, activeMaterializeMode)));
    pushGap(lines, spacing.sectionGap);
    lines.push(`${pc.bold("Path input:")} ${pathDisplay}`);
    pushGap(lines, spacing.sectionGap);
    lines.push(`${pc.bold("Command:")} ${commandPreview}`);
    pushGap(lines, spacing.sectionGap);
    lines.push(
      pc.dim("Left/Right: choose target. Type path for option 2."),
      pc.dim("Tab: complete path. Ctrl+U: clear. Enter: confirm. Esc: cancel."),
    );
    if (materializePathError) {
      pushGap(lines, spacing.errorGap);
      lines.push(pc.red(materializePathError));
    }
    if (uiHint) {
      pushGap(lines, spacing.hintGap);
      lines.push(pc.yellow(uiHint));
    }
  }

  if (uiState === "materialize-confirm") {
    const resolvedSource = resolveMaterializeSource(activeMaterializeMode, materializePathInput);
    lines.push(`${pc.bold("Confirm materialize run:")}`);
    pushGap(lines, spacing.sectionGap);
    lines.push(
      `${pc.bold("Target mode:")} ${pc.white(activeMaterializeMode)}`,
      `${pc.bold("Resolved source:")} ${pc.cyan(resolvedSource)}`,
      `${pc.bold("Discovered tasks:")} ${pc.white(String(taskItems.length))}`,
      `${pc.bold("Command:")} ${pc.cyan(buildMaterializeCommand(resolvedSource))}`,
    );
    pushGap(lines, spacing.sectionGap);
    lines.push(pc.dim("Press Enter to run, Esc to edit."));
    if (uiHint) {
      pushGap(lines, spacing.hintGap);
      lines.push(pc.yellow(uiHint));
    }
  }

  if (uiState === "running" || uiState === "done" || uiState === "failed") {
    const previousTaskLines = formatTaskLines("previous", previousTask, true, "muted");
    const currentTaskLines = formatTaskLines("current", currentTask, false, "normal");
    const nextTaskLines = formatTaskLines("next", nextTask, false, "muted");
    const summaryLabelWidth = 7;
    const timingLabelWidth = 20;
    const phaseLabelWidth = 13;

    lines.push(
      formatLabeledValue("Action", pc.white(runState.actionLabel || "(none)"), summaryLabelWidth),
      formatLabeledValue("Target", pc.cyan(runState.sourceTarget || "(none)"), summaryLabelWidth),
      formatLabeledValue("Elapsed", pc.white(formatDuration(elapsedMs)), summaryLabelWidth),
      formatLabeledValue(
        "Tasks",
        `${pc.white(String(completedTasks))} / ${pc.white(String(totalTasks))}`,
        summaryLabelWidth,
      ),
    );
    pushGap(lines, spacing.sectionGap);
    lines.push(
      formatLabeledValue("Run Started", pc.white(formatTimestamp(runState.runStartedAt)), timingLabelWidth),
      formatLabeledValue(
        "Current Task Started",
        pc.white(isComplete ? "n/a (run complete)" : formatTimestamp(runState.currentTaskStartedAt)),
        timingLabelWidth,
      ),
    );
    pushGap(lines, spacing.sectionGap);
    lines.push(
      formatLabeledValue("Operation", operationPainter(runState.currentOperation.toUpperCase()), phaseLabelWidth),
      formatLabeledValue(
        "Task Progress",
        `${progressBar(40, completedRatio)} ${pc.white(`${Math.round(completedRatio * 100)}%`)}`,
        phaseLabelWidth,
      ),
    );

    if (taskItems.length > 0) {
      pushGap(lines, spacing.sectionGap);
      lines.push(...previousTaskLines);
      pushGap(lines, spacing.sectionGap);
      lines.push(...currentTaskLines);
      pushGap(lines, spacing.sectionGap);
      lines.push(...nextTaskLines);
    }

    pushGap(lines, spacing.sectionGap);
    lines.push(
      `${pc.bold("Failures:")} ${pc.white(String(runState.failures))}   ${pc.bold("Repairs:")} ${pc.white(String(runState.repairs))}`,
      `${pc.bold("Resolvings:")} ${pc.white(String(runState.resolvings))}   ${pc.bold("Resets:")} ${pc.white(String(runState.resets))}`,
    );

    if (runState.recentMessages.length > 0) {
      pushGap(lines, spacing.sectionGap);
      lines.push(pc.bold("Recent:"));
      const tail = runState.recentMessages.slice(-4);
      for (const entry of tail) {
        const painter = entry.kind === "error"
          ? pc.red
          : entry.kind === "warn"
            ? pc.yellow
            : entry.kind === "success"
              ? pc.green
              : pc.dim;
        lines.push(`  ${painter(entry.message)}`);
      }
    }

    if (uiState === "done") {
      pushGap(lines, spacing.sectionGap);
      lines.push(pc.green(`Run complete (exit ${runState.exitCode ?? 0}). Press Enter to return to menu.`));
    }
    if (uiState === "failed") {
      pushGap(lines, spacing.sectionGap);
      lines.push(pc.red(`Run failed (exit ${runState.exitCode ?? "?"}). Press Enter to return to menu.`));
      if (runState.error) {
        lines.push(pc.red(runState.error));
      }
    }
  }

  pushGap(lines, spacing.beforeFooter);
  lines.push(pc.dim("Press Ctrl+C to stop the sketch."));
  return lines;
}

function render(lines, previousLineCount) {
  if (!process.stdout.isTTY) {
    process.stdout.write(lines.join("\n") + "\n");
    return lines.length;
  }
  if (previousLineCount > 0) {
    readline.moveCursor(process.stdout, 0, -previousLineCount);
  }
  readline.cursorTo(process.stdout, 0);
  readline.clearScreenDown(process.stdout);
  process.stdout.write(lines.join("\n") + "\n");
  return lines.length;
}

function withCursorHidden() {
  if (!process.stdout.isTTY) {
    return () => {};
  }
  process.stdout.write("\u001B[?25l");
  return () => {
    process.stdout.write("\u001B[?25h");
  };
}

/**
 * Start materialize run via app.runTask in the background. Events are routed
 * through the output port into runState; the promise resolution finalizes the
 * run. Returns the App instance so the caller can release locks on shutdown.
 */
function startMaterializeRun(source, runState) {
  const app = createApp({
    ports: {
      output: {
        emit(event) {
          applyOutputEvent(runState, event);
        },
      },
    },
  });
  runState.app = app;
  runState.actionKey = "m";
  runState.actionLabel = ACTION_LABELS.m;
  runState.sourceTarget = source;
  runState.runStartedAt = Date.now();

  app
    .runTask({
      source,
      mode: "wait",
      workerPattern: { ...DEFAULT_WORKER_PATTERN },
      sortMode: "name-sort",
      verify: true,
      onlyVerify: false,
      forceExecute: false,
      forceAttempts: 0,
      noRepair: false,
      repairAttempts: 0,
      dryRun: false,
      printPrompt: false,
      keepArtifacts: false,
      clean: false,
      rounds: 1,
      varsFileOption: undefined,
      cliTemplateVarArgs: [],
      commitAfterComplete: false,
      commitMode: "per-task",
      runAll: true,
      redo: false,
      resetAfter: false,
      showAgentOutput: false,
      trace: false,
      traceOnly: false,
      verbose: false,
      forceUnlock: false,
      ignoreCliBlock: false,
    })
    .then((exitCode) => {
      runState.exitCode = exitCode;
      runState.finished = true;
      runState.currentOperation = "finalize";
    })
    .catch((error) => {
      runState.exitCode = 1;
      runState.error = error instanceof Error ? error.message : String(error);
      runState.finished = true;
      pushRecentMessage(runState, "error", runState.error);
    });

  return app;
}

/**
 * Run an interactive agent session via app.helpTask, using the provided prompt
 * content as a complete promptOverride. The worker takes over the terminal in
 * "tui" mode, so callers must tear down the TUI before invoking this.
 */
async function runAgentSession(actionKey, promptContent, runState) {
  const app = createApp();
  runState.app = app;
  runState.actionKey = actionKey;
  runState.actionLabel = ACTION_LABELS[actionKey];
  runState.sourceTarget = AGENT_PROMPT_FILES[actionKey];
  runState.runStartedAt = Date.now();
  runState.currentOperation = "agent";

  try {
    const exitCode = await app.helpTask({
      workerPattern: { ...DEFAULT_WORKER_PATTERN },
      keepArtifacts: false,
      trace: false,
      cliVersion: "cli-sketch",
      promptOverride: promptContent,
    });
    runState.exitCode = exitCode;
    runState.finished = true;
    return exitCode;
  } catch (error) {
    runState.exitCode = 1;
    runState.error = error instanceof Error ? error.message : String(error);
    runState.finished = true;
    throw error;
  }
}

async function releaseApp(app) {
  if (!app) {
    return;
  }
  try {
    app.releaseAllLocks?.();
    await app.awaitShutdown?.();
  } catch {
    // Ignore shutdown errors during cleanup.
  }
}

async function run() {
  const program = new Command();
  program
    .name("cli-sketch")
    .description("Interactive TUI bound to the rundown app surface (createApp).")
    .option("--fps <n>", "Render frames per second", parseFps, 12);
  program.parse(process.argv);
  const opts = program.opts();
  const frameMs = Math.max(30, Math.round(1000 / opts.fps));
  const currentWorkingDirectory = process.cwd();

  let previousLineCount = 0;
  let frameIndex = 0;
  let activeMenuKey = MENU_ITEMS[0].key;
  let uiState = "menu";
  let activeMaterializeMode = "migrations";
  let materializePathInput = "";
  let materializePathError = "";
  let uiHint = "";
  let taskItems = [];
  let runState = createInitialRunState();
  let interval;
  let estimationPending = false;
  let agentSessionPending = false;

  const restoreCursor = withCursorHidden();
  let finalized = false;

  const cleanup = () => {
    if (finalized) {
      return;
    }
    finalized = true;
    restoreCursor();
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
      process.stdin.pause();
      process.stdin.off("data", onInput);
    }
  };

  const stopRender = () => {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const startRender = () => {
    if (interval) {
      return;
    }
    interval = setInterval(renderFrame, frameMs);
  };

  const teardownTuiForWorker = () => {
    stopRender();
    if (process.stdout.isTTY) {
      readline.cursorTo(process.stdout, 0);
      readline.clearScreenDown(process.stdout);
      process.stdout.write("\u001B[?25h"); // show cursor
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
      process.stdin.pause();
      process.stdin.off("data", onInput);
    }
    previousLineCount = 0;
  };

  const restoreTuiAfterWorker = () => {
    if (process.stdout.isTTY) {
      process.stdout.write("\u001B[?25l"); // hide cursor
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        // ignore
      }
      process.stdin.resume();
      process.stdin.on("data", onInput);
    }
    startRender();
  };

  const resetToMenu = () => {
    uiState = "menu";
    activeMenuKey = MENU_ITEMS[0].key;
    activeMaterializeMode = "migrations";
    materializePathInput = "";
    materializePathError = "";
    uiHint = "";
    taskItems = [];
    runState = createInitialRunState();
  };

  const startMaterialize = () => {
    const resolvedSource = resolveMaterializeSource(activeMaterializeMode, materializePathInput);
    if (activeMaterializeMode === "path") {
      const pathError = validateMaterializePath(materializePathInput, currentWorkingDirectory);
      if (pathError) {
        materializePathError = pathError;
        return;
      }
    } else if (!resolvedSource) {
      materializePathError = "Specific path is empty. Type a path before pressing Enter.";
      return;
    }
    materializePathError = "";
    uiHint = "";
    runState = createInitialRunState();
    runState.totalTasks = taskItems.length;
    uiState = "running";
    startMaterializeRun(resolvedSource, runState);
  };

  const prepareMaterializeConfirm = async () => {
    if (estimationPending) {
      return;
    }
    const resolvedSource = resolveMaterializeSource(activeMaterializeMode, materializePathInput);
    if (activeMaterializeMode === "path") {
      const pathError = validateMaterializePath(materializePathInput, currentWorkingDirectory);
      if (pathError) {
        materializePathError = pathError;
        return;
      }
    }
    materializePathError = "";
    estimationPending = true;
    uiHint = "Loading task list...";

    try {
      const result = await listTasksFromSource(resolvedSource);
      if (result.ok) {
        taskItems = result.taskItems;
        uiHint = "";
      } else {
        taskItems = result.taskItems;
        uiHint = `listTasks exited with code ${result.exitCode ?? "?"}.`;
      }
      uiState = "materialize-confirm";
    } catch (error) {
      uiHint = "Failed to list tasks: " + String(error);
    } finally {
      estimationPending = false;
    }
  };

  const startAgentMenuAction = async (actionKey) => {
    if (agentSessionPending) {
      return;
    }
    const promptResult = readAgentPrompt(actionKey, currentWorkingDirectory);
    if (!promptResult.exists || promptResult.content.trim().length === 0) {
      uiHint = `Prompt file not found or empty: ${promptResult.source}`;
      return;
    }

    agentSessionPending = true;
    uiHint = "";
    runState = createInitialRunState();
    teardownTuiForWorker();

    let app = null;
    try {
      const sessionPromise = runAgentSession(actionKey, promptResult.content, runState);
      app = runState.app;
      await sessionPromise;
    } catch {
      // Error is captured on runState.
    } finally {
      await releaseApp(app);
      runState.app = null;
      agentSessionPending = false;
      uiState = runState.exitCode === 0 ? "done" : "failed";
      restoreTuiAfterWorker();
    }
  };

  function onInput(chunk) {
    const rawInput = String(chunk);
    const input = rawInput.toLowerCase();

    if (rawInput === "\u0003") {
      stopRender();
      void releaseApp(runState.app).finally(() => {
        cleanup();
        process.stdout.write("\n");
        process.exit(130);
      });
      return;
    }

    if (input === "q" && (uiState === "menu" || uiState === "done" || uiState === "failed")) {
      stopRender();
      void releaseApp(runState.app).finally(() => {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
      });
      return;
    }

    const isEnter = rawInput === "\r" || rawInput === "\n";
    const isEscape = rawInput === "\u001b";
    const isBackspace = rawInput === "\b" || rawInput === "\u007f";
    const isTab = rawInput === "\t";
    const isCtrlU = rawInput === "\u0015";
    const isArrowUp = rawInput === "\u001b[A";
    const isArrowDown = rawInput === "\u001b[B";
    const isArrowRight = rawInput === "\u001b[C";
    const isArrowLeft = rawInput === "\u001b[D";

    if (uiState === "menu") {
      if (isArrowUp || isArrowDown) {
        const currentIndex = MENU_ITEMS.findIndex((item) => item.key === activeMenuKey);
        const baseIndex = currentIndex >= 0 ? currentIndex : 0;
        const direction = isArrowUp ? -1 : 1;
        const nextIndex = (baseIndex + direction + MENU_ITEMS.length) % MENU_ITEMS.length;
        activeMenuKey = MENU_ITEMS[nextIndex].key;
        uiHint = "";
        return;
      }

      if (input === "h") {
        uiHint = getWorkerHealthSummary();
        return;
      }

      for (const item of MENU_ITEMS) {
        if (input === item.key) {
          activeMenuKey = item.key;
          uiHint = "";
          return;
        }
      }

      if (isEnter) {
        if (activeMenuKey === "m") {
          uiState = "materialize-form";
          return;
        }
        if (activeMenuKey === "a" || activeMenuKey === "o") {
          void startAgentMenuAction(activeMenuKey);
          return;
        }
      }
      return;
    }

    if (uiState === "materialize-form") {
      if (isEscape) {
        resetToMenu();
        return;
      }
      if (isArrowLeft || isArrowRight || isArrowUp || isArrowDown) {
        const currentIndex = MATERIALIZE_MODES.findIndex((mode) => mode.id === activeMaterializeMode);
        const baseIndex = currentIndex >= 0 ? currentIndex : 0;
        const direction = (isArrowLeft || isArrowUp) ? -1 : 1;
        const nextIndex = (baseIndex + direction + MATERIALIZE_MODES.length) % MATERIALIZE_MODES.length;
        activeMaterializeMode = MATERIALIZE_MODES[nextIndex].id;
        materializePathError = "";
        uiHint = "";
        return;
      }

      if (activeMaterializeMode === "path") {
        if (isCtrlU) {
          materializePathInput = "";
          materializePathError = "";
          uiHint = "";
          return;
        }
        if (isBackspace) {
          materializePathInput = materializePathInput.slice(0, -1);
          materializePathError = "";
          uiHint = "";
          return;
        }
        if (isTab) {
          const completion = completeMaterializePathInput(materializePathInput, currentWorkingDirectory);
          materializePathInput = completion.nextInput;
          materializePathError = "";
          uiHint = completion.hint;
          return;
        }
        if (/^[\x20-\x7E]$/.test(rawInput)) {
          materializePathInput += rawInput;
          materializePathError = "";
          uiHint = "";
          return;
        }
      }

      if (input === "1") {
        activeMaterializeMode = "migrations";
        materializePathError = "";
        uiHint = "";
        return;
      }
      if (input === "2") {
        activeMaterializeMode = "path";
        materializePathError = "";
        uiHint = "";
        return;
      }

      if (isEnter) {
        void prepareMaterializeConfirm();
        return;
      }
      return;
    }

    if (uiState === "materialize-confirm") {
      if (isEscape) {
        uiState = "materialize-form";
        uiHint = "";
        return;
      }
      if (isEnter) {
        startMaterialize();
      }
      return;
    }

    if ((uiState === "done" || uiState === "failed") && isEnter) {
      void releaseApp(runState.app).finally(() => {
        runState.app = null;
        resetToMenu();
      });
    }
  }

  const renderFrame = () => {
    const spinner = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    const lines = buildFrame({
      uiState,
      spinner,
      activeMenuKey,
      activeMaterializeMode,
      materializePathInput,
      materializePathError,
      uiHint,
      viewportRows: process.stdout.isTTY ? process.stdout.rows : undefined,
      currentWorkingDirectory,
      taskItems,
      runState,
    });
    previousLineCount = render(lines, previousLineCount);
    frameIndex += 1;

    if (uiState === "running" && runState.finished) {
      uiState = runState.exitCode === 0 ? "done" : "failed";
    }
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onInput);
  }

  startRender();

  process.on("SIGINT", () => {
    stopRender();
    void releaseApp(runState.app).finally(() => {
      cleanup();
      process.stdout.write("\n");
      process.exit(130);
    });
  });

  process.on("SIGTERM", () => {
    stopRender();
    void releaseApp(runState.app).finally(() => {
      cleanup();
      process.exit(143);
    });
  });

  process.on("exit", cleanup);
}

void run();
