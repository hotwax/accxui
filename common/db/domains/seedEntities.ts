/**
 * The single source of truth for HotWax OMS seed (Class B) reference data.
 *
 * Each entity owns everything about itself — its store name, its Dexie schema string, its
 * Settings label, its projection and its fetch config. `COMMON_DB_SCHEMA`, the status
 * catalog and the domain registrations are all derived from this one map, so they cannot
 * drift apart the way the four hand-maintained lists did (29 registered vs 27 vs 28).
 */

import type { SnapshotDomainConfig } from "../sync/snapshotDomain";
import type { EntityProjection } from "../types";

/**
 * The 29 seed entity projections. These live here (rather than being imported from
 * commonSeedEntities.ts) to avoid a circular import: SEED_ENTITIES below needs them at
 * module-evaluation time, and commonSeedEntities.ts re-exports them from here instead.
 */

const lookup = (keyField: string, extra: Record<string, "text" | "count" | "date"> = {}): EntityProjection => ({
  keyField,
  fields: { [keyField]: "text", description: "text", ...extra },
});

export const statusProjection = lookup("statusId", { statusTypeId: "text", statusAge: "count" });

export const enumProjection: EntityProjection = {
  keyField: "enumId",
  fields: {
    enumId: "text",
    enumTypeId: "text",
    enumCode: "text",
    description: "text",
    typeDescription: "text",
    sequenceNum: "count",
  },
};

export const enumTypeProjection: EntityProjection = {
  keyField: "enumTypeId",
  fields: { enumTypeId: "text", parentTypeId: "text", description: "text" },
};

export const productStoreProjection: EntityProjection = {
  keyField: "productStoreId",
  fields: {
    productStoreId: "text",
    storeName: "text",
    companyName: "text",
    inventoryFacilityId: "text",
    defaultCurrencyUomId: "text",
    externalId: "text",
    productIdentifierEnumId: "text",
    lastUpdatedStamp: "date",
  },
};

export const facilityProjection: EntityProjection = {
  keyField: "facilityId",
  fields: {
    facilityId: "text",
    facilityName: "text",
    facilityTypeId: "text",
    parentTypeId: "text",
    ownerPartyId: "text",
    maximumOrderLimit: "count",
    description: "text",
  },
};

export const facilityTypeProjection = lookup("facilityTypeId", { parentTypeId: "text" });

export const facilityGroupProjection = lookup("facilityGroupId", { facilityGroupName: "text", facilityGroupTypeId: "text" });

export const groupFacilityProjection: EntityProjection = {
  keyField: "memberKey",
  fields: {
    memberKey: "text",
    facilityGroupId: "text",
    facilityId: "text",
    facilityName: "text",
    facilityGroupName: "text",
    facilityTypeId: "text",
    fromDate: "date",
    thruDate: "date",
  },
  buildKey: (raw) => {
    const group = raw?.facilityGroupId;
    const facility = raw?.facilityId;
    if (!group || !facility) return undefined;
    return `${group}|${facility}|${raw?.fromDate ?? ""}`;
  },
};

export const geoProjection: EntityProjection = {
  keyField: "geoId",
  fields: {
    geoId: "text",
    geoTypeEnumId: "text",
    geoName: "text",
    geoCode: "text",
    geoCodeAlpha2: "text",
    geoCodeAlpha3: "text",
  },
};

export const geoAssocProjection: EntityProjection = {
  keyField: "geoAssocKey",
  fields: {
    geoAssocKey: "text",
    geoId: "text",
    toGeoId: "text",
    geoAssocTypeEnumId: "text",
  },
  buildKey: (raw) => {
    const from = raw?.geoId;
    const to = raw?.toGeoId || raw?.geoIdTo;
    if (!from || !to) return undefined;
    return `${from}|${to}`;
  },
};

export const carrierProjection: EntityProjection = {
  keyField: "partyId",
  fields: {
    partyId: "text",
    groupName: "text",
    firstName: "text",
    lastName: "text",
    roleTypeId: "text",
  },
};

