/**
 * Factory for Class-B (reference/config) snapshot sync domains.
 */

import { BaseCacheDB, hasSyncedThisLogin, markSyncedThisLogin } from "../db";
import { diffStaleKeys, isUnkeyableFetch, projectRows } from "../projection";
import type { CachedRow, EntityProjection, SyncContext } from "../types";
import { registerSyncDomain } from "./syncRegistry";
import { pageAll, unwrapCollection, workerGet } from "./workerFetch";

export interface SnapshotDomainConfig {
  name: string;
  table: string;
  projection: EntityProjection;
  listUrl: string;
  collectionKey?: string | null;
  listParams?: Record<string, unknown>;
  batchSize?: number;
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

function keyOfRecord(record: any, config: SnapshotDomainConfig): string | undefined {
  const key = config.projection.buildKey
    ? config.projection.buildKey(record)
    : record?.[config.projection.keyField];
  return key === undefined || key === null || key === "" ? undefined : String(key);
}

export function registerSnapshotDomain(config: SnapshotDomainConfig, getDb: () => BaseCacheDB): void {
  registerSyncDomain({
    name: config.name,
    async sync(ctx: SyncContext) {
      const db = getDb();
      if (ctx.trigger !== "manual" && await hasSyncedThisLogin(db, config.name)) return;

      let rawRecords: any[] = [];

      if (config.fanOut) {
        const parentRows = await db.table<CachedRow, string>(config.fanOut.parentTable).toArray();
        for (const parent of parentRows) {
          const parentId = String(parent[config.fanOut.parentKeyField] || parent.raw?.[config.fanOut.parentKeyField] || "");
          if (!parentId) continue;
          const url = config.fanOut.urlFor(parentId);
          const fanRows = await pageAll({
            ctx,
            url,
            collectionKey: config.fanOut.collectionKey ?? config.collectionKey,
            batchSize: config.batchSize ?? 250,
            unpaged: config.unpaged,
            keyOf: (r) => keyOfRecord(r, config),
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
          keyOf: (r) => keyOfRecord(r, config),
        });
      }

      if (rawRecords.length > 0 && isUnkeyableFetch(rawRecords, config.projection)) {
        console.warn(`[cache] ${config.name}: fetched ${rawRecords.length} records but keys could not be built. Aborting snapshot replace.`);
        return;
      }

      const freshRows = projectRows(rawRecords, config.projection, ctx.now);
      const freshKeys = freshRows.map((r) => String(r[config.projection.keyField]));

      await db.transaction("rw", [config.table, "syncMeta"], async () => {
        const tableRef = db.table<CachedRow, string>(config.table);
        let existingKeys: string[] = [];

        if (config.scopeOnSync) {
          const scoped = await tableRef.where(config.scopeOnSync.field).equals(config.scopeOnSync.value as any).toArray();
          existingKeys = scoped.map((r) => String(r[config.projection.keyField]));
        } else {
          existingKeys = (await tableRef.toCollection().primaryKeys()) as string[];
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
      const db = getDb();
      const tableRef = db.table<CachedRow, string>(config.table);

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
          console.warn(`[cache] ${config.name}: failed to refetch by PK:`, error);
        }
      } else if (config.refetchScope) {
        const scopeConfig = config.refetchScope(pk);
        const scopedRecords = await pageAll({
          ctx,
          url: config.listUrl,
          collectionKey: config.collectionKey,
          params: scopeConfig.params,
          batchSize: config.batchSize ?? 250,
          keyOf: (r) => keyOfRecord(r, config),
        });

        const freshRows = projectRows(scopedRecords, config.projection, ctx.now);
        const freshKeys = freshRows.map((r) => String(r[config.projection.keyField]));

        await db.transaction("rw", [config.table], async () => {
          let existingKeys: string[] = [];
          if (scopeConfig.scope) {
            const scoped = await tableRef.where(scopeConfig.scope.field).equals(scopeConfig.scope.value as any).toArray();
            existingKeys = scoped.map((r) => String(r[config.projection.keyField]));
          } else {
            existingKeys = (await tableRef.toCollection().primaryKeys()) as string[];
          }

          const staleKeys = diffStaleKeys(existingKeys, freshKeys);
          if (staleKeys.length > 0) await tableRef.bulkDelete(staleKeys);
          if (freshRows.length > 0) await tableRef.bulkPut(freshRows);
        });
      }
    },
  });
}
