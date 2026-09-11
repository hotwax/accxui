/**
 * Factory for class-A (live, append-mostly) incremental sync domains.
 *
 * The counterpart to `defineSnapshotDomain`: that one fetches a COMPLETE set and replaces it; this one
 * fetches the slice newer than what is already stored and upserts it. Nothing is ever pruned here,
 * so a soft failure cannot empty a table.
 *
 * Imports no `vue` and not the `@common/db` barrel — worker chunks must stay a single iife.
 */

import type { BaseDB } from "../baseDb";
import type { Entity } from "../defineEntity";
import { keepNewerThan } from "../projection";
import type { SyncContext, SyncDomain } from "../types";
import { getAppDb } from "../appDbRegistry";
import { defineCachedEntity } from "./defineSnapshotDomain";
import { registerSyncDomain } from "./syncRegistry";
import { pageNewestFirst } from "../../core/workerRemoteApi";

export interface CursorDomainConfig {
  name: string;
  label: string;
  table: string;
  projection?: Entity;
  intervalMs?: number;
  listUrl: string;
  collectionKey?: string | null;
  /** The stored date field that advances — the cursor. */
  cursorField: string;
  /** Server param that lower-bounds the cursor. Sent as an ISO string. */
  cursorParam: string;
  /** Server sort. Defaults to newest-first on the cursor field. */
  orderByField?: string;
  /** Rows to hold per scope. The window is DEEPENED to this before incremental reads begin. */
  total?: number;
  batchSize?: number;
  /** Resolve the partition from the activation args. */
  scopeOf?: (args: any) => { field: string; value: unknown } | undefined;
  /**
   * Extra server-side params from the activation args.
   */
  paramsOf?: (args: any) => Record<string, unknown>;
  /**
   * A server-side filter that also narrows the record set.
   */
  narrowOf?: (args: any) => Record<string, unknown>;
}

export function defineCursorDomain(
  config: CursorDomainConfig,
  getDb?: (omsInstance: string) => BaseDB,
): SyncDomain {
  const resolveDb = getDb ?? ((omsInstance: string) => getAppDb().get(omsInstance));
  const target = config.total ?? 100;
  const batchSize = config.batchSize ?? 25;

  const domain: SyncDomain = {
    name: config.name,
    table: config.table,
    label: config.label,
    syncClass: "A",
    ...(config.intervalMs ? { intervalMs: config.intervalMs } : {}),

    async sync(ctx: SyncContext, args: any = {}) {
      const db = resolveDb(ctx.omsInstance);
      const projection = config.projection ?? getAppDb().entities[config.table];
      if (!projection) {
        throw new Error(`[db] domain "${config.name}": no entity projection found for table "${config.table}".`);
      }

      const entity = defineCachedEntity(db, config.table, projection);
      const scope = config.scopeOf?.(args);
      const narrow = config.narrowOf?.(args);

      const cached = await entity.count(scope, narrow);
      const isShallow = cached < target;
      const cursor = isShallow ? undefined : await entity.newestCursor(config.cursorField, scope, narrow);

      const records = await pageNewestFirst({
        ctx,
        url: config.listUrl,
        collectionKey: config.collectionKey,
        label: config.label,
        total: isShallow ? target : batchSize,
        batchSize,
        params: {
          ...(config.paramsOf?.(args) ?? {}),
          ...(narrow ?? {}),
          ...(cursor !== undefined ? { [config.cursorParam]: new Date(cursor).toISOString() } : {}),
          orderByField: config.orderByField ?? `-${config.cursorField}`,
        },
        keep: cursor === undefined
          ? undefined
          : (page) => keepNewerThan(page, config.cursorField, cursor),
      });

      return entity.upsertMany(records);
    },

    async refetchOne(ctx: SyncContext, pk: Record<string, unknown>) {
      const db = resolveDb(ctx.omsInstance);
      const projection = config.projection ?? getAppDb().entities[config.table];
      if (!projection) {
        throw new Error(`[db] domain "${config.name}": no entity projection found for table "${config.table}".`);
      }

      const entity = defineCachedEntity(db, config.table, projection);
      const keyField = projection.primaryKeyFields[0];
      const id = pk?.[keyField];
      if (!id) return 0;

      const records = await pageNewestFirst({
        ctx,
        url: config.listUrl,
        collectionKey: config.collectionKey,
        label: config.label,
        total: 1,
        batchSize: 1,
        params: { [keyField]: id },
      });

      return entity.upsertMany(records);
    },
  };

  return domain;
}

export function registerCursorDomain(
  config: CursorDomainConfig,
  getDb?: (omsInstance: string) => BaseDB,
): SyncDomain {
  return registerSyncDomain(defineCursorDomain(config, getDb));
}
