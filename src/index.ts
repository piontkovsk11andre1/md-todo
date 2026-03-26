/**
 * rundown — Markdown-native task runtime.
 *
 * Default programmatic entrypoint: app composition.
 */

export {
  createApp,
  type App,
  type AppPorts,
  type AppUseCaseFactories,
  type CreateAppDependencies,
} from "./create-app.js";

export type { TraceEvent } from "./domain/trace.js";
export type { TraceWriterPort } from "./domain/ports/trace-writer-port.js";
