import type { TraceWriterPort } from "../../domain/ports/trace-writer-port.js";

export function createNoopTraceWriter(): TraceWriterPort {
  return {
    write() {},
    flush() {},
  };
}
