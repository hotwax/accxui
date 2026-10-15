/**
 * Declarative single-database creation for AccxUI apps.
 *
 * An app composes an `AppSchema` — picked seed tables merged with its own via `mergeSchemas` — and
 * this module creates one database per OMS instance from it, and exposes the accessors.
 *
 * Imports are deliberately narrow — `dexie`, `baseDb`, `dbClient` and plain seed data. It must
 * never import the `@common/db` barrel or anything pulling in `vue`, because app db modules are
 * imported by sync workers whose chunk Vite emits as a single iife.
 */

import type { AppSchema, TableNames } from "./defineSchema";
import type { Entity } from "./defineEntity";
import type { SyncDomainCatalogItem } from "../composables/useDbStatus";
import { commonDomainsByTable } from "../seed/seedDomains";
import { BaseDB } from "../storage/baseDb";
import { type DbClient, type EntityClient, dbClient } from "../storage/dbClient";
import { setAppDb } from "./appDbRegistry";

export interface AppDbDefinition<Tables extends string = string> {
  /** Name suffix: "CompanyDB" produces `{omsInstance}-CompanyDB`. */
  suffix: string;
  /**
   * The schema version, and the only knob. Bump it for ANY change to this schema — a new table, an
   * added or removed index, a changed primary key, a changed `fields` map or `rename`.
   *
   * A database recording a different version is dropped and rebuilt on first use rather than
   * migrated; see `ensureDbReady`. Nothing detects a FORGOTTEN bump — rows keep the previous
   * build's shape with no error — so treat bumping this as part of changing the schema.
   */
  version?: number;
  /** The composed schema: `commonSchema.pick([...])` merged with the app's own via `mergeSchemas`. */
  schema: AppSchema<Tables>;
}

/**
 * An app's database. `Tables` is the table names the app's schema declared, so `entity(...)` and
 * every table-taking `client()` method reject a name the app does not have at compile time.
 *
 * There is deliberately no raw Dexie handle here: every read and write goes through `client()` /
 * `entity()`, the one access layer.
 */
export interface AppDb<Tables extends string = string> {
  /** `{omsInstance}-{suffix}`. Throws on an empty instance. */
  name(omsInstance: string): string;
  /**
   * The database for an instance. For the WORKER ENTRY only, which hands it to the sync harness
   * (`exposeWorkerHarness`); app code reads and writes through `client()` / `entity()`.
   */
  get(omsInstance: string): BaseDB;
  /** Register how the app finds the signed-in instance. Called once per JS realm at boot. */
  setOmsInstanceResolver(resolve: () => string): void;
  /** DbClient for the signed-in instance, resolved per call so reads follow a switch. */
  client(): DbClient<Tables>;
  /** EntityClient for the signed-in instance and named table. */
  entity<T = Record<string, any>>(table: Tables): EntityClient<T>;
  readonly schema: Record<Tables, string>;
  readonly entities: Record<Tables, Entity>;
  /** The table names: `companyDb.tables.facilities`. Static, like `entities`; no database involved. */
  readonly tables: TableNames<Tables>;
  /** The declared schema version. A database recording a different one is rebuilt on first use. */
  readonly version: number;
  /** The composed data tables. Excludes `syncMeta`, which BaseDB injects. */
  readonly tableNames: Tables[];
  /** One entry per composed table that has a seed source. The app's own tables are absent. */
  readonly statusCatalog: SyncDomainCatalogItem[];
  /** Tables that came from the framework seed schema. The app's own tables are absent. */
  readonly seedTables: ReadonlySet<string>;
}

/** The table names of an app database, e.g. `AppDbTables<typeof companyDb>` for a helper's `table` parameter. */
export type AppDbTables<Db> = Db extends AppDb<infer Tables> ? Tables : never;

export function defineAppDb<Tables extends string>(def: AppDbDefinition<Tables>): AppDb<Tables> {
  if(!def.suffix) {
    throw new Error("[db] defineAppDb: a non-empty `suffix` is required.");
  }

  const stores = def.schema.stores;
  const version = def.version ?? 1;

  // Derived from the composed tables, so it can never list a table the database does not have.
  const statusCatalog: SyncDomainCatalogItem[] = Object.keys(stores)
    // Provenance, not name. An app may declare its own table with a seed table's name.
    .filter((table) => def.schema.seedTables.has(table) && table in commonDomainsByTable)
    .map((table) => ({
      name: commonDomainsByTable[table].name,
      table,
      label: commonDomainsByTable[table].label,
      syncClass: commonDomainsByTable[table].syncClass,
    }));

  class AppDatabase extends BaseDB {
    constructor(dbName: string) {
      super(dbName, stores, version);
    }
  }

  let activeDb: AppDatabase | null = null;
  let resolveOmsInstance: (() => string) | null = null;

  function name(omsInstance: string): string {
    if(!omsInstance) {
      throw new Error(`[db] Cannot open the ${def.suffix} database: no OMS instance.`);
    }
    return `${omsInstance}-${def.suffix}`;
  }

  function get(omsInstance: string): BaseDB {
    const dbName = name(omsInstance);
    if(activeDb?.name === dbName) {
      return activeDb;
    }
    // Close the previous handle so a liveQuery still holding it stops serving the old tenant.
    activeDb?.close();
    activeDb = new AppDatabase(dbName);
    return activeDb;
  }

  /** The signed-in instance's database. Internal: the client resolves through it, nothing else. */
  function raw(): BaseDB {
    if(!resolveOmsInstance) {
      throw new Error(
        `[db] No OMS instance resolver registered for ${def.suffix}; call setOmsInstanceResolver at boot.`,
      );
    }
    return get(resolveOmsInstance());
  }

  /**
   * ONE late-binding client for the app. Built from `raw` (the resolver), never from a handle, so
   * a client or entity a caller holds — the worker sync domains hold theirs in module-scope
   * consts, created at import time before `start()` names the instance — resolves the live
   * database on every operation. Capturing a handle instead pinned those callers to the handle
   * `get()` closes on an instance switch, and every later read threw DatabaseClosedError.
   */
  const lateClient = dbClient<Tables>(raw, def.schema.entities);

  const appDb: AppDb<Tables> = {
    name,
    get,
    setOmsInstanceResolver(resolve) {
      resolveOmsInstance = resolve;
    },
    client: () => lateClient,
    entity: (table) => lateClient.entity(table),
    schema: stores,
    entities: def.schema.entities,
    tables: def.schema.tables,
    version,
    tableNames: Object.keys(stores) as Tables[],
    statusCatalog,
    seedTables: def.schema.seedTables,
  };

  setAppDb(appDb);
  return appDb;
}
