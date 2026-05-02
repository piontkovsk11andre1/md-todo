import { Command, InvalidArgumentError } from "commander";
import { pathToFileURL } from "node:url";
import {
  createContinueSceneState,
  handleContinueInput,
  renderContinueSceneLines,
  updateContinueUiState,
} from "./scenes/continue.js";
import {
  createMainMenuSceneState,
  getMainMenuRows,
  getSelectedMainMenuItem,
  jumpMainMenuSelection,
  moveMainMenuSelection,
} from "./scenes/main-menu.js";
import { startNewWorkSceneAction } from "./scenes/new-work.js";
import { createWorkersSceneState, handleWorkersInput, renderWorkersSceneLines } from "./scenes/workers.js";
import { createProfilesSceneState, handleProfilesInput, renderProfilesSceneLines } from "./scenes/profiles.js";
import { createSettingsSceneState, handleSettingsInput, renderSettingsSceneLines } from "./scenes/settings.js";
import { createHelpSceneState, handleHelpInput, renderHelpSceneLines } from "./scenes/help.js";
import { SPINNER_FRAMES, buildFrame, getSceneSpacing, render, renderStatusBadge, withCursorHidden } from "./layout.js";
import { createInitialRunState, releaseApp, resolveProcessArgv } from "./output-bridge.js";

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

function createSceneRouterState() {
  return {
    sceneId: "mainMenu",
    showHelpOverlay: false,
    mainMenuHint: "",
    mainMenuState: createMainMenuSceneState(),
    continueUiState: "materialize-form",
    continueSceneState: createContinueSceneState(),
    runState: createInitialRunState(),
    workersSceneState: createWorkersSceneState(),
    profilesSceneState: createProfilesSceneState(),
    settingsSceneState: createSettingsSceneState(),
    helpSceneState: createHelpSceneState(),
    agentSessionPending: false,
  };
}

function isArrowUp(rawInput) {
  return rawInput === "\u001b[A";
}

function isArrowDown(rawInput) {
  return rawInput === "\u001b[B";
}

function isBack(rawInput) {
  return rawInput === "\u001b" || rawInput === "\b" || rawInput === "\u007f";
}

function resetToMainMenu(state) {
  state.sceneId = "mainMenu";
  state.showHelpOverlay = false;
  state.mainMenuState = createMainMenuSceneState();
  state.continueUiState = "materialize-form";
  state.continueSceneState = createContinueSceneState();
  state.runState = createInitialRunState();
}

function routeFromMainMenu(state, routeTo, launchNewWork) {
  state.showHelpOverlay = false;
  if (routeTo === "continue") {
    state.sceneId = "continue";
    state.continueUiState = "materialize-form";
    state.continueSceneState = createContinueSceneState();
    state.runState = createInitialRunState();
    return;
  }
  if (routeTo === "newWork") {
    void launchNewWork();
    return;
  }
  if (routeTo === "workers" || routeTo === "profiles" || routeTo === "settings" || routeTo === "help") {
    state.sceneId = routeTo;
  }
}

function applySharedNavigationGrammar(state, rawInput) {
  const input = String(rawInput).toLowerCase();
  if (isArrowUp(rawInput) || input === "k") {
    state.mainMenuState = moveMainMenuSelection(state.mainMenuState, -1);
    return true;
  }
  if (isArrowDown(rawInput) || input === "j") {
    state.mainMenuState = moveMainMenuSelection(state.mainMenuState, 1);
    return true;
  }
  if (/^[1-9]$/.test(input)) {
    state.mainMenuState = jumpMainMenuSelection(state.mainMenuState, input);
    return true;
  }
  return false;
}

