/**
 * How each seed table is fetched, and what the Settings status card calls it.
 *
 * The sibling of `commonSchema.ts`, keyed by the same table names. Storage lives there; fetching
 * lives here. `name` is the sync DOMAIN name — deliberately still singular and unchanged, because
 * it keys `syncMeta` cursor rows, the status catalog and Company's own sync registry.
 */

import type { SnapshotDomainConfig } from "../sync/snapshotDomain";

/** Everything `registerSnapshotDomain` needs except what the entity already states. */
export type SeedSource = Omit<SnapshotDomainConfig, "name" | "table" | "projection">;
export type SeedDomainSource = SeedSource;

export interface SeedSourceEntry {
  /** Sync domain name — the status-catalog key and the syncMeta cursor key. */
  name: string;
  /** Human label for the Settings status card. */
  label: string;
  source: SeedSource;
}
export type SeedDomainEntry = SeedSourceEntry;

export const SEED_DOMAINS = {
  productStores: {
    name: "productStore",
    label: "Product Stores",
    source: {
      listUrl: "admin/productStores",
      collectionKey: null,
      byPk: (pk) => ({ url: `admin/productStores/${encodeURIComponent(String(pk.productStoreId))}` }),
    },
  },

  statuses: {
    name: "status",
    label: "Statuses",
    source: { listUrl: "admin/status", collectionKey: null, batchSize: 500 },
  },

  enums: {
    name: "enum",
    label: "Enumerations",
    source: { listUrl: "admin/enums", collectionKey: null, batchSize: 500 },
  },

  enumTypes: {
    name: "enumType",
    label: "Enumeration Types",
    source: { listUrl: "admin/enumTypes", collectionKey: null },
  },

  facilities: {
    name: "facility",
    label: "Facilities",
    source: {
      listUrl: "oms/facilities",
      collectionKey: null,
      byPk: (pk) => ({ url: `oms/facilities/${encodeURIComponent(String(pk.facilityId))}` }),
    },
  },

  facilityTypes: {
    name: "facilityType",
    label: "Facility Types",
    source: { listUrl: "oms/facilityTypes", collectionKey: null },
  },

  facilityGroups: {
    name: "facilityGroup",
    label: "Facility Groups",
    source: { listUrl: "oms/facilityGroups", collectionKey: null },
  },

  groupFacilities: {
    name: "groupFacility",
    label: "Facility Group Members",
    source: {
      listUrl: "oms/groupFacilities",
      collectionKey: null,
      // Composite key + no by-PK route: re-list one group and snapshot just that scope, so a
      // member removed from the group is pruned rather than left behind.
      refetchScope: (pk) => ({
        params: { facilityGroupId: pk.facilityGroupId },
        scope: { field: "facilityGroupId", value: pk.facilityGroupId },
      }),
    },
  },

  geos: {
    name: "geo",
    label: "Geographic Regions",
    source: { listUrl: "admin/geos", collectionKey: null, batchSize: 500 },
  },

  geoAssocs: {
    name: "geoAssoc",
    label: "Region Associations",
    source: { listUrl: "admin/geos/assocs", collectionKey: null, batchSize: 500 },
  },

  carriers: {
    name: "carrier",
    label: "Shipping Carriers",
    source: {
      listUrl: "oms/shippingGateways/carrierParties",
      listParams: { roleTypeId: "CARRIER" },
      collectionKey: null,
    },
  },

  shipmentMethodTypes: {
    name: "shipmentMethodType",
    label: "Shipment Methods",
    source: { listUrl: "oms/shippingGateways/shipmentMethodTypes", collectionKey: null },
  },

  carrierShipmentMethods: {
    name: "carrierShipmentMethod",
    label: "Carrier Shipment Methods",
    source: { listUrl: "oms/shippingGateways/carrierShipmentMethods", collectionKey: null },
  },

  paymentMethodTypes: {
    name: "paymentMethodType",
    label: "Payment Method Types",
    source: { listUrl: "oms/paymentMethodTypes", collectionKey: null },
  },

  returnReasons: {
    name: "returnReason",
    label: "Return Reasons",
    source: { listUrl: "oms/returnReasons", collectionKey: null },
  },

  returnTypes: {
    name: "returnType",
    label: "Return Types",
    source: { listUrl: "oms/returnTypes", collectionKey: null },
  },

  returnItemTypes: {
    name: "returnItemType",
    label: "Return Item Types",
    source: { listUrl: "oms/returnItemTypes", collectionKey: null },
  },

  roleTypes: {
    name: "roleType",
    label: "Role Types",
    source: { listUrl: "oms/roleTypes", collectionKey: null },
  },

  orderAdjustmentTypes: {
    name: "orderAdjustmentType",
    label: "Order Adjustment Types",
    source: { listUrl: "oms/shippingGateways/orderAdjustmentTypes", collectionKey: null },
  },

  contactMechPurposeTypes: {
    name: "contactMechPurposeType",
    label: "Contact Purpose Types",
    source: { listUrl: "oms/contactMechPurposeTypes", collectionKey: null },
  },

  communicationEventTypes: {
    name: "communicationEventType",
    label: "Communication Types",
    source: { listUrl: "oms/communicationEventTypes", collectionKey: null },
  },

  partyRelationshipTypes: {
    name: "partyRelationshipType",
    label: "Relationship Types",
    source: { listUrl: "oms/partyRelationshipTypes", collectionKey: null },
  },

  statusFlowTransitions: {
    name: "statusFlowTransition",
    label: "Status Flow Transitions",
    source: { listUrl: "admin/statusFlows/transitions", collectionKey: null },
  },

  productStoreFacilities: {
    name: "productStoreFacility",
    label: "Store Facilities",
    source: {
      // No global association list exists, so both the snapshot and the refetch go through fanOut.
      listUrl: "oms/productStores",
      fanOut: {
        parentTable: "productStores",
        parentKeyField: "productStoreId",
        urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/facilities`,
      },
    },
  },

  productStoreFacilityGroups: {
    name: "productStoreFacilityGroup",
    label: "Store Facility Groups",
    source: {
      listUrl: "oms/productStores",
      fanOut: {
        parentTable: "productStores",
        parentKeyField: "productStoreId",
        urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/facilityGroups`,
      },
    },
  },

  productStoreShipmentMethods: {
    name: "productStoreShipmentMethod",
    label: "Store Shipment Methods",
    source: {
      listUrl: "oms/productStores",
      fanOut: {
        parentTable: "productStores",
        parentKeyField: "productStoreId",
        urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/shipmentMethods`,
      },
    },
  },

  productStoreEmailSettings: {
    name: "productStoreEmailSetting",
    label: "Store Email Settings",
    source: { listUrl: "oms/productStoreEmailSettings", collectionKey: null },
  },

  shopifyShops: {
    name: "shopifyShop",
    label: "Shopify Shops",
    source: { listUrl: "oms/shopifyShops/shops", collectionKey: null },
  },

  shopifyShopLocations: {
    name: "shopifyShopLocation",
    label: "Shopify Shop Locations",
    source: { listUrl: "oms/shopifyShops/locations", collectionKey: null },
  },
} satisfies Record<string, SeedSourceEntry>;

/** Backward-compatibility alias for SEED_DOMAINS */
export const SEED_SOURCES = SEED_DOMAINS;

export type SeedTableName = keyof typeof SEED_DOMAINS;

export const SEED_TABLE_NAMES = Object.keys(SEED_DOMAINS) as SeedTableName[];

export const SEED_DOMAIN_NAMES = SEED_TABLE_NAMES.map((table) => SEED_DOMAINS[table].name);
