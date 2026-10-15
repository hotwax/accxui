import { computed, getCurrentInstance, onUnmounted, ref, watch } from "vue";
import type { Subscription } from "dexie";
import type { BaseDB } from "../storage/baseDb";
import { type DbClient, type TxReader, dbClient } from "../storage/dbClient";
import { DB_SYNC_CHANNEL } from "../sync/channels";
import { COMMON_TABLE_NAMES, commonDomainsByTable } from "../seed/seedDomains";
import type { CatalogItem } from "../sync/pollingWorkerHarness";

export interface SyncDomainCatalogItem {
  name: string;
  table: string;
  label: string;
  syncClass?: "A" | "B" | "C";
}

/**
 * Either shape a status card can be driven from: the pre-registry static array (both apps, until
 * later tasks migrate), or a function that fetches the worker's registry-derived catalog over
 * Comlink. The function form is awaited once on setup.
 */
export type DbStatusCatalogSource = SyncDomainCatalogItem[] | (() => Promise<CatalogItem[]>);

export interface SyncDomainStatus extends SyncDomainCatalogItem {
  count: number;
  syncedAt: number | null;
  status: "success" | "empty" | "none";
}

/** Every seed domain, derived from commonDomainsByTable. Prefer `appDb.statusCatalog`. */
export const DEFAULT_COMMON_SYNC_CATALOG: SyncDomainCatalogItem[] = COMMON_TABLE_NAMES.map((table) => ({
  name: commonDomainsByTable[table].name,
  table,
  label: commonDomainsByTable[table].label,
  syncClass: commonDomainsByTable[table].syncClass,
}));

/**
 * How this app re-runs a sync.
 *
 * Injected rather than imported, because an app's status card must refresh through the SAME
 * main-thread service that owns its worker.
 */
export interface DbStatusActions {
  resyncDomain: (domain: string) => Promise<void>;
  resyncAll: () => Promise<void>;
}

const noopActions: DbStatusActions = {
  resyncDomain: async () => {},
  resyncAll: async () => {},
};

/**
 * `source` is the app database's client. A `BaseDB` is still accepted, and wrapped, for callers
 * not yet moved to `appDb.client()`.
 */
export function useDbStatus(
  source: DbClient | BaseDB,
  catalogSource: DbStatusCatalogSource = DEFAULT_COMMON_SYNC_CATALOG,
  actions: DbStatusActions = noopActions,
) {
  const client: DbClient = typeof (source as DbClient).liveRead === "function"
    ? (source as DbClient)
    : dbClient(source as BaseDB);
  const domains = ref<SyncDomainStatus[]>([]);
  const loaded = ref(false);
  const refreshing = ref<string | null>(null);

  /** True once the catalog source has settled — resolved, rejected, or (for an array) always. */
  const catalogLoaded = ref(false);
  /** The catalog actually driving the live query, regardless of which source shape it came from. */
  const resolvedCatalog = ref<(SyncDomainCatalogItem | CatalogItem)[]>([]);

  if (Array.isArray(catalogSource)) {
    resolvedCatalog.value = catalogSource;
    catalogLoaded.value = true;
  } else {
    catalogSource()
      .then((items) => {
        resolvedCatalog.value = items && items.length > 0 ? items : DEFAULT_COMMON_SYNC_CATALOG;
        catalogLoaded.value = true;
      })
      .catch(() => {
        // The worker may not be up yet. Fall back to default catalog.
        resolvedCatalog.value = DEFAULT_COMMON_SYNC_CATALOG;
        catalogLoaded.value = true;
      });
  }

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

  /** A registry-derived `CatalogItem` has no `table` — it's domain-keyed, not table-keyed. */
  const tableOf = (entry: SyncDomainCatalogItem | CatalogItem) =>
    (entry as SyncDomainCatalogItem).table ?? (entry as CatalogItem).table ?? entry.name;

  /**
   * The catalog's tables this database has, plus `syncMeta`, as ONE read: counts and markers are
   * seen at the same point. A catalog entry naming a table the database lacks counts `0` rather
   * than failing the transaction and blanking the whole card. Task 11 reconciles domain names with
   * table names.
   */
  const statusRead = (): [string[], (tx: TxReader) => Promise<SyncDomainStatus[]>] => {
    const catalog = resolvedCatalog.value;
    const known = new Set(client.tableNames());
    const tables = [...new Set(catalog.map(tableOf).filter((table) => known.has(table)))];

    return [["syncMeta", ...tables], async (tx) => {
      const syncedAtByDomain = parseSyncedAt(await tx.entity("syncMeta").all());
      const rows: SyncDomainStatus[] = [];
      for (const entry of catalog) {
        const table = tableOf(entry);
        const count = known.has(table) ? await tx.entity(table).count() : 0;
        const syncedAt = syncedAtByDomain.get(entry.name) ?? null;
        rows.push({
          ...entry,
          count,
          syncedAt,
          status: count > 0 ? "success" : (syncedAt || entry.syncClass === "A" ? "empty" : "none"),
        } as SyncDomainStatus);
      }
      return rows;
    }];
  };

  const subscribeToRows = (): Subscription =>
    client.liveRead(...statusRead()).subscribe({
      next: (rows) => {
        domains.value = rows;
        loaded.value = true;
      },
      error: () => {
        loaded.value = true;
      },
    });

  let subscription: Subscription = subscribeToRows();

  // An async source resolves after this composable has already subscribed against an empty
  // catalog. Re-subscribe once it goes from empty to populated so the rows actually appear.
  watch(resolvedCatalog, (next, previous) => {
    if ((previous?.length ?? 0) === 0 && next.length > 0) {
      subscription.unsubscribe();
      subscription = subscribeToRows();
    }
  });

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(DB_SYNC_CHANNEL);
      channel.onmessage = async () => {
        domains.value = await client.read(...statusRead());
      };
    } catch {
      // Ignore
    }
  }

  if (getCurrentInstance()) {
    onUnmounted(() => subscription.unsubscribe());
  }

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
      await actions.resyncDomain(name);
    } finally {
      refreshing.value = null;
    }
  }

  async function refreshAll() {
    refreshing.value = "*";
    try {
      await actions.resyncAll();
    } finally {
      refreshing.value = null;
    }
  }

  return {
    domains,
    loaded,
    catalogLoaded,
    refreshing,
    totalRows,
    oldestSyncedAt,
    lastSyncedAt,
    refreshDomain,
    refreshAll,
  };
}
