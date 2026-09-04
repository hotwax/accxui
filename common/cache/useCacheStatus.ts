import { computed, onUnmounted, ref } from "vue";
import { liveQuery, type Subscription } from "dexie";
import type { BaseCacheDB } from "./db";
import { resyncDomain, resyncAll } from "./sync/appCacheBootstrap";

export interface CacheDomainCatalogItem {
  name: string;
  table: string;
  label: string;
  syncClass?: "A" | "B";
}

export interface CacheDomainStatus extends CacheDomainCatalogItem {
  count: number;
  syncedAt: number | null;
  status: "success" | "empty" | "none";
}

export const DEFAULT_COMMON_CACHE_CATALOG: CacheDomainCatalogItem[] = [
  { name: "productStore", table: "productStores", label: "Product Stores", syncClass: "B" },
  { name: "status", table: "statuses", label: "Statuses", syncClass: "B" },
  { name: "enum", table: "enums", label: "Enumerations", syncClass: "B" },
  { name: "enumType", table: "enumTypes", label: "Enumeration Types", syncClass: "B" },
  { name: "facility", table: "facilities", label: "Facilities", syncClass: "B" },
  { name: "facilityType", table: "facilityTypes", label: "Facility Types", syncClass: "B" },
  { name: "facilityGroup", table: "facilityGroups", label: "Facility Groups", syncClass: "B" },
  { name: "groupFacility", table: "groupFacilities", label: "Facility Group Members", syncClass: "B" },
  { name: "geo", table: "geos", label: "Geographic Regions", syncClass: "B" },
  { name: "geoAssoc", table: "geoAssocs", label: "Region Associations", syncClass: "B" },
  { name: "carrier", table: "carriers", label: "Shipping Carriers", syncClass: "B" },
  { name: "shipmentMethodType", table: "shipmentMethodTypes", label: "Shipment Methods", syncClass: "B" },
  { name: "paymentMethodType", table: "paymentMethodTypes", label: "Payment Method Types", syncClass: "B" },
  { name: "returnReason", table: "returnReasons", label: "Return Reasons", syncClass: "B" },
  { name: "returnType", table: "returnTypes", label: "Return Types", syncClass: "B" },
  { name: "returnItemType", table: "returnItemTypes", label: "Return Item Types", syncClass: "B" },
  { name: "roleType", table: "roleTypes", label: "Role Types", syncClass: "B" },
  { name: "orderAdjustmentType", table: "orderAdjustmentTypes", label: "Order Adjustment Types", syncClass: "B" },
  { name: "contactMechPurposeType", table: "contactMechPurposeTypes", label: "Contact Purpose Types", syncClass: "B" },
  { name: "communicationEventType", table: "communicationEventTypes", label: "Communication Types", syncClass: "B" },
  { name: "partyRelationshipType", table: "partyRelationshipTypes", label: "Relationship Types", syncClass: "B" },
  { name: "statusFlowTransition", table: "statusFlowTransitions", label: "Status Flow Transitions", syncClass: "B" },
  { name: "productStoreFacility", table: "productStoreFacilities", label: "Store Facilities", syncClass: "B" },
  { name: "productStoreFacilityGroup", table: "productStoreFacilityGroups", label: "Store Facility Groups", syncClass: "B" },
  { name: "productStoreShipmentMethod", table: "productStoreShipmentMethods", label: "Store Shipment Methods", syncClass: "B" },
  { name: "shopifyShop", table: "shopifyShops", label: "Shopify Shops", syncClass: "B" },
  { name: "shopifyShopLocation", table: "shopifyShopLocations", label: "Shopify Shop Locations", syncClass: "B" },
];

export function useCacheStatus(db: BaseCacheDB, catalog: CacheDomainCatalogItem[] = DEFAULT_COMMON_CACHE_CATALOG) {
  const domains = ref<CacheDomainStatus[]>([]);
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

    const rows: CacheDomainStatus[] = [];
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
      const channel = new BroadcastChannel("hotwax-cache-sync");
      channel.onmessage = async () => {
        const markers = await db.syncMeta.toArray();
        const syncedAtByDomain = parseSyncedAt(markers);
        const rows: CacheDomainStatus[] = [];
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
