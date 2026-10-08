import type { BaseDB } from "../storage/baseDb";
import { hasSyncedThisLogin, markSyncedThisLogin } from "../storage/baseDb";
import { getAppDb } from "../schema/appDbRegistry";
import type { Entity } from "../schema/defineEntity";

import { canonicalKey, entityKeyOf, isUnkeyableFetch, projectRow } from "../storage/projection";
import type { DbRow, SyncContext, SyncDomain } from "../types";
import { defineCachedEntity } from "./cachedEntity";
import { registerSyncDomain } from "./syncRegistry";
import { pageAll, workerGet } from "../../core/workerRemoteApi";

export interface SnapshotDomainConfig {
  name: string;
  label: string;
  syncClass: "A" | "B" | "C";
  table: string;
  projection?: Entity;
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

export function defineSnapshotDomain(
  config: SnapshotDomainConfig,
  getDb?: (omsInstance: string) => BaseDB,
): SyncDomain {
  const resolveDb = getDb ?? ((omsInstance: string) => getAppDb().get(omsInstance));

  const syncDomain: SyncDomain = {
    name: config.name,
    table: config.table,
    label: config.label,
    syncClass: config.syncClass,
    async sync(ctx: SyncContext, _args?: unknown, options?: { force?: boolean }) {
      const db = resolveDb(ctx.omsInstance);
      const projection = config.projection ?? getAppDb().entities[config.table];
      if (!projection) {
        throw new Error(`[db] domain "${config.name}": no entity projection found for table "${config.table}".`);
      }

      if (!options?.force && await hasSyncedThisLogin(db, config.name)) return 0;

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
            label: `${config.name}:${parentId}`,
            params: config.listParams,
            batchSize: config.batchSize ?? 250,
            unpaged: config.unpaged,
            keyOf: (r) => snapshotKeyOf({ ...r, [config.fanOut!.parentKeyField]: parentId }, projection),
          });
          rawRecords.push(...fanRows.map((r: any) => ({ ...r, [config.fanOut!.parentKeyField]: parentId })));
        }
      } else {
        rawRecords = await pageAll({
          ctx,
          url: config.listUrl,
          collectionKey: config.collectionKey,
          strictCollection: config.strictCollection,
          label: config.name,
          params: config.listParams,
          batchSize: config.batchSize ?? 250,
          unpaged: config.unpaged,
          keyOf: (r) => snapshotKeyOf(r, projection),
        });
      }

      if (rawRecords.length > 0 && isUnkeyableFetch(rawRecords, projection)) {
        console.warn(`[db] ${config.name}: fetched ${rawRecords.length} records but keys could not be built. Aborting snapshot replace.`);
        return 0;
      }

      // Safety check: avoid wiping a populated table on zero-row fetch during auto sync
      const currentCount = await db.table(config.table).count();
      if (!options?.force && rawRecords.length === 0 && currentCount > 0) {
        console.warn(`[db] ${config.name}: fetch returned 0 records while cache holds ${currentCount} rows. Refusing to snapshot replace on auto sync.`);
        return 0;
      }

      const entityOps = defineCachedEntity(db, config.table, projection);
      const fanned = await entityOps.snapshotReplace(rawRecords, config.scopeOnSync);

      if (rawRecords.length === 0 || fanned.written > 0) {
        await markSyncedThisLogin(db, config.name);
      }

      return fanned.written;
    },

    async refetchOne(ctx: SyncContext, pk: Record<string, unknown>) {
      const db = resolveDb(ctx.omsInstance);
      const projection = config.projection ?? getAppDb().entities[config.table];
      if (!projection) {
        throw new Error(`[db] domain "${config.name}": no entity projection found for table "${config.table}".`);
      }
      const entityOps = defineCachedEntity(db, config.table, projection);

      if (!config.byPk && config.fanOut) {
        const { parentKeyField, urlFor } = config.fanOut;
        const parentId = pk[parentKeyField];
        if (!parentId) return 0;

        const fetched = await pageAll({
          ctx,
          url: urlFor(String(parentId)),
          collectionKey: config.fanOut.collectionKey ?? config.collectionKey,
          strictCollection: config.strictCollection,
          label: `${config.name}:${parentId}`,
          params: config.listParams,
          batchSize: config.batchSize ?? 250,
          unpaged: config.unpaged,
          keyOf: (r) => snapshotKeyOf({ ...r, [parentKeyField]: parentId }, projection),
        });
        const stamped = fetched.map((row: any) => ({ ...row, [parentKeyField]: parentId }));
        if (stamped.length > 0 && isUnkeyableFetch(stamped, projection)) return 0;

        const { written } = await entityOps.snapshotReplace(stamped, { field: parentKeyField, value: parentId });
        return written;
      }

      if (config.byPk) {
        const target = config.byPk(pk);
        // No catch: the mutation that asked for this has already committed, so a failed read must
        // reject. Resolving 0 lets the screen report success while its row stays stale.
        const resp = await workerGet(ctx, target.url, target.params);
        const envelope = config.byPkRecordKey && resp && typeof resp === "object"
          ? resp[config.byPkRecordKey]
          : resp;
        // A single-record GET may answer with the object itself or a one-item list.
        const raw = Array.isArray(envelope) ? envelope[0] : envelope;
        if (raw && typeof raw === "object") {
          return await entityOps.upsertMany([raw]);
        }
        // The record is gone server-side; drop it so the table keeps no ghost.
        const key = entityKeyOf(pk, projection);
        if (key !== undefined) await entityOps.remove(key);
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
          label: config.name,
          params: { ...config.listParams, ...scopeConfig.params },
          batchSize: config.batchSize ?? 250,
          keyOf: (r) => snapshotKeyOf(r, projection),
        });

        if (scopedRecords.length > 0 && isUnkeyableFetch(scopedRecords, projection)) return 0;

        const { written } = await entityOps.snapshotReplace(scopedRecords, scopeConfig.scope);
        return written;
      }
      return 0;
    },
  };

  return syncDomain;
}

export function registerSnapshotDomain(
  config: SnapshotDomainConfig,
  getDb?: (omsInstance: string) => BaseDB,
): SyncDomain {
  return registerSyncDomain(defineSnapshotDomain(config, getDb));
}



