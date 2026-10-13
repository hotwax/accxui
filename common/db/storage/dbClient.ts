/**
 * Thin async operations layer over one Dexie database.
 *
 * Takes the BaseDB as a parameter rather than resolving the active OMS itself: the sync
 * worker loads this module and cannot import commonUtil, because that pins the @common
 * barrel into the worker chunk, which Vite must emit as a single iife.
 *
 * Reads return stored rows verbatim. There is no raw/projected distinction — a stored row
 * IS the projected row.
 */

import { liveQuery, type Observable, type Table } from "dexie";
import {
  type BaseDB,
  clearDatabaseTables,
  clearSyncedThisLogin,
  ensureDbReady,
  hasSyncedThisLogin,
  markSyncedThisLogin,
} from "./baseDb";
import type { DbKey, QueryOptions } from "../types";
import { listIndexField, type Entity } from "../schema/defineEntity";
import { diffStaleKeys, entityKeyOf, newestValue, projectRows, valuesAtPath } from "./projection";

function keysOfRows(rows: Array<Record<string, unknown>>, entity: Entity): DbKey[] {
  const keys: DbKey[] = [];
  for (const row of rows) {
    const key = entityKeyOf(row, entity);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

export interface EntityClient<T = Record<string, any>> {
  readonly table: string;
  get(key: DbKey): Promise<T | undefined>;
  getMany(keys: DbKey[]): Promise<T[]>;
  all(): Promise<T[]>;
  query(options?: QueryOptions): Promise<T[]>;
  first(options?: QueryOptions): Promise<T | undefined>;
  count(options?: QueryOptions): Promise<number>;

  put(record: T): Promise<void>;
  bulkPut(records: T[]): Promise<void>;
  remove(key: DbKey): Promise<void>;
  bulkRemove(keys: DbKey[]): Promise<void>;
  clear(): Promise<void>;

  live(options?: QueryOptions): Observable<T[]>;

  /** Upsert raw server records (insert-or-replace by primary key). Returns rows written. */
  upsertMany(rawRows: Array<Record<string, unknown>>): Promise<number>;

  /** Snapshot replace: upsert fresh rows and prune stale rows in scope. */
  snapshotReplace(
    rawRows: Array<Record<string, unknown>>,
    scope?: { field: string; value: unknown },
  ): Promise<{ written: number; pruned: number }>;

  /** Newest cached value of dateField, optionally scoped. */
  newestCursor(
    dateField: string,
    scope?: { field: string; value: unknown },
    equals?: Record<string, unknown>,
  ): Promise<number | undefined>;

  /** Cached rows missing dateField. */
  rowsMissing(
    dateField: string,
    options?: { limit?: number; since?: { field: string; afterMs: number } },
  ): Promise<T[]>;
}

/** The reads of an `EntityClient`, run inside a `liveRead` transaction. */
export interface TxEntityReader<T = Record<string, any>> {
  get(key: DbKey): Promise<T | undefined>;
  getMany(keys: DbKey[]): Promise<T[]>;
  all(): Promise<T[]>;
  query(options?: QueryOptions): Promise<T[]>;
  first(options?: QueryOptions): Promise<T | undefined>;
  count(options?: QueryOptions): Promise<number>;
}

/**
 * A table this client can address: one the schema declared, or `syncMeta`, which `BaseDB` adds
 * to every database. `Tables` defaults to `string`, so an untyped client takes any name.
 */
export type TableName<Tables extends string = string> = Tables | "syncMeta";

/**
 * Read-only access to the tables a `liveRead` opened. Its reads skip `ensureDbReady`: the gate
 * already passed before the transaction began, and awaiting it again inside could let the
 * transaction commit early.
 */
export interface TxReader<Tables extends string = string> {
  entity<T = Record<string, any>>(table: TableName<Tables>): TxEntityReader<T>;
}

export interface DbClient<Tables extends string = string> {
  get<T = any>(table: TableName<Tables>, key: DbKey): Promise<T | undefined>;
  getMany<T = any>(table: TableName<Tables>, keys: DbKey[]): Promise<T[]>;
  all<T = any>(table: TableName<Tables>): Promise<T[]>;
  query<T = any>(table: TableName<Tables>, options?: QueryOptions): Promise<T[]>;
  first<T = any>(table: TableName<Tables>, options?: QueryOptions): Promise<T | undefined>;
  count(table: TableName<Tables>, options?: QueryOptions): Promise<number>;
  put<T = any>(table: TableName<Tables>, record: T): Promise<void>;
  bulkPut<T = any>(table: TableName<Tables>, records: T[]): Promise<void>;
  remove(table: TableName<Tables>, key: DbKey): Promise<void>;
  bulkRemove(table: TableName<Tables>, keys: DbKey[]): Promise<void>;
  clear(table: TableName<Tables>): Promise<void>;
  entity<T = Record<string, any>>(table: TableName<Tables>): EntityClient<T>;
  transaction<T>(mode: "r" | "rw", tables: TableName<Tables>[], fn: () => Promise<T>): Promise<T>;
  /**
   * Live read across several tables: pass the gate once, then run `fn` in ONE "r" transaction over
   * `tables`, so it sees them all at the same point. Re-emits when any row it read is written.
   */
  liveRead<R>(tables: TableName<Tables>[], fn: (tx: TxReader<Tables>) => Promise<R>): Observable<R>;
  /** One-shot `liveRead`: the same gate and transaction, answered once. */
  read<R>(tables: TableName<Tables>[], fn: (tx: TxReader<Tables>) => Promise<R>): Promise<R>;
  /** Name of the database the client resolves to now. Throws when none can be resolved. */
  name(): string;
  /** Whether `domain` has synced since this login (its `loginSync:` marker in `syncMeta`). */
  syncedThisLogin(domain: string): Promise<boolean>;
  /** Record that `domain` synced this login. A failure is logged, not thrown. */
  markSyncedThisLogin(domain: string): Promise<void>;
  /** Drop `domain`'s login marker, so its next pass re-seeds it. */
  clearSyncedThisLogin(domain: string): Promise<void>;
  /**
   * Open and version-check the database now (`ensureDbReady`). Every operation does this anyway;
   * calling it first is an ORDERING guarantee, e.g. a rebuild before a worker opens its own handle.
   */
  ready(): Promise<void>;
  /** Empty every data table and the sync markers, keeping the schema version record (logout). */
  clearAllTables(): Promise<void>;
  tableNames(): string[];
  raw(): BaseDB;
}

function isMissingKey(key: DbKey): boolean {
  return key === undefined || key === null || key === ""
    || (Array.isArray(key) && key.length === 0);
}

/**
 * `EntityClient`'s reads, each after the readiness gate `tableRef` awaits. Never inside a
 * transaction — see `txReadsOf`.
 */
function readsOf<T>(tableRef: () => Promise<Table<any, DbKey>>): TxEntityReader<T> {
  return {
    async get(key) {
      if (isMissingKey(key)) return undefined;
      return (await tableRef()).get(key as any);
    },
    async getMany(keys) {
      if (!keys.length) return [];
      const rows = await (await tableRef()).bulkGet(keys);
      return rows.filter(Boolean) as any[];
    },
    async all() {
      return (await tableRef()).toArray();
    },
    async query(options = {}) {
      return runQuery(await tableRef(), options);
    },
    async first(options = {}) {
      const rows = await runQuery(await tableRef(), { ...options, limit: 1 });
      return rows[0];
    },
    async count(options) {
      const table = await tableRef();
      if (!options || Object.keys(options).length === 0) return table.count();
      return (await runQuery(table, options)).length;
    },
  };
}

/**
 * The same reads for INSIDE a `read` / `liveRead` transaction: each calls the Dexie table directly
 * and stays a Dexie promise chain. No `async` wrapper and no `await` of the table handle — awaiting a
 * plain value in a transaction scope drops Dexie's transaction zone, so the read runs outside the
 * transaction, the transaction finds no pending request, and Dexie aborts it with
 * `PrematureCommitError` ("Transaction committed too early").
 */
function txReadsOf<T>(table: Table<any, DbKey>): TxEntityReader<T> {
  return {
    get(key) {
      if (isMissingKey(key)) return Promise.resolve(undefined);
      return table.get(key as any) as unknown as Promise<T | undefined>;
    },
    getMany(keys) {
      if (!keys.length) return Promise.resolve([]);
      return table.bulkGet(keys).then((rows) => rows.filter(Boolean)) as unknown as Promise<T[]>;
    },
    all() {
      return table.toArray() as unknown as Promise<T[]>;
    },
    query(options = {}) {
      return runQuery(table, options);
    },
    first(options = {}) {
      return runQuery(table, { ...options, limit: 1 }).then((rows) => rows[0]);
    },
    count(options) {
      if (!options || Object.keys(options).length === 0) return table.count() as unknown as Promise<number>;
      return runQuery(table, options).then((rows) => rows.length);
    },
  };
}

/** Dexie reports a compound index as `[a+b]`; tolerate whitespace in a hand-written one. */
function normalizeIndexName(name: string): string {
  return name.replace(/\s+/g, "");
}

function hasIndex(tableRef: Table<any, DbKey>, path: string): boolean {
  const schema: any = tableRef.schema ?? {};
  if (normalizeIndexName(schema.primKey?.name ?? "") === path) return true;
  return (schema.indexes ?? []).some((index: any) => normalizeIndexName(index?.name ?? "") === path);
}

/**
 * The index that answers an equality on `field`: the field's own index, or — for a dotted path
 * into a list — the multi-value index on its hidden flattened field. Undefined when neither exists.
 */
function indexFor(tableRef: Table<any, DbKey>, field: string): string | undefined {
  if (hasIndex(tableRef, field)) return field;
  if (field.includes(".") && hasIndex(tableRef, listIndexField(field))) return listIndexField(field);
  return undefined;
}

/**
 * The in-memory form of an equality. A dotted path reads the nested value, and a list (at the
 * field or anywhere on the path) matches when ANY of its values does — what a multi-value index
 * returns, so a query answers the same whether or not the index exists.
 */
function matchesEquality(row: Record<string, unknown>, field: string, value: unknown): boolean {
  if (row?.[field] === value) return true;
  return valuesAtPath(row, field).some((candidate) => candidate === value);
}

function dateOf(row: Record<string, unknown>, dateField: string): number | undefined {
  const value = row?.[dateField];
  return typeof value === "number" ? value : undefined;
}

/**
 * Run a query and return its rows.
 *
 * `scope` and `equals` are ONE set of equalities — `scope` is simply the first of them — and every
 * one of them holds on the result. The read resolves through the widest declared index that covers
 * them (`[scope+...equals+dateField]`, then `[scope+...equals]`, then the first indexed field), and
 * whatever the index could not absorb is applied in memory.
 *
 * `dateField` ORDERS the result, newest first unless `order: "asc"`; `since`/`until` bound it. This is
 * the "latest N" read every monitoring screen makes, so a `dateField` that did not sort would hand
 * them the oldest rows instead.
 */
async function runQuery(
  tableRef: Table<any, DbKey>,
  options: QueryOptions = {},
): Promise<any[]> {
  const { scope, dateField, since, until, filter, limit } = options;
  const equalities: Array<[string, unknown]> = [
    ...(scope ? [[scope.field, scope.value] as [string, unknown]] : []),
    ...Object.entries(options.equals ?? {}).filter(([field]) => field !== scope?.field),
  ];
  const fields = equalities.map(([field]) => field);
  const values = equalities.map(([, value]) => value);
  const lower = since ?? -Infinity;
  const upper = until ?? Infinity;

  let rows: any[];
  let remaining = equalities;
  /** The index delivered rows ascending by `dateField`, already inside since/until. */
  let dateOrdered = false;

  const withDate = dateField ? `[${[...fields, dateField].join("+")}]` : "";
  const compound = `[${fields.join("+")}]`;

  if (dateField && fields.length && hasIndex(tableRef, withDate)) {
    rows = await tableRef.where(withDate).between([...values, lower], [...values, upper], true, true).toArray();
    remaining = [];
    dateOrdered = true;
  } else if (fields.length > 1 && hasIndex(tableRef, compound)) {
    rows = await tableRef.where(compound).equals(values as any).toArray();
    remaining = [];
  } else if (fields.length) {
    const seek = fields.findIndex((field) => indexFor(tableRef, field) !== undefined);
    if (seek >= 0) {
      rows = await tableRef.where(indexFor(tableRef, fields[seek])!).equals(values[seek] as any).toArray();
      remaining = equalities.filter((_, index) => index !== seek);
    } else {
      rows = await tableRef.toArray();
    }
  } else if (dateField && hasIndex(tableRef, dateField)) {
    rows = since !== undefined || until !== undefined
      ? await tableRef.where(dateField).between(lower, upper, true, true).toArray()
      : await tableRef.orderBy(dateField).toArray();
    dateOrdered = true;
  } else {
    rows = await tableRef.toArray();
  }

  if (remaining.length) {
    rows = rows.filter((row) => remaining.every(([field, value]) => matchesEquality(row, field, value)));
  }
  if (dateField && !dateOrdered && (since !== undefined || until !== undefined)) {
    rows = rows.filter((row) => {
      const at = dateOf(row, dateField);
      return at !== undefined && at >= lower && at <= upper;
    });
  }
  if (filter) rows = rows.filter(filter);

  const order = options.order ?? (dateField ? "desc" : "asc");
  if (dateField) {
    if (!dateOrdered) {
      rows = [...rows].sort((a, b) => (dateOf(a, dateField) ?? 0) - (dateOf(b, dateField) ?? 0));
    }
    if (order === "desc") rows = [...rows].reverse();
  } else if (order === "desc") {
    rows = [...rows].reverse();
  }

  return limit && limit > 0 ? rows.slice(0, limit) : rows;
}

/**
 * `source` may be a database or a RESOLVER for one. A resolver is late-binding: every operation
 * asks for the current handle, so a client held in a module-scope const (as the worker sync
 * domains hold theirs) follows an OMS-instance switch instead of staying pinned to the handle
 * that existed at import time — which `defineAppDb.get()` closes on the switch, leaving every
 * later read to fail with DatabaseClosedError.
 */
export function dbClient<Tables extends string = string>(
  source: BaseDB | (() => BaseDB),
  schemaEntities?: Record<Tables, Entity>,
): DbClient<Tables>;
export function dbClient(
  source: BaseDB | (() => BaseDB),
  schemaEntities?: Record<string, Entity>,
): DbClient {
  const resolveDb = typeof source === "function" ? source : () => source;
  const tableOf = (table: string) => resolveDb().table<any, DbKey>(table);
  const clients = new Map<string, EntityClient<any>>();
  /** The current database, past `ensureDbReady`. */
  const readyDb = async () => {
    const db = resolveDb();
    if (db && typeof db.isOpen === "function") {
      await ensureDbReady(db);
    }
    return db;
  };

  const client: DbClient = {
    entity<T = Record<string, any>>(table: string): EntityClient<T> {
      let instance = clients.get(table);
      if (!instance) {
        /**
         * The projection comes from the composed SCHEMA, not from the Dexie handle — a Dexie
         * database carries stores, not entity declarations, so reading it off the handle silently
         * yields undefined and every write degrades to storing the raw server record.
         */
        const entityDefOf = (): Entity => {
          const entity = schemaEntities?.[table];
          if (!entity) {
            throw new Error(
              `[db] dbClient: no entity definition for table "${table}". ` +
              "A write cannot be projected without one; declare the table in the app schema.",
            );
          }
          return entity;
        };
        /**
         * Every operation passes through here, so `ensureDbReady` gates every read and write —
         * no query runs, and no `liveQuery` subscribes, against a database whose declared version
         * has not been verified. The version check inside it is memoised per database, so this
         * costs one already-resolved await after the first call.
         */
        const dexieTable = async () => {
          await readyDb();
          return tableOf(table);
        };

        instance = {
          table,
          ...readsOf<any>(dexieTable),

          async put(record) {
            await (await dexieTable()).put(record as any);
          },
          async bulkPut(records) {
            if (!records.length) return;
            await (await dexieTable()).bulkPut(records as any[]);
          },
          async remove(key) {
            await (await dexieTable()).delete(key);
          },
          async bulkRemove(keys) {
            if (!keys.length) return;
            await (await dexieTable()).bulkDelete(keys);
          },
          async clear() {
            await (await dexieTable()).clear();
          },
          live(options = {}) {
            return liveQuery(async () => runQuery(await dexieTable(), options)) as any;
          },

          async upsertMany(rawRows) {
            const entityDef = entityDefOf();
            const rows = projectRows(rawRows, entityDef, Date.now());
            if (rows.length > 0) await (await dexieTable()).bulkPut(rows as any[]);
            return rows.length;
          },

          async snapshotReplace(rawRows, scope) {
            const entityDef = entityDefOf();
            const rows = projectRows(rawRows, entityDef, Date.now());
            let pruned = 0;
            const tableRef = await dexieTable();
            await resolveDb().transaction("rw", [table], async () => {
              let existingKeys: DbKey[] = [];
              if (scope) {
                // The scope narrows WHICH rows are candidates; the keys to delete are still their
                // own primary keys, never the scope value they share.
                const scoped = await tableRef.where(scope.field).equals(scope.value as any).toArray();
                existingKeys = keysOfRows(scoped, entityDef);
              } else {
                existingKeys = (await tableRef.toCollection().primaryKeys()) as DbKey[];
              }

              const freshKeys = keysOfRows(rows, entityDef);
              const stale = diffStaleKeys(existingKeys, freshKeys);
              if (stale.length > 0) {
                await tableRef.bulkDelete(stale);
                pruned = stale.length;
              }
              if (rows.length > 0) {
                await tableRef.bulkPut(rows as any[]);
              }
            });
            return { written: rows.length, pruned };
          },

          async newestCursor(dateField, scope, equals) {
            const tableRef = await dexieTable();
            const equalityFields = equals ? Object.keys(equals) : [];
            if (scope && equalityFields.length) {
              const path = `[${[scope.field, ...equalityFields, dateField].join("+")}]`;
              const indexed = (tableRef.schema?.indexes ?? []).some(
                (index: any) => (index?.name ?? "").replace(/\s+/g, "") === path,
              );
              const prefix = [scope.value, ...equalityFields.map((field) => equals![field])];
              if (indexed) {
                const newest = await tableRef
                  .where(path)
                  .between([...prefix, -Infinity], [...prefix, Infinity])
                  .last();
                return newest?.[dateField] as number | undefined;
              }
              const rows = (await tableRef.where(scope.field).equals(scope.value as any).toArray())
                .filter((row: any) => equalityFields.every((field) => row[field] === equals![field]));
              return newestValue(rows, dateField);
            }
            if (scope) {
              const rows = await tableRef.where(scope.field).equals(scope.value as any).toArray();
              return newestValue(rows, dateField);
            }
            if (equalityFields.length) {
              const [first, ...rest] = equalityFields;
              const firstIndexed = (tableRef.schema?.indexes ?? []).some(
                (index: any) => (index?.name ?? "").replace(/\s+/g, "") === first,
              );
              const rows = firstIndexed
                ? await tableRef.where(first).equals(equals![first] as any).toArray()
                : await tableRef.toArray();
              const narrowed = rows.filter((row: any) =>
                (firstIndexed ? rest : equalityFields).every((field) => row[field] === equals![field]));
              return newestValue(narrowed, dateField);
            }
            const newest = await tableRef.orderBy(dateField).last();
            return newest?.[dateField] as number | undefined;
          },

          async rowsMissing(dateField, options = {}) {
            const { limit = 50, since } = options;
            const tableRef = await dexieTable();
            const indexed = since
              ? (tableRef.schema?.indexes ?? []).some(
                  (index: any) => (index?.name ?? "").replace(/\s+/g, "") === since.field,
                )
              : false;

            const collection = since && indexed
              ? tableRef.where(since.field).above(since.afterMs)
              : tableRef.toCollection();

            const rows = await collection
              .filter((row: any) => {
                if (row[dateField] !== undefined) return false;
                if (!since || indexed) return true;
                const stamp = row[since.field];
                return typeof stamp === "number" && stamp > since.afterMs;
              })
              .limit(limit)
              .toArray();

            return rows as T[];
          },
        };
        clients.set(table, instance);
      }
      return instance as EntityClient<T>;
    },

    get: (table, key) => client.entity<any>(table).get(key),
    getMany: (table, keys) => client.entity<any>(table).getMany(keys),
    all: (table) => client.entity<any>(table).all(),
    query: (table, options) => client.entity<any>(table).query(options),
    first: (table, options) => client.entity<any>(table).first(options),
    count: (table, options) => client.entity<any>(table).count(options),
    put: (table, record) => client.entity<any>(table).put(record),
    bulkPut: (table, records) => client.entity<any>(table).bulkPut(records),
    remove: (table, key) => client.entity<any>(table).remove(key),
    bulkRemove: (table, keys) => client.entity<any>(table).bulkRemove(keys),
    clear: (table) => client.entity<any>(table).clear(),

    transaction(mode, tables, fn) {
      return resolveDb().transaction(mode, tables, fn) as Promise<any>;
    },
    liveRead(tables, fn) {
      // The querier must itself be `async`: Dexie only carries its read tracking across the awaits
      // inside it for an async querier, so a plain arrow returning the promise would never re-run.
      return liveQuery(async () => await client.read(tables, fn)) as any;
    },
    async read(tables, fn) {
      const db = resolveDb();
      await ensureDbReady(db);
      const tx: TxReader = {
        entity: <T>(table: string) => txReadsOf<T>(db.table<any, DbKey>(table)),
      };
      return await db.transaction("r", tables, () => fn(tx));
    },
    name() {
      return resolveDb().name;
    },
    async syncedThisLogin(domain) {
      return hasSyncedThisLogin(await readyDb(), domain);
    },
    async markSyncedThisLogin(domain) {
      await markSyncedThisLogin(await readyDb(), domain);
    },
    async clearSyncedThisLogin(domain) {
      await clearSyncedThisLogin(await readyDb(), domain);
    },
    async ready() {
      await ensureDbReady(resolveDb());
    },
    async clearAllTables() {
      await clearDatabaseTables(await readyDb());
    },
    tableNames() {
      return resolveDb().getTableNames();
    },
    raw() {
      return resolveDb();
    },
  };

  return client;
}

