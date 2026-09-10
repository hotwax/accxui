/**
 * The single reactive read composable over a local Dexie database.
 *
 * One entry point and one return shape: always a list, with `first` as a computed for the
 * single-record case. Reading one row through `equals` on the primary key is an index
 * lookup in Dexie, the same work `get()` does, so there is no separate record composable.
 */

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from "vue";
import type { Subscription } from "dexie";
import type { BaseDB } from "./baseDb";
import { dbClient } from "./dbClient";
import { getAppDb } from "./appDbRegistry";
import type { QueryOptions } from "./types";
import { serviceState } from "./sync/syncService";

export interface DbListResult<T = Record<string, any>> {
  records: Ref<T[]>;
  /** The first matching record. Undefined means "no match" OR "not hydrated yet" — check `hydrated`. */
  first: Ref<T | undefined>;
  count: Ref<number>;
  hydrated: Ref<boolean>;
  error: Ref<Error | null>;
}

type OptionsSource = QueryOptions | (() => QueryOptions) | undefined;

export function useDb<T = Record<string, any>>(
  table: string,
  options?: OptionsSource,
): DbListResult<T>;
export function useDb<T = Record<string, any>>(
  db: BaseDB,
  table: string,
  options?: OptionsSource,
): DbListResult<T>;
export function useDb<T = Record<string, any>>(
  dbOrTable: BaseDB | string,
  tableOrOpts?: string | OptionsSource,
  opts?: OptionsSource,
): DbListResult<T> {
  const targetDb = typeof dbOrTable === "string" ? getAppDb().raw() : dbOrTable;
  const table = typeof dbOrTable === "string" ? dbOrTable : (tableOrOpts as string);
  const options = typeof dbOrTable === "string" ? (tableOrOpts as OptionsSource) : opts;

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
    subscription?.unsubscribe();
    subscription = null;

    try {
      subscription = dbClient(targetDb).entity<T>(table).live(currentOptions).subscribe({
        next: (rows) => {
          records.value = rows;
          emitted.value = true;
          error.value = null;
        },
        error: (err: any) => {
          console.error(`[useDb] liveQuery error on ${table}:`, err);
          error.value = err instanceof Error ? err : new Error(String(err));
          emitted.value = true;
        },
      });
    } catch (err: any) {
      console.error(`[useDb] Failed to subscribe to ${table}:`, err);
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
