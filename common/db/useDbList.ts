/**
 * Reactive Vue 3 composables over the local Dexie IndexedDB tables.
 */

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from "vue";
import type { Subscription } from "dexie";
import type { DbEntity, DbRow, LiveQueryOptions } from "./types";
import { bootstrapState } from "./sync/appDbBootstrap";

export interface DbList<T = Record<string, any>> {
  rows: Ref<DbRow[]>;
  records: Ref<T[]>;
  hydrated: Ref<boolean>;
}

export interface DbRecordResult<T = Record<string, any>> {
  row: Ref<DbRow | undefined>;
  record: Ref<T | undefined>;
  hydrated: Ref<boolean>;
}

export function useDbList<T = Record<string, any>>(
  entity: DbEntity<T>,
  options: LiveQueryOptions = {},
): DbList<T> {
  const rows = shallowRef<DbRow[]>([]) as Ref<DbRow[]>;
  const records = shallowRef<T[]>([]) as Ref<T[]>;
  const emitted = ref(false);

  const hydrated = computed(() => emitted.value && (rows.value.length > 0 || !bootstrapState.running));

  let subscription: Subscription | null = null;

  try {
    subscription = entity.live(options).subscribe({
      next: (nextRows) => {
        rows.value = nextRows;
        records.value = nextRows.map((r) => (r.raw as T) ?? (r as unknown as T));
        emitted.value = true;
      },
      error: (err) => {
        console.error(`[useDbList] liveQuery error on ${entity.table}:`, err);
        emitted.value = true;
      },
    });
  } catch (error) {
    console.error(`[useDbList] Failed to subscribe to ${entity.table}:`, error);
    emitted.value = true;
  }

  onUnmounted(() => {
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  });

  return { rows, records, hydrated };
}

export function useDbRecord<T = Record<string, any>>(
  entity: DbEntity<T>,
  key: Ref<string | undefined> | string | undefined,
): DbRecordResult<T> {
  const row = shallowRef<DbRow | undefined>(undefined) as Ref<DbRow | undefined>;
  const record = shallowRef<T | undefined>(undefined) as Ref<T | undefined>;
  const emitted = ref(false);

  const resolvedKey = computed(() => (typeof key === "object" && "value" in key ? key.value : key));

  const hydrated = computed(() => emitted.value && (record.value !== undefined || !bootstrapState.running));

  let subscription: Subscription | null = null;

  function subscribe(currentKey: string | undefined) {
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
    if (!currentKey) {
      row.value = undefined;
      record.value = undefined;
      emitted.value = true;
      return;
    }

    try {
      subscription = entity
        .live({
          scope: { field: entity.projection.keyField, value: currentKey },
          limit: 1,
        })
        .subscribe({
          next: (rows) => {
            const first = rows[0];
            row.value = first;
            record.value = first ? ((first.raw as T) ?? (first as unknown as T)) : undefined;
            emitted.value = true;
          },
          error: (err) => {
            console.error(`[useDbRecord] liveQuery error on ${entity.table}:`, err);
            emitted.value = true;
          },
        });
    } catch (error) {
      console.error(`[useDbRecord] Failed to subscribe to ${entity.table}:`, error);
      emitted.value = true;
    }
  }

  watch(resolvedKey, (newKey) => subscribe(newKey), { immediate: true });

  onUnmounted(() => {
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  });

  return { row, record, hydrated };
}
