import type { BaseDB } from "../storage/baseDb";
import { dbClient } from "../storage/dbClient";
import type { Entity } from "../schema/defineEntity";
import { diffStaleKeys, entityKeyOf, newestValue, projectRows } from "../storage/projection";
import type { DbKey, DbRow } from "../types";

function keysOfRows(rows: DbRow[], entity: Entity): DbKey[] {
  const keys: DbKey[] = [];
  for (const row of rows) {
    const key = entityKeyOf(row, entity);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

export function defineCachedEntity(db: BaseDB, table: string, entity: Entity) {
  const entityOps = dbClient(db).entity(table);
  const tableRef = db.table<DbRow, DbKey>(table);

  return {
    table,
    async snapshotReplace(rawRows: any[], scope?: { field: string; value: unknown }) {
      const rows = projectRows(rawRows, entity, Date.now());
      let pruned = 0;
      await db.transaction("rw", [table, "syncMeta"], async () => {
        let existingKeys: DbKey[] = [];
        if (scope) {
          const scoped = await tableRef.where(scope.field).equals(scope.value as any).toArray();
          existingKeys = keysOfRows(scoped, entity);
        } else {
          existingKeys = (await tableRef.toCollection().primaryKeys()) as DbKey[];
        }

        const freshKeys = keysOfRows(rows, entity);
        const staleKeys = diffStaleKeys(existingKeys, freshKeys);
        if (staleKeys.length > 0) {
          await entityOps.bulkRemove(staleKeys);
          pruned = staleKeys.length;
        }

        if (rows.length > 0) {
          await entityOps.bulkPut(rows as any[]);
        }
      });
      return { written: rows.length, pruned };
    },

    async upsertMany(rawRows: any[]) {
      const rows = projectRows(rawRows, entity, Date.now());
      if (rows.length > 0) await entityOps.bulkPut(rows as any[]);
      return rows.length;
    },

    async remove(key: DbKey) {
      await entityOps.remove(key);
    },

    /**
     * Rows in the table, or in one scoped partition, optionally narrowed further by `equals`
     * (every named field must match). The shallow-window test for a cursor sync.
     */
    async count(scope?: { field: string; value: unknown }, equals?: Record<string, unknown>) {
      const equalsEntries = equals ? Object.entries(equals) : [];
      if (!scope) {
        if (!equalsEntries.length) return tableRef.count();
        const rows = await tableRef.toCollection().toArray();
        return rows.filter((row) => equalsEntries.every(([field, value]) => (row as any)[field] === value)).length;
      }
      const scoped = tableRef.where(scope.field).equals(scope.value as any);
      if (!equalsEntries.length) return scoped.count();
      const rows = await scoped.toArray();
      return rows.filter((row) => equalsEntries.every(([field, value]) => (row as any)[field] === value)).length;
    },

    /**
     * The newest stored value of `dateField`, optionally scoped and/or narrowed by `equals` (every
     * named field must match) — the incremental-poll cursor.
     *
     * Undefined for an empty scope, never 0: a 0 would be sent as a genuine lower bound and the
     * first sync would seed nothing.
     */
    async newestCursor(
      dateField: string,
      scope?: { field: string; value: unknown },
      equals?: Record<string, unknown>,
    ) {
      const equalsEntries = equals ? Object.entries(equals) : [];

      if (!scope && !equalsEntries.length) {
        // Unscoped, un-narrowed: an index range read for the newest row, not a full table read.
        const newest = await tableRef.orderBy(dateField).last();
        return (newest as Record<string, unknown> | undefined)?.[dateField] as number | undefined;
      }

      let rows = scope
        ? await tableRef.where(scope.field).equals(scope.value as any).toArray()
        : await tableRef.toCollection().toArray();
      if (equalsEntries.length) {
        rows = rows.filter((row) => equalsEntries.every(([field, value]) => (row as any)[field] === value));
      }
      return newestValue(rows, dateField);
    },
  };
}
