/**
 * Register the snapshot sync domains for exactly the seed tables an app composed.
 *
 * Worker-side (and main-thread bootstrap) only — this module imports the fetch layer.
 */

import type { AppDb } from "../defineAppDb";
import { SEED_DOMAINS, SEED_SOURCES } from "../domains/seedDomains";
import { registerSnapshotDomain } from "./snapshotDomain";

export function registerSeedDomains(
  appDb: AppDb,
  options: { exclude?: string[] } = {}
): void {
  const excluded = new Set(options.exclude ?? []);

  for (const [table, entity] of Object.entries(appDb.entities)) {
    // Provenance, not name: an app's own table may share a seed table's name but needs its own
    // endpoint and fetch config, and must NOT be registered against the seed source.
    if (!appDb.seedTables.has(table)) continue;
    if (excluded.has(table)) continue;

    const seed = SEED_DOMAINS[table as keyof typeof SEED_DOMAINS];
    if (!seed) continue; // an app's own table has no seed source

    registerSnapshotDomain(
      // `appDb.entities[table]` IS the projection — an `Entity` carries no nested `projection`.
      { name: seed.name, label: seed.label, syncClass: "B", table, projection: entity, ...seed.source },
      (omsInstance) => appDb.get(omsInstance),
    );
  }
}
