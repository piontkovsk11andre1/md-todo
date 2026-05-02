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

export function isNewWorkActionKey(actionKey) {
  return actionKey === "a" || actionKey === "o";
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
}) {
  const promptResult = readAgentPrompt(actionKey, currentWorkingDirectory);
  if (!promptResult.exists || promptResult.content.trim().length === 0) {
    return {
      started: false,
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

  return { started: true };
}
