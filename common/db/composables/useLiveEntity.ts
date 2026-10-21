/**
 * `useLiveEntity` — the reactive read for screens: rows of one table that stay current.
 *
 * The Vue form of `appDb.entity(table).live(options)`: refs instead of an Observable, `hydrated`,
 * reactive options (re-subscribes on change), and unsubscribe when its scope ends: the component's
 * unmount, or the `effectScope` it was run in. For an answer now, or a write, use
 * `appDb.entity(table)` instead; this is for rows that must follow the database.
 *
 * One entry point and one return shape: always a list, with `first` as a computed for the
 * single-record case. Reading one row through `equals` on the primary key is an index
 * lookup in Dexie, the same work `get()` does, so there is no separate record composable.
 */

import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import type { Observable, Subscription } from "dexie";
import { type BaseDB, loginMarkerKey } from "../storage/baseDb";
import { type DbClient, dbClient } from "../storage/dbClient";
import { getAppDb } from "../model/appDbRegistry";
import type { QueryOptions } from "../types";
import { serviceState } from "../sync/syncService";

export interface DbListResult<T = Record<string, any>> {
  records: Ref<T[]>;
  /** The first matching record. Undefined means "no match" OR "not hydrated yet" — check `hydrated`. */
  first: Ref<T | undefined>;
  count: Ref<number>;
  hydrated: Ref<boolean>;
  /**
   * With `syncDomain`: the rows were read together with that domain's login marker, so an empty
   * list is really empty. Without it, the same as `hydrated`.
   */
  synced: Ref<boolean>;
  error: Ref<Error | null>;
}

export interface LiveEntityOptions extends QueryOptions {
  /**
   * The sync domain that fills this table. Its login marker is read in the same transaction as the
   * rows, so `synced` can tell "not synced yet" from "really empty" (the sync commits a domain's
   * rows before its marker, and logout clears both).
   */
  syncDomain?: string;
}

type OptionsSource = LiveEntityOptions | (() => LiveEntityOptions) | undefined;

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
  const markerRead = ref(false);
  const error = ref<Error | null>(null);

  const resolvedOptions = computed<LiveEntityOptions>(() =>
    typeof options === "function" ? options() : options ?? {},
  );

  const first = computed(() => records.value[0]);
  const count = computed(() => records.value.length);
  const hydrated = computed(() => emitted.value && (records.value.length > 0 || !serviceState.running));
  const synced = computed(() => (resolvedOptions.value.syncDomain ? markerRead.value : hydrated.value));

  let subscription: Subscription | null = null;

  function subscribe({ syncDomain, ...currentOptions }: LiveEntityOptions) {
    // A new query (shop A to shop B) must not show the old one's rows, nor claim empty before its
    // own first emit.
    if (subscription) {
      records.value = [];
      emitted.value = false;
      markerRead.value = false;
    }
    subscription?.unsubscribe();
    subscription = null;

    try {
      const rows$: Observable<T[] | { rows: T[]; synced: boolean }> = syncDomain
        ? client.liveRead([table, "syncMeta"], async (tx) => {
          const [rows, marker] = await Promise.all([
            tx.entity<T>(table).query(currentOptions),
            tx.entity("syncMeta").get(loginMarkerKey(syncDomain)),
          ]);
          return { rows, synced: Boolean(marker?.synced) };
        })
        : client.entity<T>(table).live(currentOptions);
      subscription = rows$.subscribe({
        next: (read: T[] | { rows: T[]; synced: boolean }) => {
          if (Array.isArray(read)) {
            records.value = read;
          } else {
            records.value = read.rows;
            markerRead.value = read.synced;
          }
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

  // `onScopeDispose` rather than `onUnmounted`: it fires on unmount in a component, and also when
  // an `effectScope` it was run in stops, which is how `useSeedData` opens tables after setup.
  if (getCurrentScope()) {
    onScopeDispose(() => {
      subscription?.unsubscribe();
      subscription = null;
    });
  }

  return { records, first, count, hydrated, synced, error };
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
