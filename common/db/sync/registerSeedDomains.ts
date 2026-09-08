/**
 * Register the snapshot sync domains for exactly the seed tables an app composed.
 *
 * Worker-side (and main-thread bootstrap) only — this module imports the fetch layer.
 */

import type { AppDb } from "../defineAppDb";
import { SEED_SOURCES } from "../domains/seedSources";
import { registerSnapshotDomain } from "./snapshotDomain";

export function registerSeedDomains(appDb: AppDb): void {
  for (const [table, entity] of Object.entries(appDb.entities)) {
    // Provenance, not name: an app's own table may share a seed table's name but needs its own
    // endpoint and fetch config, and must NOT be registered against the seed source.
    if(!appDb.seedTables.has(table)) continue;

    const seed = SEED_SOURCES[table as keyof typeof SEED_SOURCES];
    if(!seed) continue; // an app's own table has no seed source

    registerSnapshotDomain(
      { name: seed.name, table, projection: entity, ...seed.source },
      (omsInstance) => appDb.get(omsInstance),
    );
  }
}
