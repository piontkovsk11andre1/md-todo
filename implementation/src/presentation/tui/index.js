import { Command, InvalidArgumentError } from "commander";
import pc from "picocolors";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { createApp } from "../../create-app.js";
import {
  createContinueSceneState,
  createInitialRunState,
  handleContinueInput,
  isContinueUiState,
  renderContinueSceneLines,
  updateContinueUiState,
} from "./scenes/continue.js";
import { isNewWorkActionKey, startNewWorkSceneAction } from "./scenes/new-work.js";

const SPINNER_FRAMES = ["-", "\\", "|", "/"];

const MENU_ITEMS = [
  { key: "m", label: "Materialize" },
  { key: "a", label: "Discuss the Agent" },
  { key: "o", label: "Open Agent" },
];

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

function formatMenuLine(item, activeKey) {
  const isActive = item.key === activeKey;
  const keyToken = isActive ? pc.black(pc.bgYellow(` ${item.key.toUpperCase()} `)) : pc.cyan(`[${item.key.toUpperCase()}]`);
  const label = isActive ? pc.bold(pc.yellow(item.label)) : pc.white(item.label);
  return `${keyToken} ${label}`;
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


function buildFrame(state) {
  const {
    uiState,
    spinner,
    activeMenuKey,
    uiHint,
    viewportRows,
    currentWorkingDirectory,
    continueSceneState,
    runState,
  } = state;
  const spacing = resolveLayoutSpacing(viewportRows);

  const banner = [
    "██████  ██   ██ ███    ██ ██████   ██████  ██     ██ ███    ██",
    "██   ██ ██   ██ ████   ██ ██   ██ ██    ██ ██     ██ ████   ██",
    "██████  ██   ██ ██ ██  ██ ██   ██ ██    ██ ██  █  ██ ██ ██  ██",
    "██   ██ ██   ██ ██  ██ ██ ██   ██ ██    ██ ██ ███ ██ ██  ██ ██",
    "██   ██  █████  ██   ████ ██████   ██████   ███ ███  ██   ████",
  ].map((line) => pc.bold(pc.magenta(line)));
  const statusToken = renderStatusBadge(uiState, spinner);

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

  if (isContinueUiState(uiState)) {
    const continueLines = renderContinueSceneLines({
      uiState,
      state: continueSceneState,
      runState,
      currentWorkingDirectory,
      sectionGap: spacing.sectionGap,
      hintGap: spacing.hintGap,
      errorGap: spacing.errorGap,
    });
    lines.push(...continueLines);
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

function resolveProcessArgv(argv) {
  if (Array.isArray(argv)) {
    return ["node", "tui", ...argv];
  }
  return process.argv;
}

export async function runRootTui({ app, workerPattern, cliVersion, argv } = {}) {
  void app;
  void workerPattern;
  void cliVersion;

  const program = new Command();
  program
    .name("tui")
    .description("Interactive TUI bound to the rundown app surface (createApp).")
    .allowUnknownOption(true)
    .option("--fps <n>", "Render frames per second", parseFps, 12);
  try {
    program.exitOverride();
    program.parse(resolveProcessArgv(argv));
  } catch (error) {
    const exitCode = typeof error?.exitCode === "number" ? error.exitCode : 1;
    return exitCode;
  }
  const opts = program.opts();
  const frameMs = Math.max(30, Math.round(1000 / opts.fps));
  const currentWorkingDirectory = process.cwd();

  return await new Promise((resolve) => {
    let settled = false;

    const finish = (exitCode, { newline = false } = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      stopRender();
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      process.off("exit", cleanup);
      cleanup();
      if (newline) {
        process.stdout.write("\n");
      }
      resolve(exitCode);
    };

  let previousLineCount = 0;
  let frameIndex = 0;
  let activeMenuKey = MENU_ITEMS[0].key;
    let uiState = "menu";
    let uiHint = "";
    let continueSceneState = createContinueSceneState();
    let runState = createInitialRunState();
    let interval;
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
      uiHint = "";
      continueSceneState = createContinueSceneState();
      runState = createInitialRunState();
    };

    const startNewWorkMenuAction = async (actionKey) => {
      if (agentSessionPending) {
        return;
      }

      agentSessionPending = true;
      uiHint = "";
      runState = createInitialRunState();

      const result = await startNewWorkSceneAction({
        actionKey,
        currentWorkingDirectory,
        runState,
        teardownTuiForWorker,
        restoreTuiAfterWorker,
        releaseApp,
      });

      agentSessionPending = false;
      if (!result.started) {
        uiHint = result.hint;
        return;
      }
      uiState = runState.exitCode === 0 ? "done" : "failed";
    };

    function onInput(chunk) {
      const rawInput = String(chunk);
      const input = rawInput.toLowerCase();

      if (rawInput === "\u0003") {
        stopRender();
        void releaseApp(runState.app).finally(() => {
          finish(130, { newline: true });
        });
        return;
      }

      if (input === "q" && (uiState === "menu" || uiState === "done" || uiState === "failed")) {
        stopRender();
        void releaseApp(runState.app).finally(() => {
          finish(0, { newline: true });
        });
        return;
      }

      const isEnter = rawInput === "\r" || rawInput === "\n";
      const isArrowUp = rawInput === "\u001b[A";
      const isArrowDown = rawInput === "\u001b[B";

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
            continueSceneState = createContinueSceneState();
            uiState = "materialize-form";
            return;
          }
        if (isNewWorkActionKey(activeMenuKey)) {
          void startNewWorkMenuAction(activeMenuKey);
          return;
        }
      }
      return;
    }

    if (isContinueUiState(uiState)) {
      void handleContinueInput({
        rawInput,
        uiState,
        state: continueSceneState,
        runState,
        currentWorkingDirectory,
      }).then((result) => {
        if (!result?.handled) {
          return;
        }
        uiState = result.uiState;
        continueSceneState = result.state;
        runState = result.runState;
        if (result.backToParent) {
          void releaseApp(runState.app).finally(() => {
            runState.app = null;
            resetToMenu();
          });
        }
      });
    }
    }

    const renderFrame = () => {
      const spinner = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
      const lines = buildFrame({
        uiState,
        spinner,
        activeMenuKey,
        uiHint,
        viewportRows: process.stdout.isTTY ? process.stdout.rows : undefined,
        currentWorkingDirectory,
        continueSceneState,
        runState,
      });
      previousLineCount = render(lines, previousLineCount);
      frameIndex += 1;
      uiState = updateContinueUiState(uiState, runState);
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", onInput);
    }

    startRender();

    const onSigint = () => {
      stopRender();
      void releaseApp(runState.app).finally(() => {
        finish(130, { newline: true });
      });
    };

    const onSigterm = () => {
      stopRender();
      void releaseApp(runState.app).finally(() => {
        finish(143);
      });
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    process.on("exit", cleanup);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void runRootTui().then((exitCode) => {
    process.exit(exitCode);
  });
}
