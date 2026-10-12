/**
 * `useLiveEntity` — the reactive read for screens: rows of one table that stay current.
 *
 * The Vue form of `appDb.entity(table).live(options)`: refs instead of an Observable, `hydrated`,
 * reactive options (re-subscribes on change), and unsubscribe on unmount. For an answer now, or a
 * write, use `appDb.entity(table)` instead; this is for rows that must follow the database.
 *
 * One entry point and one return shape: always a list, with `first` as a computed for the
 * single-record case. Reading one row through `equals` on the primary key is an index
 * lookup in Dexie, the same work `get()` does, so there is no separate record composable.
 */

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from "vue";
import type { Subscription } from "dexie";
import type { BaseDB } from "../storage/baseDb";
import { type DbClient, dbClient } from "../storage/dbClient";
import { getAppDb } from "../schema/appDbRegistry";
import type { QueryOptions } from "../types";
import { serviceState } from "../sync/syncService";

export interface DbListResult<T = Record<string, any>> {
  records: Ref<T[]>;
  /** The first matching record. Undefined means "no match" OR "not hydrated yet" — check `hydrated`. */
  first: Ref<T | undefined>;
  count: Ref<number>;
  hydrated: Ref<boolean>;
  error: Ref<Error | null>;
}

type OptionsSource = QueryOptions | (() => QueryOptions) | undefined;

/** Pass the app's table name: `useLiveEntity(companyDb.tables.facilities, options)`. */
export function useLiveEntity<T = Record<string, any>>(
  table: string,
  options?: OptionsSource,
): DbListResult<T>;
/**
 * Reads another database through its client. A `BaseDB` is still accepted, and wrapped, for callers
 * not yet moved to a `DbClient`.
 */
export function useLiveEntity<T = Record<string, any>>(
  db: DbClient | BaseDB,
  table: string,
  options?: OptionsSource,
): DbListResult<T>;
export function useLiveEntity<T = Record<string, any>>(
  dbOrTable: DbClient | BaseDB | string,
  tableOrOpts?: string | OptionsSource,
  opts?: OptionsSource,
): DbListResult<T> {
  const client: DbClient = typeof dbOrTable === "string"
    ? getAppDb().client()
    : typeof (dbOrTable as DbClient).liveRead === "function"
      ? (dbOrTable as DbClient)
      : dbClient(dbOrTable as BaseDB);
  const table = typeof dbOrTable === "string" ? dbOrTable : (tableOrOpts as string);
  const options = typeof dbOrTable === "string" ? (tableOrOpts as OptionsSource) : opts;
  assertKnownTable(client, table);

  const records = shallowRef<T[]>([]) as Ref<T[]>;
  const emitted = ref(false);
  const error = ref<Error | null>(null);

  const resolvedOptions = computed<QueryOptions>(() =>
    typeof options === "function" ? options() : options ?? {},
  );

  const first = computed(() => records.value[0]);
  const count = computed(() => records.value.length);
  const hydrated = computed(() => emitted.value && (records.value.length > 0 || !serviceState.running));

  let subscription: Subscription | null = null;

  function subscribe(currentOptions: QueryOptions) {
    // A new query (shop A to shop B) must not show the old one's rows, nor claim empty before its
    // own first emit.
    if (subscription) {
      records.value = [];
      emitted.value = false;
    }
    subscription?.unsubscribe();
    subscription = null;

    try {
      subscription = client.entity<T>(table).live(currentOptions).subscribe({
        next: (rows) => {
          records.value = rows;
          emitted.value = true;
          error.value = null;
        },
        error: (err: any) => {
          console.error(`[useLiveEntity] liveQuery error on ${table}:`, err);
          error.value = err instanceof Error ? err : new Error(String(err));
          emitted.value = true;
        },
      });
    } catch (err: any) {
      console.error(`[useLiveEntity] Failed to subscribe to ${table}:`, err);
      error.value = err instanceof Error ? err : new Error(String(err));
      emitted.value = true;
    }
  }

  watch(resolvedOptions, (next) => subscribe(next), { immediate: true, deep: true });

  onUnmounted(() => {
    subscription?.unsubscribe();
    subscription = null;
  });

  return { records, first, count, hydrated, error };
}

/**
 * A misspelled table makes Dexie fail inside the live query, which only lands in `error` and a
 * console line — easy to miss. Fail at the call instead, naming the table and the database.
 * When no database can be resolved yet (not signed in), the live query reports that as before.
 */
function assertKnownTable(client: DbClient, table: string): void {
  let tables: string[];
  try {
    tables = client.tableNames();
  } catch {
    return;
  }
  if (!tables.includes(table)) {
    throw new Error(`[db] useLiveEntity: "${table}" is not a table in ${client.name()}.`);
  }
}
