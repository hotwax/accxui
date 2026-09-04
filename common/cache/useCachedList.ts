/**
 * Reactive Vue 3 composables for Dexie IndexedDB cache tables.
 */

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from "vue";
import type { Subscription } from "dexie";
import type { CachedEntity, CachedRow, LiveQueryOptions } from "./types";
import { bootstrapState } from "./sync/appCacheBootstrap";

export interface CachedList<T = Record<string, any>> {
  rows: Ref<CachedRow[]>;
  records: Ref<T[]>;
  hydrated: Ref<boolean>;
}

export interface CachedRecordResult<T = Record<string, any>> {
  row: Ref<CachedRow | undefined>;
  record: Ref<T | undefined>;
  hydrated: Ref<boolean>;
}

export function useCachedList<T = Record<string, any>>(
  entity: CachedEntity<T>,
  options: LiveQueryOptions = {},
): CachedList<T> {
  const rows = shallowRef<CachedRow[]>([]) as Ref<CachedRow[]>;
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
        console.error(`[useCachedList] liveQuery error on ${entity.table}:`, err);
        emitted.value = true;
      },
    });
  } catch (error) {
    console.error(`[useCachedList] Failed to subscribe to ${entity.table}:`, error);
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

export function useCachedRecord<T = Record<string, any>>(
  entity: CachedEntity<T>,
  key: Ref<string | undefined> | string | undefined,
): CachedRecordResult<T> {
  const row = shallowRef<CachedRow | undefined>(undefined) as Ref<CachedRow | undefined>;
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
            console.error(`[useCachedRecord] liveQuery error on ${entity.table}:`, err);
            emitted.value = true;
          },
        });
    } catch (error) {
      console.error(`[useCachedRecord] Failed to subscribe to ${entity.table}:`, error);
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
