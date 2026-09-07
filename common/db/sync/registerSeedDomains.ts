/**
 * Register the snapshot sync domains for exactly the seed entities an app declared.
 *
 * Worker-side (and main-thread bootstrap) only — this module imports the fetch layer.
 */

import type { AppDb } from "../defineAppDb";
import { registerSnapshotDomain } from "./snapshotDomain";

export function registerSeedDomains(appDb: AppDb): void {
  for (const entity of appDb.seed) {
    registerSnapshotDomain(
      {
        name: entity.name,
        table: entity.table,
        projection: entity.projection,
        ...entity.source,
      },
      (omsInstance) => appDb.get(omsInstance),
    );
  }
}
