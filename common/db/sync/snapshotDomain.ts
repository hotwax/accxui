import { BaseDB, hasSyncedThisLogin, markSyncedThisLogin } from "../baseDb";
import { getAppDb } from "../appDbRegistry";
import { dbClient } from "../dbClient";
import type { Entity } from "../defineEntity";

import { canonicalKey, diffStaleKeys, entityKeyOf, isUnkeyableFetch, projectRow, projectRows } from "../projection";
import type { DbKey, DbRow, SyncContext, SyncDomain } from "../types";
import { registerSyncDomain } from "./syncRegistry";
import { pageAll, unwrapCollection, workerGet } from "./workerFetch";

export interface SnapshotDomainConfig {
  name: string;
  table: string;
  projection: Entity;
  listUrl: string;
  collectionKey?: string | null;
  strictCollection?: boolean;
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

export function snapshotKeyOf(record: any, entity: Entity): string | undefined {
  const row = projectRow(record, entity, 0);
  if (!row) return undefined;

  const key = entityKeyOf(row, entity);
  return key === undefined ? undefined : canonicalKey(key);
}

function keysOfRows(rows: DbRow[], entity: Entity): DbKey[] {
  const keys: DbKey[] = [];
  for (const row of rows) {
    const key = entityKeyOf(row, entity);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

export function defineCachedEntity(db: BaseDB, table: string, entity: Entity) {
  const client = dbClient(db);
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
          await client.bulkRemove(table, staleKeys);
          pruned = staleKeys.length;
        }

        if (rows.length > 0) {
          await client.bulkPut(table, rows);
        }
      });
      return { written: rows.length, pruned };
    },

    async upsertMany(rawRows: any[]) {
      const rows = projectRows(rawRows, entity, Date.now());
      if (rows.length > 0) await client.bulkPut(table, rows);
      return rows.length;
    },

    async remove(key: DbKey) {
      await client.remove(table, key);
    },
  };
}

export function registerSnapshotDomain(
  config: SnapshotDomainConfig,
  getDb?: (omsInstance: string) => BaseDB,
): SyncDomain {
  const resolveDb = getDb ?? ((omsInstance: string) => getAppDb().get(omsInstance));

  const syncDomain: SyncDomain = {
    name: config.name,
    async sync(ctx: SyncContext, _args?: unknown, options?: { force?: boolean }) {
      const db = resolveDb(ctx.omsInstance);
      if (!options?.force && ctx.trigger !== "manual" && await hasSyncedThisLogin(db, config.name)) return 0;

      let rawRecords: any[] = [];

      if (config.fanOut) {
        const parentRows = await db.table<DbRow, string>(config.fanOut.parentTable).toArray();
        const parentIds = [...new Set(parentRows.map((row: any) => row?.[config.fanOut!.parentKeyField]).filter(Boolean))];
        for (const parentId of parentIds) {
          const url = config.fanOut.urlFor(String(parentId));
          const fanRows = await pageAll({
            ctx,
            url,
            collectionKey: config.fanOut.collectionKey ?? config.collectionKey,
            strictCollection: config.strictCollection,
            params: config.listParams,
            batchSize: config.batchSize ?? 250,
            unpaged: config.unpaged,
            keyOf: (r) => snapshotKeyOf({ ...r, [config.fanOut!.parentKeyField]: parentId }, config.projection),
          });
          rawRecords.push(...fanRows.map((r: any) => ({ ...r, [config.fanOut!.parentKeyField]: parentId })));
        }
      } else {
        rawRecords = await pageAll({
          ctx,
          url: config.listUrl,
          collectionKey: config.collectionKey,
          strictCollection: config.strictCollection,
          params: config.listParams,
          batchSize: config.batchSize ?? 250,
          unpaged: config.unpaged,
          keyOf: (r) => snapshotKeyOf(r, config.projection),
        });
      }

      if (rawRecords.length > 0 && isUnkeyableFetch(rawRecords, config.projection)) {
        console.warn(`[db] ${config.name}: fetched ${rawRecords.length} records but keys could not be built. Aborting snapshot replace.`);
        return 0;
      }

      // Safety check: avoid wiping a populated table on zero-row fetch during auto sync
      const currentCount = await db.table(config.table).count();
      if (!options?.force && ctx.trigger !== "manual" && rawRecords.length === 0 && currentCount > 0) {
        console.warn(`[db] ${config.name}: fetch returned 0 records while cache holds ${currentCount} rows. Refusing to snapshot replace on auto sync.`);
        return 0;
      }

      const entityOps = defineCachedEntity(db, config.table, config.projection);
      const fanned = await entityOps.snapshotReplace(rawRecords, config.scopeOnSync);

      if (rawRecords.length === 0 || fanned.written > 0) {
        await markSyncedThisLogin(db, config.name);
      }

      return fanned.written;
    },

    async refetchOne(ctx: SyncContext, pk: Record<string, unknown>) {
      const db = resolveDb(ctx.omsInstance);
      const entityOps = defineCachedEntity(db, config.table, config.projection);

      if (!config.byPk && config.fanOut) {
        const { parentKeyField, urlFor } = config.fanOut;
        const parentId = pk[parentKeyField];
        if (!parentId) return 0;

        const fetched = await pageAll({
          ctx,
          url: urlFor(String(parentId)),
          collectionKey: config.fanOut.collectionKey ?? config.collectionKey,
          strictCollection: config.strictCollection,
          params: config.listParams,
          batchSize: config.batchSize ?? 250,
          unpaged: config.unpaged,
          keyOf: (r) => snapshotKeyOf({ ...r, [parentKeyField]: parentId }, config.projection),
        });
        const stamped = fetched.map((row: any) => ({ ...row, [parentKeyField]: parentId }));
        if (stamped.length > 0 && isUnkeyableFetch(stamped, config.projection)) return 0;

        const { written } = await entityOps.snapshotReplace(stamped, { field: parentKeyField, value: parentId });
        return written;
      }

      if (config.byPk) {
        const target = config.byPk(pk);
        try {
          const resp = await workerGet(ctx, target.url, target.params);
          const raw = config.byPkRecordKey ? resp?.[config.byPkRecordKey] : resp;
          if (raw) {
            return await entityOps.upsertMany([raw]);
          } else {
            const key = entityKeyOf(pk, config.projection);
            if (key !== undefined) await entityOps.remove(key);
            return 0;
          }
        } catch (error) {
          console.warn(`[db] ${config.name}: failed to refetch by PK:`, error);
        }
        return 0;
      } else if (config.refetchScope) {
        const scopeConfig = config.refetchScope(pk);
        if (scopeConfig.scope && (scopeConfig.scope.value === undefined || scopeConfig.scope.value === null)) {
          return 0;
        }
        const scopedRecords = await pageAll({
          ctx,
          url: config.listUrl,
          collectionKey: config.collectionKey,
          strictCollection: config.strictCollection,
          params: scopeConfig.params,
          batchSize: config.batchSize ?? 250,
          keyOf: (r) => snapshotKeyOf(r, config.projection),
        });

        if (scopedRecords.length > 0 && isUnkeyableFetch(scopedRecords, config.projection)) return 0;

        const { written } = await entityOps.snapshotReplace(scopedRecords, scopeConfig.scope);
        return written;
      }
      return 0;
    },
  };

  return registerSyncDomain(syncDomain);
}



