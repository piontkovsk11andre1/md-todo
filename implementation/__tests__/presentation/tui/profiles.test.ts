import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTuiHarness } from "./harness.ts";
import {
  createProfilesSceneState,
  handleProfilesInput,
  reloadProfilesSceneState,
} from "../../../src/presentation/tui/scenes/profiles.ts";
import { createApp } from "../../../src/create-app.js";

const profileMockData = vi.hoisted(() => ({
  profiles: {
    fast: ["opencode", "run", "--model", "gpt-5.3"],
    review: ["opencode", "run", "--model", "opus-4.6"],
  },
}));

describe("tui profiles integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the profiles scene on a seeded workspace", async () => {
    const harness = await createTuiHarness({
      initialScene: "profiles",
      workspaceFiles: {
        "migrations/001-first.md": "---\nprofile: fast\n---\n\n- [ ] First task\n",
        "migrations/002-second.md": "- profile=review\n",
        "specs/notes.md": "- [ ] profile=fast, tighten test coverage\n",
      },
    });

    const frame = harness.frame();

    expect(frame).toContain("Profiles");
    expect(frame).toContain("fast");
    expect(frame).toContain("used by: 1 frontmatter · 0 directives · 1 prefix");
    expect(frame).toContain("review");
    expect(frame).toContain("used by: 0 frontmatter · 1 directives · 0 prefix");
    expect(frame).toContain("[u] full scan");
    expect(createApp).toHaveBeenCalled();
  });

  it("returns to the main menu on Esc", async () => {
    const harness = await createTuiHarness({ initialScene: "profiles" });

    expect(harness.sceneStack()).toEqual(["mainMenu", "profiles"]);

    await harness.press("esc");

    expect(harness.sceneStack()).toEqual(["mainMenu"]);
    expect(harness.frame()).toContain("Main Menu:");
    expect(harness.frame()).toContain("4. Profiles");
  });

  it("caches profile scans for 30 seconds", async () => {
    const scanProfileReferences = vi.fn(async () => []);
    const workspaceScanBridgeFactory = () => ({
      scanProfileReferences,
    });
    const configBridgeFactory = () => ({
      resolveConfigPath: async () => "C:\\tmp\\.rundown\\config.json",
      loadWorkerConfig: async () => ({ profiles: profileMockData.profiles }),
    });

    const first = await reloadProfilesSceneState({
      state: createProfilesSceneState(),
      now: () => 1_000,
      configBridgeFactory,
      workspaceScanBridgeFactory,
    });

    await reloadProfilesSceneState({
      state: first,
      now: () => 30_000,
      configBridgeFactory,
      workspaceScanBridgeFactory,
    });

    await reloadProfilesSceneState({
      state: first,
      now: () => 31_001,
      configBridgeFactory,
      workspaceScanBridgeFactory,
    });

    expect(scanProfileReferences).toHaveBeenCalledTimes(2);
  });

  it("maps [u] to full-rescan action", () => {
    const result = handleProfilesInput({
      rawInput: "u",
      state: createProfilesSceneState(),
    });

    expect(result.handled).toBe(true);
    expect(result.backToParent).toBe(false);
    expect(result.action).toEqual({ type: "full-rescan" });
  });

  it("forceRescan bypasses cache before TTL", async () => {
    const scanProfileReferences = vi.fn(async () => []);
    const workspaceScanBridgeFactory = () => ({
      scanProfileReferences,
    });
    const configBridgeFactory = () => ({
      resolveConfigPath: async () => "C:\\tmp\\.rundown\\config.json",
      loadWorkerConfig: async () => ({ profiles: profileMockData.profiles }),
    });

    const initial = await reloadProfilesSceneState({
      state: createProfilesSceneState(),
      now: () => 5_000,
      configBridgeFactory,
      workspaceScanBridgeFactory,
    });

    await reloadProfilesSceneState({
      state: initial,
      forceRescan: true,
      now: () => 5_100,
      configBridgeFactory,
      workspaceScanBridgeFactory,
    });

    expect(scanProfileReferences).toHaveBeenCalledTimes(2);
  });
});

vi.mock("../../../src/create-app.js", () => ({
  createApp: vi.fn((options?: { ports?: { output?: { emit?: (event: unknown) => void } } }) => {
    const emit = options?.ports?.output?.emit;
    return {
      configList: vi.fn(async () => {
        emit?.({
          kind: "text",
          text: JSON.stringify({
            config: {
              profiles: profileMockData.profiles,
            },
          }),
        });
        return 0;
      }),
      configPath: vi.fn(async () => {
        emit?.({ kind: "text", text: JSON.stringify({ path: "C:\\Work\\md-todo\\.rundown\\config.json" }) });
        return 0;
      }),
      releaseAllLocks: vi.fn(),
      awaitShutdown: vi.fn(async () => {}),
    };
  }),
}));