export const shipmentMethodTypeProjection = lookup("shipmentMethodTypeId", { sequenceNum: "count" });

export const carrierShipmentMethodProjection: EntityProjection = {
  keyField: "carrierShipmentMethodKey",
  fields: {
    carrierShipmentMethodKey: "text",
    partyId: "text",
    shipmentMethodTypeId: "text",
    roleTypeId: "text",
    sequenceNumber: "count",
  },
  buildKey: (raw) => {
    const partyId = raw?.partyId;
    const methodId = raw?.shipmentMethodTypeId;
    if (!partyId || !methodId) return undefined;
    return `${partyId}|${methodId}`;
  },
};

export const paymentMethodTypeProjection = lookup("paymentMethodTypeId", { paymentMethodCode: "text" });

export const returnReasonProjection = lookup("returnReasonId", { sequenceId: "count" });

export const returnTypeProjection = lookup("returnTypeId");

export const returnItemTypeProjection = lookup("returnItemTypeId");

export const roleTypeProjection = lookup("roleTypeId", { parentTypeId: "text" });

export const orderAdjustmentTypeProjection = lookup("orderAdjustmentTypeId", { hasTable: "text" });

export const contactMechPurposeTypeProjection = lookup("contactMechPurposeTypeId");

export const communicationEventTypeProjection = lookup("communicationEventTypeId");

export const partyRelationshipTypeProjection = lookup("partyRelationshipTypeId", { parentTypeId: "text" });

export const statusFlowTransitionProjection: EntityProjection = {
  keyField: "transitionKey",
  fields: {
    transitionKey: "text",
    statusId: "text",
    toStatusId: "text",
    statusFlowId: "text",
    transitionSequence: "count",
  },
  buildKey: (raw) => {
    if (!raw?.statusId || !raw?.toStatusId) return undefined;
    return `${raw.statusId}|${raw.toStatusId}|${raw?.statusFlowId ?? ""}`;
  },
};

export const productStoreFacilityProjection: EntityProjection = {
  keyField: "storeFacilityKey",
  fields: {
    storeFacilityKey: "text",
    productStoreId: "text",
    facilityId: "text",
    facilityName: "text",
    facilityTypeId: "text",
    sequenceNum: "count",
    fromDate: "date",
  },
  buildKey: (raw) => {
    if (!raw?.productStoreId || !raw?.facilityId) return undefined;
    return `${raw.productStoreId}|${raw.facilityId}`;
  },
};

export const productStoreFacilityGroupProjection: EntityProjection = {
  keyField: "storeFacilityGroupKey",
  fields: {
    storeFacilityGroupKey: "text",
    productStoreId: "text",
    facilityGroupId: "text",
    fromDate: "date",
  },
  buildKey: (raw) => {
    if (!raw?.productStoreId || !raw?.facilityGroupId) return undefined;
    return `${raw.productStoreId}|${raw.facilityGroupId}`;
  },
};

export const productStoreShipmentMethodProjection: EntityProjection = {
  keyField: "storeShipmentMethodKey",
  fields: {
    storeShipmentMethodKey: "text",
    productStoreId: "text",
    shipmentMethodTypeId: "text",
    partyId: "text",
    carrierPartyId: "text",
    description: "text",
  },
  buildKey: (raw) => {
    if (!raw?.productStoreId || !raw?.shipmentMethodTypeId) return undefined;
    return `${raw.productStoreId}|${raw.shipmentMethodTypeId}|${raw?.partyId || raw?.carrierPartyId || ""}`;
  },
};

export const shopifyShopProjection: EntityProjection = {
  keyField: "shopId",
  fields: {
    shopId: "text",
    productStoreId: "text",
    shopifyShopId: "text",
    name: "text",
    // Read by views/OrderDetail.vue to build the Shopify admin order link.
    myshopifyDomain: "text",
    domain: "text",
    systemMessageRemoteId: "text",
  },
};

