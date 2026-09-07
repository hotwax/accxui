import { computed, onUnmounted, ref } from "vue";
import { liveQuery, type Subscription } from "dexie";
import type { BaseDB } from "./baseDb";
import { DB_SYNC_CHANNEL } from "./syncChannel";
import { resyncDomain, resyncAll } from "./sync/appDbBootstrap";
import { SEED_ENTITIES, SEED_ENTITY_NAMES } from "./domains/seedEntities";

export interface SyncDomainCatalogItem {
  name: string;
  table: string;
  label: string;
  syncClass?: "A" | "B";
}

export interface SyncDomainStatus extends SyncDomainCatalogItem {
  count: number;
  syncedAt: number | null;
  status: "success" | "empty" | "none";
}

/** Every seed domain, derived from SEED_ENTITIES. Prefer `appDb.statusCatalog`. */
export const DEFAULT_COMMON_SYNC_CATALOG: SyncDomainCatalogItem[] = SEED_ENTITY_NAMES.map((name) => ({
  name,
  table: SEED_ENTITIES[name].table,
  label: SEED_ENTITIES[name].label,
  syncClass: "B" as const,
}));

export function useDbStatus(db: BaseDB, catalog: SyncDomainCatalogItem[] = DEFAULT_COMMON_SYNC_CATALOG) {
  const domains = ref<SyncDomainStatus[]>([]);
  const loaded = ref(false);
  const refreshing = ref<string | null>(null);

  const parseSyncedAt = (markers: any[]) => {
    const map = new Map<string, number>();
    for (const marker of markers) {
      const key = String(marker.key ?? "");
      const time = Number(marker.timestamp ?? marker.syncedAt ?? 0);
      if (!time) continue;
      if (key.startsWith("domain:")) {
        map.set(key.slice("domain:".length), time);
      } else if (key.startsWith("loginSync:")) {
        const domainName = key.slice("loginSync:".length);
        if (!map.has(domainName)) {
          map.set(domainName, time);
        }
      }
    }
    return map;
  };

  const subscription: Subscription = liveQuery(async () => {
    const markers = await db.syncMeta.toArray();
    const syncedAtByDomain = parseSyncedAt(markers);

    const rows: SyncDomainStatus[] = [];
    for (const entry of catalog) {
      const table = db.table(entry.table);
      const count = await table.count();
      const syncedAt = syncedAtByDomain.get(entry.name) ?? null;
      rows.push({
        ...entry,
        count,
        syncedAt,
        status: count > 0 ? "success" : (syncedAt || entry.syncClass === "A" ? "empty" : "none"),
      });
    }
    return rows;
  }).subscribe({
    next: (rows) => {
      domains.value = rows;
      loaded.value = true;
    },
    error: () => {
      loaded.value = true;
    },
  });

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(DB_SYNC_CHANNEL);
      channel.onmessage = async () => {
        const markers = await db.syncMeta.toArray();
        const syncedAtByDomain = parseSyncedAt(markers);
        const rows: SyncDomainStatus[] = [];
        for (const entry of catalog) {
          const table = db.table(entry.table);
          const count = await table.count();
          const syncedAt = syncedAtByDomain.get(entry.name) ?? null;
          rows.push({
            ...entry,
            count,
            syncedAt,
            status: count > 0 ? "success" : (syncedAt || entry.syncClass === "A" ? "empty" : "none"),
          });
        }
        domains.value = rows;
      };
    } catch {
      // Ignore
    }
  }

  onUnmounted(() => subscription.unsubscribe());

  const totalRows = computed(() => domains.value.reduce((sum, entry) => sum + entry.count, 0));

  const oldestSyncedAt = computed(() => {
    const times = domains.value.map((entry) => entry.syncedAt).filter((t): t is number => !!t);
    return times.length ? Math.min(...times) : null;
  });

  const lastSyncedAt = computed(() => {
    const times = domains.value.map((entry) => entry.syncedAt).filter((t): t is number => !!t);
    return times.length ? Math.max(...times) : null;
  });

  async function refreshDomain(name: string) {
    refreshing.value = name;
    try {
      await resyncDomain(name);
    } finally {
      refreshing.value = null;
    }
  }

  async function refreshAll() {
    refreshing.value = "*";
    try {
      await resyncAll();
    } finally {
      refreshing.value = null;
    }
  }

  return {
    domains,
    loaded,
    refreshing,
    totalRows,
    oldestSyncedAt,
    lastSyncedAt,
    refreshDomain,
    refreshAll,
  };
}