function buildSceneLines(state, spacing, currentWorkingDirectory) {
  if (state.sceneId === "continue") {
    return renderContinueSceneLines({
      uiState: state.continueUiState,
      state: state.continueSceneState,
      runState: state.runState,
      currentWorkingDirectory,
      sectionGap: spacing.sectionGap,
      hintGap: spacing.hintGap,
      errorGap: spacing.errorGap,
    });
  }
  if (state.sceneId === "newWork") {
    return [
      "New Work",
      "Launching existing agent flow...",
      "Press Esc to return if launch has not started yet.",
    ];
  }
  if (state.sceneId === "workers") {
    return renderWorkersSceneLines({ state: state.workersSceneState, sectionGap: spacing.sectionGap });
  }
  if (state.sceneId === "profiles") {
    return renderProfilesSceneLines({ state: state.profilesSceneState, sectionGap: spacing.sectionGap });
  }
  if (state.sceneId === "settings") {
    return renderSettingsSceneLines({ state: state.settingsSceneState, sectionGap: spacing.sectionGap });
  }
  if (state.sceneId === "help") {
    return renderHelpSceneLines({ state: state.helpSceneState, sectionGap: spacing.sectionGap });
  }
  return [];
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
    const state = createSceneRouterState();
    let settled = false;
    let finalized = false;
    let previousLineCount = 0;
    let frameIndex = 0;
    let interval;

    const restoreCursor = withCursorHidden();

    const stopRender = () => {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    const startRender = () => {
      if (!interval) {
        interval = setInterval(renderFrame, frameMs);
      }
    };

    const teardownTuiForWorker = () => {
      stopRender();
      if (process.stdout.isTTY) {
        process.stdout.write("\u001B[?25h");
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
        process.stdout.write("\u001B[?25l");
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

    const launchNewWork = async () => {
      if (state.agentSessionPending) {
        return;
      }
      state.agentSessionPending = true;
      state.sceneId = "newWork";
      state.showHelpOverlay = false;
      state.mainMenuHint = "";
      state.runState = createInitialRunState();

      const result = await startNewWorkSceneAction({
        actionKey: "o",
        currentWorkingDirectory,
        runState: state.runState,
        teardownTuiForWorker,
        restoreTuiAfterWorker,
        releaseApp,
      });

      state.agentSessionPending = false;
      state.sceneId = "mainMenu";
      if (!result.started) {
        state.mainMenuHint = result.hint;
        return;
      }
      state.mainMenuHint = state.runState.exitCode === 0
        ? "New Work session ended."
        : `New Work failed (exit ${state.runState.exitCode ?? "?"}).`;
    };

    function onInput(chunk) {
      const rawInput = String(chunk);
      const input = rawInput.toLowerCase();
      const isEnter = rawInput === "\r" || rawInput === "\n";

      if (rawInput === "\u0003") {
        stopRender();
        void releaseApp(state.runState.app).finally(() => {
          finish(130, { newline: true });
        });
        return;
      }

      if (input === "q") {
        stopRender();
        void releaseApp(state.runState.app).finally(() => {
          finish(0, { newline: true });
        });
        return;
      }

      if (input === "?" || input === "h") {
        state.showHelpOverlay = !state.showHelpOverlay;
        return;
      }

      if (state.showHelpOverlay) {
        if (isBack(rawInput) || input === "?" || input === "h") {
          state.showHelpOverlay = false;
        }
        return;
      }

      const sharedNavigationHandled = applySharedNavigationGrammar(state, rawInput);

      if (state.sceneId === "mainMenu") {
        state.mainMenuHint = "";
        if (isEnter) {
          const selected = getSelectedMainMenuItem(state.mainMenuState);
          if (selected?.sceneId) {
            routeFromMainMenu(state, selected.sceneId, launchNewWork);
          }
          return;
        }
        if (sharedNavigationHandled) {
          return;
        }
      }

      if (state.sceneId === "continue") {
        void handleContinueInput({
          rawInput,
          uiState: state.continueUiState,
          state: state.continueSceneState,
          runState: state.runState,
          currentWorkingDirectory,
        }).then((result) => {
          if (result?.handled) {
            state.continueUiState = result.uiState;
            state.continueSceneState = result.state;
            state.runState = result.runState;
            if (result.backToParent) {
              void releaseApp(state.runState.app).finally(() => {
                state.runState.app = null;
                resetToMainMenu(state);
              });
            }
            return;
          }
          if (isBack(rawInput)) {
            void releaseApp(state.runState.app).finally(() => {
              state.runState.app = null;
              resetToMainMenu(state);
            });
          }
        });
        return;
      }

      if (state.sceneId === "newWork") {
        if (isBack(rawInput)) {
          state.sceneId = "mainMenu";
        }
        return;
      }

      if (state.sceneId === "workers") {
        const result = handleWorkersInput({ rawInput, state: state.workersSceneState });
        state.workersSceneState = result.state;
        if (result.backToParent || isBack(rawInput)) {
          state.sceneId = "mainMenu";
        }
        return;
      }

      if (state.sceneId === "profiles") {
        const result = handleProfilesInput({ rawInput, state: state.profilesSceneState });
        state.profilesSceneState = result.state;
        if (result.backToParent || isBack(rawInput)) {
          state.sceneId = "mainMenu";
        }
        return;
      }

      if (state.sceneId === "settings") {
        const result = handleSettingsInput({ rawInput, state: state.settingsSceneState });
        state.settingsSceneState = result.state;
        if (result.backToParent || isBack(rawInput)) {
          state.sceneId = "mainMenu";
        }
        return;
      }

      if (state.sceneId === "help") {
        const result = handleHelpInput({ rawInput, state: state.helpSceneState });
        state.helpSceneState = result.state;
        if (result.backToParent || isBack(rawInput)) {
          state.sceneId = "mainMenu";
        }
      }
    }

    const renderFrame = () => {
      const spinner = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
      const viewportRows = process.stdout.isTTY ? process.stdout.rows : undefined;
      const viewportColumns = process.stdout.isTTY ? process.stdout.columns : undefined;
      const spacing = getSceneSpacing(viewportRows);
      const statusToken = renderStatusBadge(state.sceneId, state.continueUiState, spinner, state.agentSessionPending);
      const sceneLines = buildSceneLines(state, spacing, currentWorkingDirectory);
      const lines = buildFrame({
        sceneId: state.sceneId,
        statusToken,
        viewportRows,
        viewportColumns,
        mainMenuRows: getMainMenuRows(state.mainMenuState),
        mainMenuHint: state.mainMenuHint,
        showHelpOverlay: state.showHelpOverlay,
        sceneLines,
      });
      previousLineCount = render(lines, previousLineCount);
      frameIndex += 1;
      state.continueUiState = updateContinueUiState(state.continueUiState, state.runState);
    };

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        // ignore raw mode errors
      }
      process.stdin.resume();
      process.stdin.on("data", onInput);
    }

    startRender();

    const onSigint = () => {
      stopRender();
      void releaseApp(state.runState.app).finally(() => {
        finish(130, { newline: true });
      });
    };

    const onSigterm = () => {
      stopRender();
      void releaseApp(state.runState.app).finally(() => {
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
