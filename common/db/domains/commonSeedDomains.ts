/**
 * Register all 29 seed domains. Kept for backwards compatibility.
 *
 * Prefer `registerSeedDomains(appDb)`, which registers exactly the tables the app composed.
 */

import { registerSnapshotDomain } from "../sync/snapshotDomain";
import type { BaseDB } from "../baseDb";
import { commonSchema } from "./commonSchema";
import { SEED_SOURCES, SEED_TABLE_NAMES } from "./seedSources";

export function registerCommonSeedDomains(getDb: (omsInstance: string) => BaseDB): void {
  for (const table of SEED_TABLE_NAMES) {
    const seed = SEED_SOURCES[table];
    registerSnapshotDomain(
      { name: seed.name, table, projection: commonSchema.entities[table], ...seed.source },
      getDb,
    );
  }
}