export const shopifyShopLocationProjection: EntityProjection = {
  keyField: "locationKey",
  fields: {
    locationKey: "text",
    shopId: "text",
    facilityId: "text",
    shopifyLocationId: "text",
  },
  buildKey: (raw) => {
    if (!raw?.shopId || !raw?.shopifyLocationId) return undefined;
    return `${raw.shopId}|${raw.shopifyLocationId}`;
  },
};

export const productStoreEmailSettingProjection: EntityProjection = {
  keyField: "emailSettingKey",
  fields: {
    emailSettingKey: "text",
    productStoreId: "text",
    emailTypeEnumId: "text",
    subject: "text",
    bodyScreenLocation: "text",
    systemMessageRemoteId: "text",
  },
  buildKey: (raw) => {
    const storeId = raw?.productStoreId;
    const emailType = raw?.emailTypeEnumId || raw?.emailType;
    if (!storeId || !emailType) return undefined;
    return `${storeId}|${emailType}`;
  },
};

/** Everything `registerSnapshotDomain` needs except what the entity already states. */
export type SeedSource = Omit<SnapshotDomainConfig, "name" | "table" | "projection">;

export interface SeedEntity {
  /** Domain name — the key apps opt in by, and the status-catalog key. */
  name: string;
  /** IndexedDB store name. */
  table: string;
  /** Dexie schema string: primary key first, then secondary indexes. */
  schema: string;
  /** Human label for the Settings status card. */
  label: string;
  projection: EntityProjection;
  source: SeedSource;
}

