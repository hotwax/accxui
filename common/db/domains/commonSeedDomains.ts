/**
 * Register all 29 seed domains. Kept for backwards compatibility.
 *
 * Prefer `registerSeedDomains(appDb)`, which registers exactly the entities the app declared.
 */

import { registerSnapshotDomain } from "../sync/snapshotDomain";
import type { BaseDB } from "../baseDb";
import { SEED_ENTITIES, SEED_ENTITY_NAMES } from "./seedEntities";

export function registerCommonSeedDomains(getDb: (omsInstance: string) => BaseDB): void {
  for (const name of SEED_ENTITY_NAMES) {
    const entity = SEED_ENTITIES[name];
    registerSnapshotDomain(
      { name: entity.name, table: entity.table, projection: entity.projection, ...entity.source },
      getDb,
    );
  }
}
