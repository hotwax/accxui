/**
 * Factory for class-A (live, append-mostly) incremental sync domains.
 *
 * The counterpart to `snapshotDomain`: that one fetches a COMPLETE set and replaces it; this one
 * fetches the slice newer than what is already stored and upserts it. Nothing is ever pruned here,
 * so a soft failure cannot empty a table.
 *
 * Imports no `vue` and not the `@common/db` barrel — worker chunks must stay a single iife.
 */

import type { BaseDB } from "../baseDb";
import type { Entity } from "../defineEntity";
import { keepNewerThan } from "../projection";
import type { SyncContext, SyncDomain } from "../types";
import { defineCachedEntity } from "./snapshotDomain";
import { registerSyncDomain } from "./syncRegistry";
import { pageNewestFirst } from "./workerFetch";

export interface CursorDomainConfig {
  name: string;
  label: string;
  table: string;
  projection: Entity;
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
   *
   * MUST NOT narrow the record set — anything returned here is sent to the server but is not
   * applied client-side, so a `paramsOf` value that filters the endpoint's response (e.g. a type
   * or status id) would compute `count`/`newestCursor` over a broader set than the server actually
   * returns. Once the (unfiltered) count reaches `total`, the cursor keeps every row older than
   * that global newest — for THIS filter's rows too — and they are silently, permanently never
   * fetched again. Use `narrowOf` for any param that narrows what the endpoint returns.
   */
  paramsOf?: (args: any) => Record<string, unknown>;
  /**
   * A server-side filter that also narrows the record set — feeds BOTH the request params and the
   * `count`/`newestCursor` calls, so the server-side filter and the cursor can never disagree.
   */
  narrowOf?: (args: any) => Record<string, unknown>;
}

export function registerCursorDomain(
  config: CursorDomainConfig,
  getDb: (omsInstance: string) => BaseDB,
): SyncDomain {
  const target = config.total ?? 100;
  const batchSize = config.batchSize ?? 25;

  const domain: SyncDomain = {
    name: config.name,
    label: config.label,
    syncClass: "A",
    ...(config.intervalMs ? { intervalMs: config.intervalMs } : {}),

    async sync(ctx: SyncContext, args: any = {}) {
      const db = getDb(ctx.omsInstance);
      const entity = defineCachedEntity(db, config.table, config.projection);
      const scope = config.scopeOf?.(args);
      const narrow = config.narrowOf?.(args);

      /**
       * A SHALLOW WINDOW IS DEEPENED, NOT TOPPED UP.
       *
       * A cursor plus `keep` stops paging at the first already-stored row — page 0, every tick,
       * once anything is cached. So `total` would only ever apply to an EMPTY scope and raising it
       * later would do nothing. Below target: page from zero with no cursor until the scope holds
       * `total`. At target: the normal one-page incremental read.
       *
       * `narrow` must be passed to BOTH `count`/`newestCursor` here and the request params below —
       * a cursor computed over a broader record set than the server actually filters to would keep
       * discarding this filter's older rows forever once the table reaches `total`.
       */
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
          // Moqui's `_from` is INCLUSIVE, so the boundary row returns on every quiet poll; the
          // client-side cutoff in `keep` drops it and a quiet tick writes nothing.
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
      const db = getDb(ctx.omsInstance);
      const entity = defineCachedEntity(db, config.table, config.projection);
      const keyField = config.projection.primaryKeyFields[0];
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

  return registerSyncDomain(domain);
}
