import { describe, expect, it, vi } from "vitest";
import {
  createConfigSet,
  createConfigUnset,
  type ConfigMutationDependencies,
} from "../../src/application/config-mutation.js";
import type { ApplicationOutputEvent } from "../../src/domain/ports/output-port.js";

describe("config-mutation", () => {
  it("parses typed values and delegates set to worker config port", () => {
    const { dependencies, events } = createDependencies();
    const setConfig = createConfigSet(dependencies);

    const code = setConfig({
      scope: "local",
      key: "workers.default",
      value: "true",
      valueType: "boolean",
    });

    expect(code).toBe(0);
    expect(dependencies.workerConfigPort.setValue).toHaveBeenCalledWith("/workspace/.rundown", {
      scope: "local",
      keyPath: "workers.default",
      value: true,
    });
    expect(events).toContainEqual({ kind: "success", message: "Updated local config: workers.default" });
  });

  it("supports auto type by parsing JSON first", () => {
    const { dependencies } = createDependencies();
    const setConfig = createConfigSet(dependencies);

    setConfig({
      scope: "global",
      key: "workers.default",
      value: "[\"opencode\",\"run\"]",
      valueType: "auto",
    });

    expect(dependencies.workerConfigPort.setValue).toHaveBeenCalledWith("/workspace/.rundown", {
      scope: "global",
      keyPath: "workers.default",
      value: ["opencode", "run"],
    });
  });

  it("emits no-change message when set operation is unchanged", () => {
    const { dependencies, events } = createDependencies({ setChanged: false });
    const setConfig = createConfigSet(dependencies);

    setConfig({
      scope: "local",
      key: "workers.default",
      value: "opencode run",
      valueType: "string",
    });

    expect(events).toContainEqual({
      kind: "info",
      message: "No change: workers.default already has the requested value.",
    });
  });

  it("delegates unset and reports removed keys", () => {
    const { dependencies, events } = createDependencies();
    const unsetConfig = createConfigUnset(dependencies);

    const code = unsetConfig({
      scope: "global",
      key: "commands.plan",
    });

    expect(code).toBe(0);
    expect(dependencies.workerConfigPort.unsetValue).toHaveBeenCalledWith("/workspace/.rundown", {
      scope: "global",
      keyPath: "commands.plan",
    });
    expect(events).toContainEqual({ kind: "success", message: "Removed global config key: commands.plan" });
  });

  it("rejects invalid boolean values", () => {
    const { dependencies } = createDependencies();
    const setConfig = createConfigSet(dependencies);

    expect(() => setConfig({
      scope: "local",
      key: "workers.default",
      value: "yes",
      valueType: "boolean",
    })).toThrow("Invalid config value for --type boolean: yes. Use true or false.");
  });

  it("rejects invalid number values", () => {
    const { dependencies } = createDependencies();
    const setConfig = createConfigSet(dependencies);

    expect(() => setConfig({
      scope: "local",
      key: "workers.default",
      value: "not-a-number",
      valueType: "number",
    })).toThrow("Invalid config value for --type number: not-a-number.");
  });

  it("rejects invalid json values", () => {
    const { dependencies } = createDependencies();
    const setConfig = createConfigSet(dependencies);

    expect(() => setConfig({
      scope: "local",
      key: "workers.default",
      value: "{invalid",
      valueType: "json",
    })).toThrow("Invalid config value for --type json");
  });
});

function createDependencies(options: {
  setChanged?: boolean;
  unsetChanged?: boolean;
} = {}): {
  dependencies: ConfigMutationDependencies;
  events: ApplicationOutputEvent[];
} {
  const events: ApplicationOutputEvent[] = [];

  const dependencies: ConfigMutationDependencies = {
    workerConfigPort: {
      load: vi.fn(() => undefined),
      setValue: vi.fn(() => ({
        configPath: "/workspace/.rundown/config.json",
        changed: options.setChanged ?? true,
      })),
      unsetValue: vi.fn(() => ({
        configPath: "/workspace/.rundown/config.json",
        changed: options.unsetChanged ?? true,
      })),
    },
    configDir: {
      configDir: "/workspace/.rundown",
      isExplicit: false,
    },
    output: {
      emit: (event) => events.push(event),
    },
  };

  return {
    dependencies,
    events,
  };
}
