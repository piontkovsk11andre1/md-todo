import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMigrationDirectory, parseMigrationFilename } from "../../src/domain/migration-parser.js";

describe("parseMigrationFilename", () => {
  it("returns null for invalid migration numbering", () => {
    expect(parseMigrationFilename("123-build.md")).toBeNull();
    expect(parseMigrationFilename("12345-build.md")).toBeNull();
    expect(parseMigrationFilename("12a4-build.md")).toBeNull();
  });

  it("returns null for unknown satellite types", () => {
    expect(parseMigrationFilename("0007--unknown.md")).toBeNull();
    expect(parseMigrationFilename("0007--user-session.md")).toBeNull();
  });

  it("handles double-dash edge cases without misclassifying invalid files", () => {
    expect(parseMigrationFilename("0007--snapshot.md")).toEqual({
      number: 7,
      name: "snapshot",
      isSatellite: true,
      satelliteType: "snapshot",
    });

    expect(parseMigrationFilename("0007---snapshot.md")).toBeNull();
    expect(parseMigrationFilename("0007--snapshot-extra.md")).toBeNull();
    expect(parseMigrationFilename("0007--snapshot.md.bak")).toBeNull();
  });
});

describe("parseMigrationDirectory", () => {
  it("ignores malformed migration and satellite filenames safely", () => {
    const migrationsDir = path.join("/tmp", "project", "migrations");
    const files = [
      path.join(migrationsDir, "0001-initialize.md"),
      path.join(migrationsDir, "0001--context.md"),
      path.join(migrationsDir, "001-add-auth.md"),
      path.join(migrationsDir, "0002--unknown.md"),
      path.join(migrationsDir, "0001---snapshot.md"),
      path.join(migrationsDir, "0001--snapshot-extra.md"),
      path.join(migrationsDir, "0001--snapshot.md.bak"),
    ];

    expect(() => parseMigrationDirectory(files, migrationsDir)).not.toThrow();

    const state = parseMigrationDirectory(files, migrationsDir);
    expect(state.migrations).toHaveLength(1);
    expect(state.migrations[0]?.number).toBe(1);
    expect(state.migrations[0]?.satellites.map((satellite) => satellite.type)).toEqual(["context"]);
    expect(state.currentPosition).toBe(1);
  });
});
