/**
 * Factory for Class-B (reference/config) snapshot sync domains.
 */

import { BaseDB, hasSyncedThisLogin, markSyncedThisLogin } from "../baseDb";
import type { Entity } from "../defineEntity";
import { canonicalKey, diffStaleKeys, entityKeyOf, isUnkeyableFetch, projectRow, projectRows } from "../projection";
import type { DbKey, DbRow, SyncContext } from "../types";
import { registerSyncDomain } from "./syncRegistry";
import { pageAll, unwrapCollection, workerGet } from "./workerFetch";

export interface SnapshotDomainConfig {
  name: string;
  table: string;
  projection: Entity;
  listUrl: string;
  collectionKey?: string | null;
  listParams?: Record<string, unknown>;
  batchSize?: number;
  /**
   * Fetch the collection in a single request instead of paging through it. Only for endpoints
   * that cannot page; anything larger than one page is silently dropped.
   */
  unpaged?: boolean;
  scopeOnSync?: { field: string; value: unknown };
  fanOut?: {
    parentTable: string;
    parentKeyField: string;
    urlFor: (parentId: string) => string;
    collectionKey?: string | null;
  };
  byPk?: (pk: Record<string, unknown>) => { url: string; params?: Record<string, unknown> };
  byPkRecordKey?: string;
  refetchScope?: (pk: Record<string, unknown>) => {
    params: Record<string, unknown>;
    scope?: { field: string; value: unknown };
  };
}

/**
 * The cross-page dedup key pageAll needs: a canonical STRING, not a DbKey, because it goes into a
 * Set. Derived by projecting the raw record first, so it is impossible for the dedup key and the
 * key the row is eventually stored under to disagree.
 *
 * Exported so it can be tested directly; takes the Entity rather than the whole config so the test
 * needs no fetch config to exercise it.
 */
export function snapshotKeyOf(record: any, entity: Entity): string | undefined {
  const row = projectRow(record, entity, 0);
  if (!row) return undefined;

  const key = entityKeyOf(row, entity);
  return key === undefined ? undefined : canonicalKey(key);
}

/** The stored keys of already-projected rows, dropping any that cannot be keyed. */
function keysOfRows(rows: DbRow[], entity: Entity): DbKey[] {
  const keys: DbKey[] = [];
  for (const row of rows) {
    const key = entityKeyOf(row, entity);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

export function registerSnapshotDomain(config: SnapshotDomainConfig, getDb: (omsInstance: string) => BaseDB): void {
  registerSyncDomain({
    name: config.name,
    async sync(ctx: SyncContext) {
      const db = getDb(ctx.omsInstance);
      if (ctx.trigger !== "manual" && await hasSyncedThisLogin(db, config.name)) return;

      let rawRecords: any[] = [];

      if (config.fanOut) {
        const parentRows = await db.table<DbRow, string>(config.fanOut.parentTable).toArray();
        for (const parent of parentRows) {
          const parentId = String(parent[config.fanOut.parentKeyField] || "");
          if (!parentId) continue;
          const url = config.fanOut.urlFor(parentId);
          const fanRows = await pageAll({
            ctx,
            url,
            collectionKey: config.fanOut.collectionKey ?? config.collectionKey,
            batchSize: config.batchSize ?? 250,
            unpaged: config.unpaged,
            keyOf: (r) => snapshotKeyOf(r, config.projection),
          });
          rawRecords.push(...fanRows);
        }
      } else {
        rawRecords = await pageAll({
          ctx,
          url: config.listUrl,
          collectionKey: config.collectionKey,
          params: config.listParams,
          batchSize: config.batchSize ?? 250,
          unpaged: config.unpaged,
          keyOf: (r) => snapshotKeyOf(r, config.projection),
        });
      }

      if (rawRecords.length > 0 && isUnkeyableFetch(rawRecords, config.projection)) {
        console.warn(`[db] ${config.name}: fetched ${rawRecords.length} records but keys could not be built. Aborting snapshot replace.`);
        return;
      }

      const freshRows = projectRows(rawRecords, config.projection, ctx.now);
      const freshKeys = keysOfRows(freshRows, config.projection);

      await db.transaction("rw", [config.table, "syncMeta"], async () => {
        const tableRef = db.table<DbRow, DbKey>(config.table);
        let existingKeys: DbKey[] = [];

        if (config.scopeOnSync) {
          const scoped = await tableRef.where(config.scopeOnSync.field).equals(config.scopeOnSync.value as any).toArray();
          existingKeys = keysOfRows(scoped, config.projection);
        } else {
          existingKeys = (await tableRef.toCollection().primaryKeys()) as DbKey[];
        }

        const staleKeys = diffStaleKeys(existingKeys, freshKeys);
        if (staleKeys.length > 0) {
          await tableRef.bulkDelete(staleKeys);
        }

        if (freshRows.length > 0) {
          await tableRef.bulkPut(freshRows);
        }

        await markSyncedThisLogin(db, config.name);
      });
    },

    async refetchOne(pk: Record<string, unknown>, ctx: SyncContext) {
      const db = getDb(ctx.omsInstance);
      const tableRef = db.table<DbRow, DbKey>(config.table);

      if (config.byPk) {
        const target = config.byPk(pk);
        try {
          const resp = await workerGet(ctx, target.url, target.params);
          const raw = config.byPkRecordKey ? resp?.[config.byPkRecordKey] : resp;
          if (raw) {
            const projected = projectRows([raw], config.projection, ctx.now);
            if (projected.length > 0) {
              await tableRef.put(projected[0]);
            }
          }
        } catch (error) {
          console.warn(`[db] ${config.name}: failed to refetch by PK:`, error);
        }
      } else if (config.refetchScope) {
        const scopeConfig = config.refetchScope(pk);
        const scopedRecords = await pageAll({
          ctx,
          url: config.listUrl,
          collectionKey: config.collectionKey,
          params: scopeConfig.params,
          batchSize: config.batchSize ?? 250,
          keyOf: (r) => snapshotKeyOf(r, config.projection),
        });

        const freshRows = projectRows(scopedRecords, config.projection, ctx.now);
        const freshKeys = keysOfRows(freshRows, config.projection);

        await db.transaction("rw", [config.table], async () => {
          let existingKeys: DbKey[] = [];
          if (scopeConfig.scope) {
            const scoped = await tableRef.where(scopeConfig.scope.field).equals(scopeConfig.scope.value as any).toArray();
            existingKeys = keysOfRows(scoped, config.projection);
          } else {
            existingKeys = (await tableRef.toCollection().primaryKeys()) as DbKey[];
          }

          const staleKeys = diffStaleKeys(existingKeys, freshKeys);
          if (staleKeys.length > 0) await tableRef.bulkDelete(staleKeys);
          if (freshRows.length > 0) await tableRef.bulkPut(freshRows);
        });
      }
    },
  });
}
