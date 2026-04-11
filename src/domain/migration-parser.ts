import path from "node:path";
import type { Migration, MigrationState, Satellite, SatelliteType } from "./migration-types.js";

const SATELLITE_PATTERN = /^(\d{4})--(.+)\.md$/;
const MIGRATION_PATTERN = /^(\d{4})-(?!-)(.+)\.md$/;

const SATELLITE_TYPES = new Set<SatelliteType>([
  "context",
  "snapshot",
  "backlog",
  "user-experience",
  "review",
]);

export interface ParsedMigrationFilename {
  number: number;
  name: string;
  isSatellite: boolean;
  satelliteType: SatelliteType | null;
}

export function parseMigrationFilename(filename: string): ParsedMigrationFilename | null {
  const satelliteMatch = filename.match(SATELLITE_PATTERN);
  if (satelliteMatch) {
    const number = Number.parseInt(satelliteMatch[1]!, 10);
    const satelliteType = satelliteMatch[2]!;
    if (!SATELLITE_TYPES.has(satelliteType as SatelliteType)) {
      return null;
    }
    return {
      number,
      name: satelliteType,
      isSatellite: true,
      satelliteType: satelliteType as SatelliteType,
    };
  }

  const migrationMatch = filename.match(MIGRATION_PATTERN);
  if (!migrationMatch) {
    return null;
  }

  return {
    number: Number.parseInt(migrationMatch[1]!, 10),
    name: migrationMatch[2]!,
    isSatellite: false,
    satelliteType: null,
  };
}

export function parseMigrationDirectory(files: string[], migrationsDir: string): MigrationState {
  const migrationMap = new Map<number, Migration>();

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const parsed = parseMigrationFilename(filename);
    if (!parsed || parsed.isSatellite) {
      continue;
    }

    migrationMap.set(parsed.number, {
      number: parsed.number,
      name: parsed.name,
      filePath,
      satellites: [],
      isApplied: false,
    });
  }

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const parsed = parseMigrationFilename(filename);
    if (!parsed || !parsed.isSatellite) {
      continue;
    }

    const migration = migrationMap.get(parsed.number);
    if (!migration) {
      continue;
    }

    migration.satellites.push({
      migrationNumber: parsed.number,
      type: parsed.satelliteType!,
      filePath,
    });
  }

  const migrations = [...migrationMap.values()]
    .sort((left, right) => left.number - right.number);

  for (const migration of migrations) {
    migration.satellites.sort((left, right) => {
      if (left.migrationNumber !== right.migrationNumber) {
        return left.migrationNumber - right.migrationNumber;
      }
      return left.type.localeCompare(right.type);
    });
  }

  const state: MigrationState = {
    projectRoot: path.dirname(migrationsDir),
    migrationsDir,
    migrations,
    currentPosition: getCurrentPositionFromMigrations(migrations),
    latestContext: getLatestSatelliteFromMigrations(migrations, "context"),
    latestBacklog: getLatestSatelliteFromMigrations(migrations, "backlog"),
  };

  return state;
}

function getCurrentPositionFromMigrations(migrations: Migration[]): number {
  if (migrations.length === 0) {
    return 0;
  }
  return migrations[migrations.length - 1]!.number;
}

function getLatestSatelliteFromMigrations(migrations: Migration[], type: SatelliteType): Satellite | null {
  const satellites: Satellite[] = [];
  for (const migration of migrations) {
    for (const satellite of migration.satellites) {
      if (satellite.type === type) {
        satellites.push(satellite);
      }
    }
  }

  if (satellites.length === 0) {
    return null;
  }

  satellites.sort((left, right) => {
    if (left.migrationNumber !== right.migrationNumber) {
      return left.migrationNumber - right.migrationNumber;
    }
    return left.type.localeCompare(right.type);
  });

  return satellites[satellites.length - 1]!;
}
