export async function releaseApp(app) {
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

export function pushRecentMessage(runState, kind, message) {
  if (typeof message !== "string" || message.length === 0) {
    return;
  }
  runState.recentMessages.push({ kind, message, at: Date.now() });
  while (runState.recentMessages.length > 6) {
    runState.recentMessages.shift();
  }
}

export function createInitialRunState() {
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

export function applyOutputEvent(runState, event) {
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
      return;
    default:
      return;
  }
}

export function resolveProcessArgv(argv) {
  if (Array.isArray(argv)) {
    return ["node", "tui", ...argv];
  }
  return process.argv;
}
