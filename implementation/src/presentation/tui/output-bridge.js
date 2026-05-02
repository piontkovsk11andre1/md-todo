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

export function resolveProcessArgv(argv) {
  if (Array.isArray(argv)) {
    return ["node", "tui", ...argv];
  }
  return process.argv;
}
