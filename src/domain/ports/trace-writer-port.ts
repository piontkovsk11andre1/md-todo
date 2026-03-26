import type { TraceEvent } from "../trace.js";

export interface TraceWriterPort {
  write(event: TraceEvent): void;
  flush(): void;
}