export const SEED_ENTITIES = {
  productStore: {
    name: "productStore",
    table: "productStores",
    schema: "productStoreId, storeName",
    label: "Product Stores",
    projection: productStoreProjection,
    source: {
      listUrl: "admin/productStores",
      collectionKey: null,
      byPk: (pk) => ({ url: `admin/productStores/${encodeURIComponent(String(pk.productStoreId))}` }),
    },
  },

  status: {
    name: "status",
    table: "statuses",
    schema: "statusId, statusTypeId",
    label: "Statuses",
    projection: statusProjection,
    source: { listUrl: "admin/status", collectionKey: null, batchSize: 500 },
  },

  enum: {
    name: "enum",
    table: "enums",
    schema: "enumId, enumTypeId, enumCode",
    label: "Enumerations",
    projection: enumProjection,
    source: { listUrl: "admin/enums", collectionKey: null, batchSize: 500 },
  },

  enumType: {
    name: "enumType",
    table: "enumTypes",
    schema: "enumTypeId, parentTypeId",
    label: "Enumeration Types",
    projection: enumTypeProjection,
    source: { listUrl: "admin/enumTypes", collectionKey: null },
  },

  facility: {
    name: "facility",
    table: "facilities",
    schema: "facilityId, facilityTypeId, parentTypeId, ownerPartyId",
    label: "Facilities",
    projection: facilityProjection,
    source: {
      listUrl: "oms/facilities",
      collectionKey: null,
      byPk: (pk) => ({ url: `oms/facilities/${encodeURIComponent(String(pk.facilityId))}` }),
    },
  },

  facilityType: {
    name: "facilityType",
    table: "facilityTypes",
    schema: "facilityTypeId, parentTypeId",
    label: "Facility Types",
    projection: facilityTypeProjection,
    source: { listUrl: "oms/facilityTypes", collectionKey: null },
  },

  facilityGroup: {
    name: "facilityGroup",
    table: "facilityGroups",
    schema: "facilityGroupId, facilityGroupTypeId",
    label: "Facility Groups",
    projection: facilityGroupProjection,
    source: { listUrl: "oms/facilityGroups", collectionKey: null },
  },

  groupFacility: {
    name: "groupFacility",
    table: "groupFacilities",
    schema: "memberKey, facilityGroupId, facilityId, fromDate, thruDate",
    label: "Facility Group Members",
    projection: groupFacilityProjection,
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

  geo: {
    name: "geo",
    table: "geos",
    schema: "geoId, geoTypeEnumId, geoCode",
    label: "Geographic Regions",
    projection: geoProjection,
    source: { listUrl: "admin/geos", collectionKey: null, batchSize: 500 },
  },

  geoAssoc: {
    name: "geoAssoc",
    table: "geoAssocs",
    schema: "geoAssocKey, geoId, toGeoId, geoAssocTypeEnumId",
    label: "Region Associations",
    projection: geoAssocProjection,
    source: { listUrl: "admin/geos/assocs", collectionKey: null, batchSize: 500 },
  },

  carrier: {
    name: "carrier",
    table: "carriers",
    schema: "partyId",
    label: "Shipping Carriers",
    projection: carrierProjection,
    source: {
      listUrl: "oms/shippingGateways/carrierParties",
      listParams: { roleTypeId: "CARRIER" },
      collectionKey: null,
    },
  },

  shipmentMethodType: {
    name: "shipmentMethodType",
    table: "shipmentMethodTypes",
    schema: "shipmentMethodTypeId",
    label: "Shipment Methods",
    projection: shipmentMethodTypeProjection,
    source: { listUrl: "oms/shippingGateways/shipmentMethodTypes", collectionKey: null },
  },

  carrierShipmentMethod: {
    name: "carrierShipmentMethod",
    table: "carrierShipmentMethods",
    schema: "carrierShipmentMethodKey, partyId, shipmentMethodTypeId",
    label: "Carrier Shipment Methods",
    projection: carrierShipmentMethodProjection,
    source: { listUrl: "oms/shippingGateways/carrierShipmentMethods", collectionKey: null },
  },

  paymentMethodType: {
    name: "paymentMethodType",
    table: "paymentMethodTypes",
    schema: "paymentMethodTypeId",
    label: "Payment Method Types",
    projection: paymentMethodTypeProjection,
    source: { listUrl: "oms/paymentMethodTypes", collectionKey: null },
  },

  returnReason: {
    name: "returnReason",
    table: "returnReasons",
    schema: "returnReasonId",
    label: "Return Reasons",
    projection: returnReasonProjection,
    source: { listUrl: "oms/returnReasons", collectionKey: null },
  },

  returnType: {
    name: "returnType",
    table: "returnTypes",
    schema: "returnTypeId",
    label: "Return Types",
    projection: returnTypeProjection,
    source: { listUrl: "oms/returnTypes", collectionKey: null },
  },

  returnItemType: {
    name: "returnItemType",
    table: "returnItemTypes",
    schema: "returnItemTypeId",
    label: "Return Item Types",
    projection: returnItemTypeProjection,
    source: { listUrl: "oms/returnItemTypes", collectionKey: null },
  },

  roleType: {
    name: "roleType",
    table: "roleTypes",
    schema: "roleTypeId, parentTypeId",
    label: "Role Types",
    projection: roleTypeProjection,
    source: { listUrl: "oms/roleTypes", collectionKey: null },
  },

  orderAdjustmentType: {
    name: "orderAdjustmentType",
    table: "orderAdjustmentTypes",
    schema: "orderAdjustmentTypeId",
    label: "Order Adjustment Types",
    projection: orderAdjustmentTypeProjection,
    source: { listUrl: "oms/shippingGateways/orderAdjustmentTypes", collectionKey: null },
  },

  contactMechPurposeType: {
    name: "contactMechPurposeType",
    table: "contactMechPurposeTypes",
    schema: "contactMechPurposeTypeId",
    label: "Contact Purpose Types",
    projection: contactMechPurposeTypeProjection,
    source: { listUrl: "oms/contactMechPurposeTypes", collectionKey: null },
  },

  communicationEventType: {
    name: "communicationEventType",
    table: "communicationEventTypes",
    schema: "communicationEventTypeId",
    label: "Communication Types",
    projection: communicationEventTypeProjection,
    source: { listUrl: "oms/communicationEventTypes", collectionKey: null },
  },

  partyRelationshipType: {
    name: "partyRelationshipType",
    table: "partyRelationshipTypes",
    schema: "partyRelationshipTypeId",
    label: "Relationship Types",
    projection: partyRelationshipTypeProjection,
    source: { listUrl: "oms/partyRelationshipTypes", collectionKey: null },
  },

  statusFlowTransition: {
    name: "statusFlowTransition",
    table: "statusFlowTransitions",
    schema: "transitionKey, statusId, toStatusId",
    label: "Status Flow Transitions",
    projection: statusFlowTransitionProjection,
    source: { listUrl: "admin/statusFlows/transitions", collectionKey: null },
  },

  productStoreFacility: {
    name: "productStoreFacility",
    table: "productStoreFacilities",
    schema: "storeFacilityKey, productStoreId, facilityId",
    label: "Store Facilities",
    projection: productStoreFacilityProjection,
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

  productStoreFacilityGroup: {
    name: "productStoreFacilityGroup",
    table: "productStoreFacilityGroups",
    schema: "storeFacilityGroupKey, productStoreId, facilityGroupId",
    label: "Store Facility Groups",
    projection: productStoreFacilityGroupProjection,
    source: {
      listUrl: "oms/productStores",
      fanOut: {
        parentTable: "productStores",
        parentKeyField: "productStoreId",
        urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/facilityGroups`,
      },
    },
  },

  productStoreShipmentMethod: {
    name: "productStoreShipmentMethod",
    table: "productStoreShipmentMethods",
    schema: "storeShipmentMethodKey, productStoreId, shipmentMethodTypeId",
    label: "Store Shipment Methods",
    projection: productStoreShipmentMethodProjection,
    source: {
      listUrl: "oms/productStores",
      fanOut: {
        parentTable: "productStores",
        parentKeyField: "productStoreId",
        urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/shipmentMethods`,
      },
    },
  },

  productStoreEmailSetting: {
    name: "productStoreEmailSetting",
    table: "productStoreEmailSettings",
    schema: "emailSettingKey, productStoreId, emailTypeEnumId",
    label: "Store Email Settings",
    projection: productStoreEmailSettingProjection,
    source: { listUrl: "oms/productStoreEmailSettings", collectionKey: null },
  },

  shopifyShop: {
    name: "shopifyShop",
    table: "shopifyShops",
    schema: "shopId, productStoreId, shopifyShopId",
    label: "Shopify Shops",
    projection: shopifyShopProjection,
    source: { listUrl: "oms/shopifyShops/shops", collectionKey: null },
  },

  shopifyShopLocation: {
    name: "shopifyShopLocation",
    table: "shopifyShopLocations",
    schema: "locationKey, shopId, facilityId, shopifyLocationId",
    label: "Shopify Shop Locations",
    projection: shopifyShopLocationProjection,
    source: { listUrl: "oms/shopifyShops/locations", collectionKey: null },
  },
} satisfies Record<string, SeedEntity>;

export type SeedEntityName = keyof typeof SEED_ENTITIES;

export const SEED_ENTITY_NAMES = Object.keys(SEED_ENTITIES) as SeedEntityName[];

/** Resolve names to entities, throwing on an unknown name rather than skipping it. */
export function seedEntitiesFor(names: readonly SeedEntityName[]): SeedEntity[] {
  return names.map((name) => {
    const entity = SEED_ENTITIES[name];
    if(!entity) {
      throw new Error(`[db] Unknown seed entity "${String(name)}".`);
    }
    return entity;
  });
}

/** The `table -> schema` slice for the named entities only. */
export function seedSchemaOf(names: readonly SeedEntityName[]): Record<string, string> {
  const schema: Record<string, string> = {};
  for (const entity of seedEntitiesFor(names)) {
    schema[entity.table] = entity.schema;
  }
  return schema;
}
