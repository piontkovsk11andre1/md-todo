import { describe, expect, it } from "vitest";
import { resolveGlobalConfigPath } from "../../../src/infrastructure/adapters/global-config-path-adapter.js";

describe("resolveGlobalConfigPath", () => {
  it("prefers APPDATA on win32 and discovers first existing candidate", () => {
    const appdataPath = "C:\\Users\\alice\\AppData\\Roaming";
    const localAppDataPath = "C:\\Users\\alice\\AppData\\Local";

    const result = resolveGlobalConfigPath({
      platform: "win32",
      env: {
        APPDATA: appdataPath,
        LOCALAPPDATA: localAppDataPath,
      },
      homedir: "C:\\Users\\alice",
      fileExists: (filePath) => filePath === `${localAppDataPath}\\rundown\\config.json`,
    });

    expect(result.canonicalPath).toBe(`${appdataPath}\\rundown\\config.json`);
    expect(result.discoveredPath).toBe(`${localAppDataPath}\\rundown\\config.json`);
    expect(result.candidates[0]).toBe(`${appdataPath}\\rundown\\config.json`);
    expect(result.candidates).toContain(`${localAppDataPath}\\rundown\\config.json`);
    expect(new Set(result.candidates).size).toBe(result.candidates.length);
  });

  it("uses macOS Library/Application Support as canonical location", () => {
    const result = resolveGlobalConfigPath({
      platform: "darwin",
      env: {
        XDG_CONFIG_HOME: "/Users/alice/.xdg",
      },
      homedir: "/Users/alice",
      fileExists: (filePath) => filePath === "/Users/alice/.config/rundown/config.json",
    });

    expect(result.canonicalPath).toBe("/Users/alice/Library/Application Support/rundown/config.json");
    expect(result.discoveredPath).toBe("/Users/alice/.config/rundown/config.json");
    expect(result.candidates).toEqual([
      "/Users/alice/Library/Application Support/rundown/config.json",
      "/Users/alice/.xdg/rundown/config.json",
      "/Users/alice/.config/rundown/config.json",
    ]);
  });

  it("uses XDG_CONFIG_HOME first on linux", () => {
    const result = resolveGlobalConfigPath({
      platform: "linux",
      env: {
        XDG_CONFIG_HOME: "/home/alice/.xdg",
      },
      homedir: "/home/alice",
      fileExists: (filePath) => filePath === "/home/alice/.xdg/rundown/config.json",
    });

    expect(result.canonicalPath).toBe("/home/alice/.xdg/rundown/config.json");
    expect(result.discoveredPath).toBe("/home/alice/.xdg/rundown/config.json");
    expect(result.candidates).toEqual([
      "/home/alice/.xdg/rundown/config.json",
      "/home/alice/.config/rundown/config.json",
    ]);
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is absent", () => {
    const result = resolveGlobalConfigPath({
      platform: "linux",
      env: {},
      homedir: "/home/alice",
      fileExists: () => false,
    });

    expect(result.canonicalPath).toBe("/home/alice/.config/rundown/config.json");
    expect(result.discoveredPath).toBeUndefined();
    expect(result.candidates).toEqual([
      "/home/alice/.config/rundown/config.json",
    ]);
  });
});
