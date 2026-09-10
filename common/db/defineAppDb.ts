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

import type { AppSchema } from "./defineSchema";
import type { Entity } from "./defineEntity";
import type { SyncDomainCatalogItem } from "./useDbStatus";
import { SEED_DOMAINS, SEED_SOURCES } from "./domains/seedDomains";
import { BaseDB } from "./baseDb";
import { type DbClient, type EntityClient, dbClient } from "./dbClient";
import { setAppDb } from "./appDbRegistry";

export interface AppDbDefinition {
  /** Name suffix: "CompanyDB" produces `{omsInstance}-CompanyDB`. */
  suffix: string;
  /**
   * Dexie schema version. Additive changes — a new table, an added or removed secondary index —
   * upgrade in place on a bump. A changed primary key cannot; see BaseDB's constructor.
   */
  version?: number;
  /** The composed schema: `commonSchema.pick([...])` merged with the app's own via `mergeSchemas`. */
  schema: AppSchema;
}

export interface AppDb {
  /** `{omsInstance}-{suffix}`. Throws on an empty instance. */
  name(omsInstance: string): string;
  /** The database for an instance. Worker-safe: the instance is a parameter. */
  get(omsInstance: string): BaseDB;
  /** Register how the app finds the signed-in instance. Called once per JS realm at boot. */
  setOmsInstanceResolver(resolve: () => string): void;
  /** Raw Dexie handle for the signed-in instance. Main thread, or a worker after start(). */
  raw(): BaseDB;
  /** DbClient for the signed-in instance, resolved per call so reads follow a switch. */
  client(): DbClient;
  /** EntityClient for the signed-in instance and named table. */
  entity<T = Record<string, any>>(table: string): EntityClient<T>;
  readonly schema: Record<string, string>;
  readonly entities: Record<string, Entity>;
  /** The composed data tables. Excludes `syncMeta`, which BaseDB injects. */
  readonly tableNames: string[];
  /** One entry per composed table that has a seed source. The app's own tables are absent. */
  readonly statusCatalog: SyncDomainCatalogItem[];
  /** Tables that came from the framework seed schema. The app's own tables are absent. */
  readonly seedTables: ReadonlySet<string>;
}

export function defineAppDb(def: AppDbDefinition): AppDb {
  if(!def.suffix) {
    throw new Error("[db] defineAppDb: a non-empty `suffix` is required.");
  }

  const stores = def.schema.stores;
  const version = def.version ?? 1;

  // Derived from the composed tables, so it can never list a table the database does not have.
  const statusCatalog: SyncDomainCatalogItem[] = Object.keys(stores)
    // Provenance, not name. An app may declare its own table with a seed table's name.
    .filter((table) => def.schema.seedTables.has(table) && table in SEED_SOURCES)
    .map((table) => ({
      name: SEED_SOURCES[table as keyof typeof SEED_SOURCES].name,
      table,
      label: SEED_SOURCES[table as keyof typeof SEED_SOURCES].label,
      syncClass: "B" as const,
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

  function raw(): BaseDB {
    if(!resolveOmsInstance) {
      throw new Error(
        `[db] No OMS instance resolver registered for ${def.suffix}; call setOmsInstanceResolver at boot.`,
      );
    }
    return get(resolveOmsInstance());
  }

  const appDb: AppDb = {
    name,
    get,
    setOmsInstanceResolver(resolve) {
      resolveOmsInstance = resolve;
    },
    raw,
    client: () => dbClient(raw()),
    entity: (table) => dbClient(raw()).entity(table),
    schema: stores,
    entities: def.schema.entities,
    tableNames: Object.keys(stores),
    statusCatalog,
    seedTables: def.schema.seedTables,
  };

  setAppDb(appDb);
  return appDb;
}
