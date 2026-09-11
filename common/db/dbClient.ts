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
import { type BaseDB, ensureDbReady } from "./baseDb";
import type { DbKey, QueryOptions } from "./types";
import type { Entity } from "./defineEntity";
import { diffStaleKeys, entityKeyOf, newestValue, projectRows } from "./projection";

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

export interface DbClient {
  get<T = any>(table: string, key: DbKey): Promise<T | undefined>;
  getMany<T = any>(table: string, keys: DbKey[]): Promise<T[]>;
  all<T = any>(table: string): Promise<T[]>;
  query<T = any>(table: string, options?: QueryOptions): Promise<T[]>;
  first<T = any>(table: string, options?: QueryOptions): Promise<T | undefined>;
  count(table: string, options?: QueryOptions): Promise<number>;
  put<T = any>(table: string, record: T): Promise<void>;
  bulkPut<T = any>(table: string, records: T[]): Promise<void>;
  remove(table: string, key: DbKey): Promise<void>;
  bulkRemove(table: string, keys: DbKey[]): Promise<void>;
  clear(table: string): Promise<void>;
  entity<T = Record<string, any>>(table: string): EntityClient<T>;
  transaction<T>(mode: "r" | "rw", tables: string[], fn: () => Promise<T>): Promise<T>;
  tableNames(): string[];
  raw(): BaseDB;
}

/** Build a Dexie Collection for the given options. */
function buildQuery(tableRef: Table<any, string>, options: QueryOptions = {}) {
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

  if (options.order === "desc") collection = collection.reverse();
  if (options.filter) collection = collection.filter(options.filter);
  if (options.limit && options.limit > 0) collection = collection.limit(options.limit);

  return collection;
}

/**
 * `source` may be a database or a RESOLVER for one. A resolver is late-binding: every operation
 * asks for the current handle, so a client held in a module-scope const (as the worker sync
 * domains hold theirs) follows an OMS-instance switch instead of staying pinned to the handle
 * that existed at import time — which `defineAppDb.get()` closes on the switch, leaving every
 * later read to fail with DatabaseClosedError.
 */
export function dbClient(source: BaseDB | (() => BaseDB)): DbClient {
  const resolveDb = typeof source === "function" ? source : () => source;
  const tableOf = (table: string) => resolveDb().table<any, DbKey>(table);
  const entities = new Map<string, EntityClient<any>>();

  const client: DbClient = {
    entity<T = Record<string, any>>(table: string): EntityClient<T> {
      let instance = entities.get(table);
      if (!instance) {
        // Resolved per call, not captured: an entity definition belongs to the live database.
        const entityDefOf = () => (resolveDb() as any).entities?.[table] as Entity | undefined;
        const dexieTable = async () => {
          const db = resolveDb();
          if (db && typeof db.isOpen === "function" && !db.isOpen()) {
            await ensureDbReady(db);
          }
          return tableOf(table);
        };

        instance = {
          table,
          async get(key) {
            const missing = key === undefined || key === null || key === ""
              || (Array.isArray(key) && key.length === 0);
            if (missing) return undefined;
            return (await dexieTable()).get(key as any);
          },
          async getMany(keys) {
            if (!keys.length) return [];
            const rows = await (await dexieTable()).bulkGet(keys);
            return rows.filter(Boolean) as any[];
          },
          async all() {
            return (await dexieTable()).toArray();
          },
          async query(options = {}) {
            return buildQuery(await dexieTable(), options).toArray();
          },
          async first(options = {}) {
            const rows = await buildQuery(await dexieTable(), { ...options, limit: 1 }).toArray();
            return rows[0];
          },
          async count(options) {
            const tableRef = await dexieTable();
            if (!options || Object.keys(options).length === 0) return tableRef.count();
            return buildQuery(tableRef, options).count();
          },

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
            return liveQuery(async () => buildQuery(await dexieTable(), options).toArray()) as any;
          },

          async upsertMany(rawRows) {
            const entityDef = entityDefOf();
            const rows = entityDef ? projectRows(rawRows, entityDef, Date.now()) : (rawRows as any[]);
            if (rows.length > 0) await (await dexieTable()).bulkPut(rows as any[]);
            return rows.length;
          },

          async snapshotReplace(rawRows, scope) {
            const entityDef = entityDefOf();
            const rows = entityDef ? projectRows(rawRows, entityDef, Date.now()) : (rawRows as any[]);
            let pruned = 0;
            const tableRef = await dexieTable();
            await resolveDb().transaction("rw", [table], async () => {
              let existingKeys: DbKey[] = [];
              if (scope) {
                const scoped = await tableRef.where(scope.field).equals(scope.value as any).toArray();
                existingKeys = entityDef ? keysOfRows(scoped, entityDef) : scoped.map((r: any) => r[scope.field]);
              } else {
                existingKeys = (await tableRef.toCollection().primaryKeys()) as DbKey[];
              }

              const freshKeys = entityDef ? keysOfRows(rows, entityDef) : rows.map((r: any) => r.id ?? r.key);
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
              const indexed = (tableRef.schema.indexes ?? []).some(
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
              const firstIndexed = (tableRef.schema.indexes ?? []).some(
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
              ? (tableRef.schema.indexes ?? []).some(
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
        entities.set(table, instance);
      }
      return instance as EntityClient<T>;
    },

    get: (table, key) => client.entity(table).get(key),
    getMany: (table, keys) => client.entity(table).getMany(keys),
    all: (table) => client.entity(table).all(),
    query: (table, options) => client.entity(table).query(options),
    first: (table, options) => client.entity(table).first(options),
    count: (table, options) => client.entity(table).count(options),
    put: (table, record) => client.entity(table).put(record),
    bulkPut: (table, records) => client.entity(table).bulkPut(records),
    remove: (table, key) => client.entity(table).remove(key),
    bulkRemove: (table, keys) => client.entity(table).bulkRemove(keys),
    clear: (table) => client.entity(table).clear(),

    transaction(mode, tables, fn) {
      return resolveDb().transaction(mode, tables, fn) as Promise<any>;
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

