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
import type { BaseDB } from "./baseDb";
import type { QueryOptions } from "./types";

export interface DbClient {
  get<T = Record<string, any>>(table: string, key: string): Promise<T | undefined>;
  getMany<T = Record<string, any>>(table: string, keys: string[]): Promise<T[]>;
  all<T = Record<string, any>>(table: string): Promise<T[]>;
  query<T = Record<string, any>>(table: string, options?: QueryOptions): Promise<T[]>;
  first<T = Record<string, any>>(table: string, options?: QueryOptions): Promise<T | undefined>;
  count(table: string, options?: QueryOptions): Promise<number>;

  put(table: string, record: unknown): Promise<void>;
  bulkPut(table: string, records: unknown[]): Promise<void>;
  remove(table: string, key: string): Promise<void>;
  bulkRemove(table: string, keys: string[]): Promise<void>;
  clear(table: string): Promise<void>;
  transaction<T>(mode: "r" | "rw", tables: string[], fn: () => Promise<T>): Promise<T>;

  live<T = Record<string, any>>(table: string, options?: QueryOptions): Observable<T[]>;

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

export function dbClient(db: BaseDB): DbClient {
  const tableOf = (table: string) => db.table<any, string>(table);

  return {
    async get(table, key) {
      if (!key) return undefined;
      return tableOf(table).get(key);
    },
    async getMany(table, keys) {
      if (!keys.length) return [];
      const rows = await tableOf(table).bulkGet(keys);
      return rows.filter(Boolean) as any[];
    },
    async all(table) {
      return tableOf(table).toArray();
    },
    async query(table, options = {}) {
      return buildQuery(tableOf(table), options).toArray();
    },
    async first(table, options = {}) {
      const rows = await buildQuery(tableOf(table), { ...options, limit: 1 }).toArray();
      return rows[0];
    },
    async count(table, options) {
      if (!options || Object.keys(options).length === 0) return tableOf(table).count();
      return buildQuery(tableOf(table), options).count();
    },

    async put(table, record) {
      await tableOf(table).put(record as any);
    },
    async bulkPut(table, records) {
      if (!records.length) return;
      await tableOf(table).bulkPut(records as any[]);
    },
    async remove(table, key) {
      await tableOf(table).delete(key);
    },
    async bulkRemove(table, keys) {
      if (!keys.length) return;
      await tableOf(table).bulkDelete(keys);
    },
    async clear(table) {
      await tableOf(table).clear();
    },
    transaction(mode, tables, fn) {
      return db.transaction(mode, tables, fn) as Promise<any>;
    },

    live(table, options = {}) {
      return liveQuery(async () => buildQuery(tableOf(table), options).toArray()) as any;
    },

    tableNames() {
      return db.getTableNames();
    },
    raw() {
      return db;
    },
  };
}
