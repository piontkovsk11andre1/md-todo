import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { createApp } from "../../../create-app.js";
import {
  formatDuration,
  formatMaterializeModeLine,
  formatTaskLines,
  formatTimestamp,
  progressBar,
} from "../layout.js";
import { applyOutputEvent, createInitialRunState, pushRecentMessage } from "../output-bridge.js";

export const MATERIALIZE_MODES = [
  { key: "1", id: "migrations", label: "Materialize Migrations" },
  { key: "2", id: "path", label: "Materialize Specific Path" },
];

const DEFAULT_WORKER_PATTERN = {
  command: [],
  usesBootstrap: false,
  usesFile: false,
  appendFile: true,
};

function resolvePathSeparator(pathInput) {
  if (pathInput.includes("/") && !pathInput.includes("\\")) {
    return "/";
  }
  return path.sep;
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


export function resolveMaterializeSource(activeMaterializeMode, customPath) {
  if (activeMaterializeMode === "migrations") {
    return "migrations/";
  }
  return customPath.trim();
}

export function evaluateMaterializePath(pathInput, workingDirectory) {
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

export function validateMaterializePath(pathInput, workingDirectory) {
  return evaluateMaterializePath(pathInput, workingDirectory).error;
}

export function completeMaterializePathInput(pathInput, workingDirectory) {
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

export function buildMaterializeCommand(sourceTarget) {
  return `rundown materialize ${sourceTarget}`;
}

export async function listTasksFromSource(source) {
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

export function startMaterializeRun(source, runState) {
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
  runState.actionLabel = "materialize";
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

const CONTINUE_UI_STATES = new Set([
  "materialize-form",
  "materialize-confirm",
  "running",
  "done",
  "failed",
]);

const OPERATION_COLOR = {
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

function formatLabeledValue(label, value, labelWidth) {
  const key = `${label}:`.padEnd(labelWidth + 1, " ");
  return `${pc.bold(key)} ${value}`;
}

function pushGap(lines, count) {
  for (let index = 0; index < count; index += 1) {
    lines.push("");
  }
}

export function createContinueSceneState() {
  return {
    activeMaterializeMode: "migrations",
    materializePathInput: "",
    materializePathError: "",
    uiHint: "",
    taskItems: [],
    estimationPending: false,
  };
}

export function isContinueUiState(uiState) {
  return CONTINUE_UI_STATES.has(uiState);
}

export function updateContinueUiState(uiState, runState) {
  if (uiState === "running" && runState?.finished) {
    return runState.exitCode === 0 ? "done" : "failed";
  }
  return uiState;
}

export function renderContinueSceneLines({
  uiState,
  state,
  runState,
  currentWorkingDirectory,
  sectionGap,
  hintGap,
  errorGap,
}) {
  const lines = [];
  const taskItems = state.taskItems;
  const totalTasks = runState.totalTasks > 0 ? runState.totalTasks : taskItems.length;
  const completedTasks = Math.min(totalTasks, runState.completedTasks);
  const elapsedMs = runState.runStartedAt > 0 ? Date.now() - runState.runStartedAt : 0;
  const completedRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const operationPainter = OPERATION_COLOR[runState.currentOperation] ?? ((value) => value);

  if (uiState === "materialize-form") {
    const resolvedSource = resolveMaterializeSource(state.activeMaterializeMode, state.materializePathInput);
    const pathCheck = evaluateMaterializePath(state.materializePathInput, currentWorkingDirectory);
    const commandPreview = (() => {
      if (state.activeMaterializeMode !== "path") {
        return pc.cyan(buildMaterializeCommand(resolvedSource));
      }
      const commandPrefix = "rundown materialize ";
      if (state.materializePathInput.trim().length === 0) {
        return `${pc.cyan(commandPrefix)}${pc.dim("<path>")}`;
      }
      const pathToken = pathCheck.exists ? pc.green(resolvedSource) : pc.red(resolvedSource);
      return `${pc.cyan(commandPrefix)}${pathToken}`;
    })();

    const pathDisplay = (() => {
      if (state.activeMaterializeMode !== "path") {
        return pc.dim("(not used)");
      }
      if (state.materializePathInput.length > 0) {
        return `${pc.white(state.materializePathInput)}${pc.yellow("▌")}`;
      }
      return `${pc.yellow("▌")} ${pc.dim("(type target path...)")}`;
    })();

    lines.push(`${pc.bold("Materialize target:")} ${pc.dim("(confirm before run starts)")}`);
    pushGap(lines, sectionGap);
    lines.push(...MATERIALIZE_MODES.map((mode) => formatMaterializeModeLine(mode, state.activeMaterializeMode)));
    pushGap(lines, sectionGap);
    lines.push(`${pc.bold("Path input:")} ${pathDisplay}`);
    pushGap(lines, sectionGap);
    lines.push(`${pc.bold("Command:")} ${commandPreview}`);
    pushGap(lines, sectionGap);
    lines.push(
      pc.dim("Left/Right: choose target. Type path for option 2."),
      pc.dim("Tab: complete path. Ctrl+U: clear. Enter: confirm. Esc: cancel."),
    );
    if (state.materializePathError) {
      pushGap(lines, errorGap);
      lines.push(pc.red(state.materializePathError));
    }
    if (state.uiHint) {
      pushGap(lines, hintGap);
      lines.push(pc.yellow(state.uiHint));
    }
    return lines;
  }

  if (uiState === "materialize-confirm") {
    const resolvedSource = resolveMaterializeSource(state.activeMaterializeMode, state.materializePathInput);
    lines.push(`${pc.bold("Confirm materialize run:")}`);
    pushGap(lines, sectionGap);
    lines.push(
      `${pc.bold("Target mode:")} ${pc.white(state.activeMaterializeMode)}`,
      `${pc.bold("Resolved source:")} ${pc.cyan(resolvedSource)}`,
      `${pc.bold("Discovered tasks:")} ${pc.white(String(state.taskItems.length))}`,
      `${pc.bold("Command:")} ${pc.cyan(buildMaterializeCommand(resolvedSource))}`,
    );
    pushGap(lines, sectionGap);
    lines.push(pc.dim("Press Enter to run, Esc to edit."));
    if (state.uiHint) {
      pushGap(lines, hintGap);
      lines.push(pc.yellow(state.uiHint));
    }
    return lines;
  }

  if (uiState === "running" || uiState === "done" || uiState === "failed") {
    const isComplete = runState.finished || (totalTasks > 0 && completedTasks >= totalTasks);
    const taskListIndex = runState.currentTaskIndex >= 0 ? runState.currentTaskIndex : completedTasks;
    const previousTask = isComplete
      ? taskItems[taskItems.length - 1]
      : (taskListIndex > 0 ? taskItems[taskListIndex - 1] : undefined);
    const currentTask = isComplete ? undefined : taskItems[taskListIndex];
    const nextTask = isComplete ? undefined : taskItems[taskListIndex + 1];

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
    pushGap(lines, sectionGap);
    lines.push(
      formatLabeledValue("Run Started", pc.white(formatTimestamp(runState.runStartedAt)), timingLabelWidth),
      formatLabeledValue(
        "Current Task Started",
        pc.white(isComplete ? "n/a (run complete)" : formatTimestamp(runState.currentTaskStartedAt)),
        timingLabelWidth,
      ),
    );
    pushGap(lines, sectionGap);
    lines.push(
      formatLabeledValue("Operation", operationPainter(runState.currentOperation.toUpperCase()), phaseLabelWidth),
      formatLabeledValue(
        "Task Progress",
        `${progressBar(40, completedRatio)} ${pc.white(`${Math.round(completedRatio * 100)}%`)}`,
        phaseLabelWidth,
      ),
    );

    if (taskItems.length > 0) {
      pushGap(lines, sectionGap);
      lines.push(...previousTaskLines);
      pushGap(lines, sectionGap);
      lines.push(...currentTaskLines);
      pushGap(lines, sectionGap);
      lines.push(...nextTaskLines);
    }

    pushGap(lines, sectionGap);
    lines.push(
      `${pc.bold("Failures:")} ${pc.white(String(runState.failures))}   ${pc.bold("Repairs:")} ${pc.white(String(runState.repairs))}`,
      `${pc.bold("Resolvings:")} ${pc.white(String(runState.resolvings))}   ${pc.bold("Resets:")} ${pc.white(String(runState.resets))}`,
    );

    if (runState.recentMessages.length > 0) {
      pushGap(lines, sectionGap);
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
      pushGap(lines, sectionGap);
      lines.push(pc.green(`Run complete (exit ${runState.exitCode ?? 0}). Press Enter to return to menu.`));
    }
    if (uiState === "failed") {
      pushGap(lines, sectionGap);
      lines.push(pc.red(`Run failed (exit ${runState.exitCode ?? "?"}). Press Enter to return to menu.`));
      if (runState.error) {
        lines.push(pc.red(runState.error));
      }
    }
    return lines;
  }

  return lines;
}

export async function handleContinueInput({
  rawInput,
  uiState,
  state,
  runState,
  currentWorkingDirectory,
}) {
  const input = String(rawInput).toLowerCase();
  const isEnter = rawInput === "\r" || rawInput === "\n";
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  const isTab = rawInput === "\t";
  const isCtrlU = rawInput === "\u0015";
  const isArrowUp = rawInput === "\u001b[A";
  const isArrowDown = rawInput === "\u001b[B";
  const isArrowRight = rawInput === "\u001b[C";
  const isArrowLeft = rawInput === "\u001b[D";

  if (uiState === "materialize-form") {
    if (isEscape) {
      return {
        handled: true,
        uiState,
        state: createContinueSceneState(),
        runState: createInitialRunState(),
        backToParent: true,
      };
    }

    if (isArrowLeft || isArrowRight || isArrowUp || isArrowDown) {
      const currentIndex = MATERIALIZE_MODES.findIndex((mode) => mode.id === state.activeMaterializeMode);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const direction = (isArrowLeft || isArrowUp) ? -1 : 1;
      const nextIndex = (baseIndex + direction + MATERIALIZE_MODES.length) % MATERIALIZE_MODES.length;
      return {
        handled: true,
        uiState,
        state: {
          ...state,
          activeMaterializeMode: MATERIALIZE_MODES[nextIndex].id,
          materializePathError: "",
          uiHint: "",
        },
        runState,
        backToParent: false,
      };
    }

    if (state.activeMaterializeMode === "path") {
      if (isCtrlU) {
        return {
          handled: true,
          uiState,
          state: { ...state, materializePathInput: "", materializePathError: "", uiHint: "" },
          runState,
          backToParent: false,
        };
      }
      if (isBackspace) {
        return {
          handled: true,
          uiState,
          state: {
            ...state,
            materializePathInput: state.materializePathInput.slice(0, -1),
            materializePathError: "",
            uiHint: "",
          },
          runState,
          backToParent: false,
        };
      }
      if (isTab) {
        const completion = completeMaterializePathInput(state.materializePathInput, currentWorkingDirectory);
        return {
          handled: true,
          uiState,
          state: {
            ...state,
            materializePathInput: completion.nextInput,
            materializePathError: "",
            uiHint: completion.hint,
          },
          runState,
          backToParent: false,
        };
      }
      if (/^[\x20-\x7E]$/.test(rawInput)) {
        return {
          handled: true,
          uiState,
          state: {
            ...state,
            materializePathInput: state.materializePathInput + rawInput,
            materializePathError: "",
            uiHint: "",
          },
          runState,
          backToParent: false,
        };
      }
    }

    if (input === "1") {
      return {
        handled: true,
        uiState,
        state: { ...state, activeMaterializeMode: "migrations", materializePathError: "", uiHint: "" },
        runState,
        backToParent: false,
      };
    }
    if (input === "2") {
      return {
        handled: true,
        uiState,
        state: { ...state, activeMaterializeMode: "path", materializePathError: "", uiHint: "" },
        runState,
        backToParent: false,
      };
    }

    if (isEnter) {
      if (state.estimationPending) {
        return { handled: true, uiState, state, runState, backToParent: false };
      }
      const resolvedSource = resolveMaterializeSource(state.activeMaterializeMode, state.materializePathInput);
      if (state.activeMaterializeMode === "path") {
        const pathError = validateMaterializePath(state.materializePathInput, currentWorkingDirectory);
        if (pathError) {
          return {
            handled: true,
            uiState,
            state: { ...state, materializePathError: pathError },
            runState,
            backToParent: false,
          };
        }
      }

      const nextState = {
        ...state,
        materializePathError: "",
        estimationPending: true,
        uiHint: "Loading task list...",
      };
      try {
        const result = await listTasksFromSource(resolvedSource);
        return {
          handled: true,
          uiState: "materialize-confirm",
          state: {
            ...nextState,
            estimationPending: false,
            taskItems: result.taskItems,
            uiHint: result.ok ? "" : `listTasks exited with code ${result.exitCode ?? "?"}.`,
          },
          runState,
          backToParent: false,
        };
      } catch (error) {
        return {
          handled: true,
          uiState,
          state: {
            ...nextState,
            estimationPending: false,
            uiHint: "Failed to list tasks: " + String(error),
          },
          runState,
          backToParent: false,
        };
      }
    }

    return { handled: false, uiState, state, runState, backToParent: false };
  }

  if (uiState === "materialize-confirm") {
    if (isEscape) {
      return {
        handled: true,
        uiState: "materialize-form",
        state: { ...state, uiHint: "" },
        runState,
        backToParent: false,
      };
    }
    if (isEnter) {
      const resolvedSource = resolveMaterializeSource(state.activeMaterializeMode, state.materializePathInput);
      if (state.activeMaterializeMode === "path") {
        const pathError = validateMaterializePath(state.materializePathInput, currentWorkingDirectory);
        if (pathError) {
          return {
            handled: true,
            uiState: "materialize-form",
            state: { ...state, materializePathError: pathError },
            runState,
            backToParent: false,
          };
        }
      }
      const nextRunState = createInitialRunState();
      nextRunState.totalTasks = state.taskItems.length;
      startMaterializeRun(resolvedSource, nextRunState);
      return {
        handled: true,
        uiState: "running",
        state: { ...state, materializePathError: "", uiHint: "" },
        runState: nextRunState,
        backToParent: false,
      };
    }
    return { handled: false, uiState, state, runState, backToParent: false };
  }

  if ((uiState === "done" || uiState === "failed") && isEnter) {
    return {
      handled: true,
      uiState,
      state: createContinueSceneState(),
      runState: createInitialRunState(),
      backToParent: true,
    };
  }

  return { handled: false, uiState, state, runState, backToParent: false };
}
