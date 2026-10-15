import type { BaseDB } from "../storage/baseDb";
import { dbClient } from "../storage/dbClient";
import type { Entity } from "../schema/defineEntity";
import type { DbKey, QueryOptions } from "../types";

/**
 * The worker-side write helper both domain factories share, over one table of `db`.
 *
 * Every operation goes through `dbClient`, projecting through `entity` — the domain's projection,
 * which may differ from the schema's declaration of the table.
 */
export function defineCachedEntity(db: BaseDB, table: string, entity: Entity) {
  const entityOps = dbClient(db, { [table]: entity }).entity(table);

  /** `scope` and `equals` as `QueryOptions`, leaving out what was not given. */
  const narrowing = (scope?: { field: string; value: unknown }, equals?: Record<string, unknown>) => {
    const options: QueryOptions = {};
    if (scope) options.scope = scope;
    if (equals && Object.keys(equals).length) options.equals = equals;
    return options;
  };

  return {
    table,
    snapshotReplace(rawRows: any[], scope?: { field: string; value: unknown }) {
      return entityOps.snapshotReplace(rawRows, scope);
    },

    upsertMany(rawRows: any[]) {
      return entityOps.upsertMany(rawRows);
    },

    remove(key: DbKey) {
      return entityOps.remove(key);
    },

    /**
     * Rows in the table, or in one scoped partition, optionally narrowed further by `equals`
     * (every named field must match). The shallow-window test for a cursor sync.
     */
    count(scope?: { field: string; value: unknown }, equals?: Record<string, unknown>) {
      return entityOps.count(narrowing(scope, equals));
    },

    /**
     * The newest stored value of `dateField`, optionally scoped and/or narrowed by `equals` (every
     * named field must match) — the incremental-poll cursor.
     *
     * Undefined for an empty scope, never 0: a 0 would be sent as a genuine lower bound and the
     * first sync would seed nothing.
     */
    newestCursor(
      dateField: string,
      scope?: { field: string; value: unknown },
      equals?: Record<string, unknown>,
    ) {
      return entityOps.newestCursor(dateField, scope, equals && Object.keys(equals).length ? equals : undefined);
    },
  };
}
