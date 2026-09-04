/**
 * Base Dexie Database wrapper and Entity definition engine.
 */

import Dexie, { type Table, liveQuery, type Observable } from "dexie";
import type { DbEntity, DbRow, EntityProjection, LiveQueryOptions } from "./types";

export class BaseDB extends Dexie {
  syncMeta!: Table<Record<string, any>, string>;
  protected _tableNames: string[] = [];

  constructor(dbName: string, schema: Record<string, string>) {
    super(dbName);
    const combinedSchema = {
      ...schema,
      syncMeta: "key",
    };
    this._tableNames = Object.keys(combinedSchema);
    this.version(1).stores(combinedSchema);
  }

  getTableNames(): string[] {
    return this._tableNames;
  }
}

/**
 * Wipe all data tables in the given Dexie instance on logout.
 */
export async function clearDatabaseTables(db: BaseDB): Promise<void> {
  try {
    await db.transaction("rw", db.getTableNames(), async () => {
      for (const tableName of db.getTableNames()) {
        await db.table(tableName).clear();
      }
    });
  } catch (error) {
    console.error(`[db] Failed to clear tables for ${db.name}:`, error);
  }
}

const LOGIN_MARKER_PREFIX = "loginSync:";

export async function hasSyncedThisLogin(db: BaseDB, domain: string): Promise<boolean> {
  try {
    const record = await db.syncMeta.get(`${LOGIN_MARKER_PREFIX}${domain}`);
    return Boolean(record?.synced);
  } catch {
    return false;
  }
}

export async function markSyncedThisLogin(db: BaseDB, domain: string): Promise<void> {
  try {
    await db.syncMeta.put({
      key: `${LOGIN_MARKER_PREFIX}${domain}`,
      synced: true,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.warn(`[db] Failed to mark ${domain} synced:`, error);
  }
}

export async function ensureDbReady(db: BaseDB): Promise<void> {
  try {
    if (!db.isOpen()) {
      await db.open();
    }
  } catch (err: any) {
    console.warn(`[db] Database open failed for ${db.name}, rebuilding:`, err);
    try {
      db.close();
      await Dexie.delete(db.name);
      await db.open();
    } catch (rebuildErr) {
      console.error(`[db] Rebuild failed for ${db.name}:`, rebuildErr);
    }
  }
}

/**
 * Define a stored entity with liveQuery and snapshot read methods.
 */
export function defineDbEntity<T = Record<string, any>>(
  db: BaseDB,
  table: string,
  projection: EntityProjection,
): DbEntity<T> {
  function buildQuery(tableRef: Table<DbRow, string>, options: LiveQueryOptions = {}) {
    let collection: any;

    if (options.scope) {
      collection = tableRef.where(options.scope.field).equals(options.scope.value as any);
    } else if (options.equals && Object.keys(options.equals).length > 0) {
      const [firstKey, firstVal] = Object.entries(options.equals)[0];
      collection = tableRef.where(firstKey).equals(firstVal as any);
    } else if (options.dateField) {
      if (options.since !== undefined && options.until !== undefined) {
        collection = tableRef.where(options.dateField).between(options.since, options.until, true, true);
      } else if (options.since !== undefined) {
        collection = tableRef.where(options.dateField).aboveOrEqual(options.since);
      } else if (options.until !== undefined) {
        collection = tableRef.where(options.dateField).belowOrEqual(options.until);
      } else {
        collection = tableRef.toCollection();
      }
    } else {
      collection = tableRef.toCollection();
    }

    if (options.order === "desc") {
      collection = collection.reverse();
    }

    if (options.filter) {
      const predicate = options.filter;
      collection = collection.filter(predicate);
    }

    if (options.limit && options.limit > 0) {
      collection = collection.limit(options.limit);
    }

    return collection;
  }

  return {
    table,
    projection,
    live(options: LiveQueryOptions = {}): Observable<DbRow[]> {
      return liveQuery(async () => {
        const tableRef = db.table<DbRow, string>(table);
        const query = buildQuery(tableRef, options);
        return query.toArray();
      });
    },
    async get(key: string): Promise<T | undefined> {
      if (!key) return undefined;
      const row = await db.table<DbRow, string>(table).get(key);
      return (row?.raw as T) ?? (row as unknown as T);
    },
    async all(options: LiveQueryOptions = {}): Promise<T[]> {
      const tableRef = db.table<DbRow, string>(table);
      const query = buildQuery(tableRef, options);
      const rows = await query.toArray();
      return rows.map((r: DbRow) => (r.raw as T) ?? (r as unknown as T));
    },
  };
}
