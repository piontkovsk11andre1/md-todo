import fs from "node:fs";
import path from "node:path";
import { createApp } from "../../../create-app.js";

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
  a: "discuss-agent",
  o: "open-agent",
};

const NEW_WORK_READINESS = {
  missingAgent: "missing-agent",
  missingWorker: "missing-worker",
  noEligibleWorker: "no-eligible-worker",
  ready: "ready",
};

const AGENT_MARKDOWN_PATH = ".rundown/agent.md";

export function isNewWorkActionKey(actionKey) {
  return actionKey === "a" || actionKey === "o";
}

function safeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function extractLastJsonText(entries, fromIndex = 0) {
  for (let index = entries.length - 1; index >= fromIndex; index -= 1) {
    const text = entries[index];
    if (typeof text !== "string") {
      continue;
    }
    try {
      return JSON.parse(text);
    } catch {
      // Keep scanning earlier text entries.
    }
  }
  return undefined;
}

function collectAppTextOutput(event, buffer) {
  if (event?.kind === "text" && typeof event.text === "string") {
    buffer.push(event.text);
  }
}

async function runAppJsonCommand({ appFactory = createApp, invoke }) {
  const textEvents = [];
  let app;

  try {
    app = appFactory({
      ports: {
        output: {
          emit(event) {
            collectAppTextOutput(event, textEvents);
          },
        },
      },
    });

    const start = textEvents.length;
    const exitCode = await invoke(app);
    if (exitCode !== 0) {
      return undefined;
    }
    return extractLastJsonText(textEvents, start);
  } finally {
    app?.releaseAllLocks?.();
    await app?.awaitShutdown?.();
  }
}

function describeEligibilityReason(candidate) {
  const workerReason = candidate?.worker?.reason;
  const profileReason = candidate?.profile?.reason;
  if (workerReason === "unavailable" || profileReason === "unavailable") {
    return "worker unavailable";
  }
  if (workerReason === "cooling_down" || profileReason === "cooling_down") {
    return "worker cooling down";
  }
  return "worker not eligible";
}

async function resolveNewWorkReadiness({ currentWorkingDirectory, cliWorkerCommand = [] }) {
  const agentPath = path.join(currentWorkingDirectory, AGENT_MARKDOWN_PATH);
  if (!fs.existsSync(agentPath)) {
    return {
      route: NEW_WORK_READINESS.missingAgent,
      agentPath: AGENT_MARKDOWN_PATH,
    };
  }

  const [configPayload, workerHealthPayload] = await Promise.all([
    runAppJsonCommand({
      invoke: (app) => app.configList({ scope: "effective", json: true, showSource: false }),
    }),
    runAppJsonCommand({
      invoke: (app) => app.viewWorkerHealthStatus({ json: true }),
    }),
  ]);

  const config = safeObject(safeObject(configPayload).config);
  const workers = safeObject(config.workers);
  const hasDefaultWorker = Array.isArray(workers.default) && workers.default.length > 0;
  const hasTuiWorker = Array.isArray(workers.tui) && workers.tui.length > 0;
  const hasCliWorker = Array.isArray(cliWorkerCommand) && cliWorkerCommand.length > 0;

  if (!hasDefaultWorker && !hasTuiWorker && !hasCliWorker) {
    return {
      route: NEW_WORK_READINESS.missingWorker,
      hint: "Run `rundown init --worker <command>` to configure a worker.",
    };
  }

  const fallbackOrderSnapshots = Array.isArray(safeObject(workerHealthPayload).fallbackOrderSnapshots)
    ? safeObject(workerHealthPayload).fallbackOrderSnapshots
    : [];
  const runSnapshot = fallbackOrderSnapshots.find((snapshot) => snapshot?.commandName === "run");
  if (!runSnapshot || !Array.isArray(runSnapshot.candidates)) {
    return {
      route: NEW_WORK_READINESS.noEligibleWorker,
      hint: "Unable to read worker eligibility. Run `rundown worker-health`.",
      candidates: [],
    };
  }

  const eligibleCandidate = runSnapshot.candidates.find((candidate) => candidate?.eligible);
  if (eligibleCandidate) {
    return {
      route: NEW_WORK_READINESS.ready,
    };
  }

  return {
    route: NEW_WORK_READINESS.noEligibleWorker,
    candidates: runSnapshot.candidates.map((candidate) => ({
      workerLabel: candidate?.workerLabel ?? "(unknown worker)",
      source: candidate?.source ?? "(unknown source)",
      reason: describeEligibilityReason(candidate),
    })),
  };
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
      cliVersion: "tui",
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

export async function startNewWorkSceneAction({
  actionKey,
  currentWorkingDirectory,
  runState,
  teardownTuiForWorker,
  restoreTuiAfterWorker,
  releaseApp,
  cliWorkerCommand = [],
}) {
  const readiness = await resolveNewWorkReadiness({
    currentWorkingDirectory,
    cliWorkerCommand,
  });
  if (readiness.route !== NEW_WORK_READINESS.ready) {
    return {
      started: false,
      route: readiness.route,
      readiness,
      hint: readiness.hint,
    };
  }

  const promptResult = readAgentPrompt(actionKey, currentWorkingDirectory);
  if (!promptResult.exists || promptResult.content.trim().length === 0) {
    return {
      started: false,
      route: "missing-prompt",
      hint: `Prompt file not found or empty: ${promptResult.source}`,
    };
  }

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
    restoreTuiAfterWorker();
  }

  return { started: true, route: NEW_WORK_READINESS.ready };
}

export { NEW_WORK_READINESS, resolveNewWorkReadiness };
