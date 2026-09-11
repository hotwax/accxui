/**
 * Base Dexie Database wrapper and Entity definition engine.
 */

import Dexie, { type Table } from "dexie";

export class BaseDB extends Dexie {
  syncMeta!: Table<Record<string, any>, string>;
  protected _tableNames: string[] = [];

  /**
   * `version` is declared, not inferred. Dexie upgrades ADDITIVE changes in place — new tables,
   * added or removed secondary indexes — so bumping it is enough for those. It throws
   * "Not yet support for changing primary key" when a store's keyPath changes, which no version
   * bump can carry; `ensureDbReady` deletes and rebuilds the database in that case.
   */
  constructor(dbName: string, schema: Record<string, string>, version = 1) {
    super(dbName);
    const combinedSchema = {
      ...schema,
      syncMeta: "key",
    };
    this._tableNames = Object.keys(combinedSchema);
    this.version(version).stores(combinedSchema);
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

/**
 * Bumped whenever the stored row shape changes in a way existing rows cannot satisfy.
 * On mismatch the data tables are cleared once and the worker refills them.
 * v2: `raw` removed from stored rows.
 */
export const DB_SHAPE_VERSION = 2;
const SHAPE_MARKER_KEY = "dbShapeVersion";

/**
 * Clear the local data tables once whenever `DB_SHAPE_VERSION` has moved past what this database
 * last recorded. Never throws — a failed shape check must not block boot.
 */
export async function ensureRowShape(db: BaseDB): Promise<void> {
  try {
    await ensureDbReady(db);
    const marker = await db.syncMeta.get(SHAPE_MARKER_KEY);
    if (Number(marker?.version) === DB_SHAPE_VERSION) return;

    console.info(`[db] Row shape changed, clearing local tables for ${db.name}.`);
    await clearDatabaseTables(db);
    await db.syncMeta.put({ key: SHAPE_MARKER_KEY, version: DB_SHAPE_VERSION, timestamp: Date.now() });
  } catch (error) {
    console.warn("[db] Row shape check failed:", error);
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

/** Drop the superseded fixed-name cache databases, if present. */
export async function deleteLegacyCaches(): Promise<void> {
  await Promise.allSettled([
    Dexie.delete("DataManagerLogCacheDB"),
    Dexie.delete("CompanyCacheDB"),
  ]);
}
