/**
 * Base Dexie Database wrapper and Entity definition engine.
 */

import Dexie, { type Table } from "dexie";

export class BaseDB extends Dexie {
  syncMeta!: Table<Record<string, any>, string>;
  protected _tableNames: string[] = [];
  /** The schema version this build declares. `ensureDbReady` rebuilds when a database disagrees. */
  readonly declaredVersion: number;

  /**
   * `version` is the ONE knob. Bump it for any schema change at all — a new table, an added or
   * removed index, a changed primary key, a changed `fields` map or `rename`. A database that
   * records a different version is dropped and rebuilt rather than migrated (see `ensureDbReady`),
   * because nothing stored here is authoritative: every row is re-derivable from the OMS, so
   * rebuilding is cheaper than reasoning about which changes Dexie can carry in place and which
   * leave rows the new code cannot read.
   */
  constructor(dbName: string, schema: Record<string, string>, version = 1) {
    super(dbName);
    this.declaredVersion = version;
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

/** The key under which a database records the schema version it was built with. */
const SCHEMA_VERSION_KEY = "schemaVersion";

/**
 * Databases whose declared version has already been verified in this realm, keyed by database name.
 *
 * Only the CHECK is memoised, never the open: `ensureDbReady` stays re-runnable so a connection
 * that closed later — an OMS-instance switch closes the previous handle, and Dexie closes one
 * itself when another tab fires `versionchange` — is reopened rather than answered "ready".
 *
 * Keyed by name, so switching instance verifies the other tenant's database on its first use.
 */
const versionChecked = new Map<string, Promise<void>>();

/** Test-only: forget which databases have been verified. */
export function __resetDbVersionChecks(): void {
  versionChecked.clear();
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

async function openDb(db: BaseDB): Promise<void> {
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
 * Drop and rebuild when the database was built by a different declared version.
 *
 * An absent marker counts as a mismatch, so installs predating the marker land on a known state,
 * and so does a LOWER declared version, which is what a rolled-back deploy looks like.
 *
 * Reads `syncMeta` through raw Dexie rather than `dbClient`: every `dbClient` operation calls
 * `ensureDbReady`, so routing this through it would re-enter the gate that is awaiting this.
 */
async function verifyDeclaredVersion(db: BaseDB): Promise<void> {
  const recorded = (await db.syncMeta.get(SCHEMA_VERSION_KEY))?.version;
  if (Number(recorded) === db.declaredVersion) return;

  console.info(
    `[db] ${db.name} was built by version ${recorded ?? "an unrecorded build"}, ` +
    `this build declares ${db.declaredVersion} — rebuilding.`,
  );
  db.close();
  await Dexie.delete(db.name);
  await db.open();
  await db.syncMeta.put({
    key: SCHEMA_VERSION_KEY,
    version: db.declaredVersion,
    timestamp: Date.now(),
  });
}

/**
 * Make the database usable: open it, and rebuild it if it was built by a different version.
 *
 * Every read and write reaches this — `dbClient` awaits it before each operation, the worker
 * harness on start, and the status card — so no query can run, and no `liveQuery` can subscribe,
 * against a database that has not been verified. That ordering is what makes the rebuild safe:
 * `Dexie.delete` blocks on open connections, and by construction there are none yet.
 */
export async function ensureDbReady(db: BaseDB): Promise<void> {
  await openDb(db);

  let checked = versionChecked.get(db.name);
  if (!checked) {
    // Swallowed, never rethrown, and not retried: a failed check must not block boot, and
    // re-attempting a destructive rebuild on every read would be worse than serving what is there.
    checked = verifyDeclaredVersion(db).catch((error) => {
      console.warn(`[db] Version check failed for ${db.name}:`, error);
    });
    versionChecked.set(db.name, checked);
  }
  await checked;
}

/** Drop the superseded fixed-name cache databases, if present. */
export async function deleteLegacyCaches(): Promise<void> {
  await Promise.allSettled([
    Dexie.delete("DataManagerLogCacheDB"),
    Dexie.delete("CompanyCacheDB"),
  ]);
}
