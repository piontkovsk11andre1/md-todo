import { createApp } from "../../create-app.js";

const UNKNOWN_PROBE_STATUS = Object.freeze({ text: "?", tone: "muted" });
const PENDING_PROBE_STATUS = Object.freeze({ text: "...", tone: "muted" });
const CONTINUE_SOURCE = "migrations/";

const PROBE_TTLS_MS = Object.freeze({
  continue: 2000,
  newWork: 5000,
  workers: 10000,
  profiles: 10000,
  settings: 30000,
  help: Number.POSITIVE_INFINITY,
});

const ROW_IDS = Object.freeze(Object.keys(PROBE_TTLS_MS));

function normalizeProbeStatus(value) {
  if (!value || typeof value !== "object") {
    return PENDING_PROBE_STATUS;
  }
  const text = typeof value.text === "string" ? value.text : String(value.text ?? "");
  const tone = value.tone === "ok" || value.tone === "warn" || value.tone === "error" || value.tone === "muted"
    ? value.tone
    : "muted";
  return { text, tone };
}

async function runProbeSafely(probe) {
  try {
    return normalizeProbeStatus(await probe());
  } catch {
    return UNKNOWN_PROBE_STATUS;
  }
}

function createDefaultProbe(rowId) {
  if (rowId === "continue") {
    return createContinueProbe();
  }
  if (rowId === "help") {
    return () => ({ text: "docs · website · changelog · keys", tone: "muted" });
  }
  return () => PENDING_PROBE_STATUS;
}

export function createContinueProbe({ appFactory = createApp, source = CONTINUE_SOURCE } = {}) {
  return async function runContinueProbe() {
    const pendingFiles = new Set();
    let pendingTasks = 0;
    let app;

    try {
      app = appFactory({
        ports: {
          output: {
            emit(event) {
              if (event?.kind !== "task" || !event.task) {
                return;
              }
              pendingTasks += 1;
              const file = typeof event.task.file === "string" ? event.task.file : "";
              if (file.length > 0) {
                pendingFiles.add(file);
              }
            },
          },
        },
      });

      const exitCode = await app.listTasks({ source, sortMode: "name-sort", includeAll: false });
      if (exitCode !== 0 && exitCode !== 3) {
        return UNKNOWN_PROBE_STATUS;
      }

      return {
        text: `${pendingTasks} tasks · ${pendingFiles.size} migrations pending`,
        tone: pendingTasks > 0 ? "warn" : "ok",
      };
    } catch {
      return UNKNOWN_PROBE_STATUS;
    } finally {
      app?.releaseAllLocks?.();
      await app?.awaitShutdown?.();
    }
  };
}

export function createStatusProbeRegistry({ probes = {}, now = Date.now } = {}) {
  const cache = new Map();
  const inFlight = new Map();

  for (const rowId of ROW_IDS) {
    cache.set(rowId, {
      status: PENDING_PROBE_STATUS,
      updatedAt: 0,
      stale: true,
    });
  }

  function getTtl(rowId) {
    return PROBE_TTLS_MS[rowId] ?? 0;
  }

  function isStale(rowId, updatedAt) {
    const ttlMs = getTtl(rowId);
    if (!Number.isFinite(ttlMs)) {
      return updatedAt <= 0;
    }
    return now() - updatedAt >= ttlMs;
  }

  async function refreshProbe(rowId) {
    if (!ROW_IDS.includes(rowId)) {
      return UNKNOWN_PROBE_STATUS;
    }
    const existing = inFlight.get(rowId);
    if (existing) {
      return existing;
    }

    const probe = typeof probes[rowId] === "function" ? probes[rowId] : createDefaultProbe(rowId);
    const refreshPromise = runProbeSafely(probe).then((status) => {
      cache.set(rowId, { status, updatedAt: now(), stale: false });
      inFlight.delete(rowId);
      return status;
    });

    inFlight.set(rowId, refreshPromise);
    return refreshPromise;
  }

  function getProbeStatus(rowId) {
    if (!ROW_IDS.includes(rowId)) {
      return UNKNOWN_PROBE_STATUS;
    }
    const entry = cache.get(rowId) ?? { status: PENDING_PROBE_STATUS, updatedAt: 0, stale: true };
    const stale = isStale(rowId, entry.updatedAt);
    if (entry.stale !== stale) {
      cache.set(rowId, {
        status: entry.status,
        updatedAt: entry.updatedAt,
        stale,
      });
    }
    if (stale) {
      void refreshProbe(rowId);
    }
    return entry.status;
  }

  async function refreshAllProbes() {
    await Promise.all(ROW_IDS.map((rowId) => refreshProbe(rowId)));
  }

  return {
    getProbeStatus,
    refreshProbe,
    refreshAllProbes,
    getTtl,
  };
}

export { PROBE_TTLS_MS, ROW_IDS, UNKNOWN_PROBE_STATUS, PENDING_PROBE_STATUS };
