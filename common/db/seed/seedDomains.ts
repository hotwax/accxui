/**
 * Standard HotWax OMS Reference (Class B) Snapshot Domain Definitions.
 */

import { defineSnapshotDomain } from "../sync/defineSnapshotDomain";
import type { SyncDomain } from "../types";

export const commonDomains: Record<string, SyncDomain> = {
  productStore: defineSnapshotDomain({
    name: "productStore",
    label: "Product stores",
    syncClass: "B",
    table: "productStores",
    listUrl: "admin/productStores",
    collectionKey: null,
    byPk: (pk) => ({ url: `admin/productStores/${encodeURIComponent(String(pk.productStoreId))}` }),
  }),

  status: defineSnapshotDomain({
    name: "status",
    label: "Statuses",
    syncClass: "B",
    table: "statuses",
    listUrl: "admin/status",
    collectionKey: null,
    batchSize: 500,
  }),

  enum: defineSnapshotDomain({
    name: "enum",
    label: "Enumerations",
    syncClass: "B",
    table: "enums",
    listUrl: "admin/enums",
    collectionKey: null,
    batchSize: 500,
  }),

  enumType: defineSnapshotDomain({
    name: "enumType",
    label: "Enumeration types",
    syncClass: "B",
    table: "enumTypes",
    listUrl: "admin/enumTypes",
    collectionKey: null,
  }),

  facility: defineSnapshotDomain({
    name: "facility",
    label: "Facilities",
    syncClass: "B",
    table: "facilities",
    listUrl: "oms/facilities",
    collectionKey: null,
    byPk: (pk) => ({ url: `oms/facilities/${encodeURIComponent(String(pk.facilityId))}` }),
  }),

  facilityType: defineSnapshotDomain({
    name: "facilityType",
    label: "Facility types",
    syncClass: "B",
    table: "facilityTypes",
    listUrl: "oms/facilityTypes",
    collectionKey: null,
  }),

  facilityGroup: defineSnapshotDomain({
    name: "facilityGroup",
    label: "Facility groups",
    syncClass: "B",
    table: "facilityGroups",
    listUrl: "oms/facilityGroups",
    collectionKey: null,
  }),

  groupFacility: defineSnapshotDomain({
    name: "groupFacility",
    label: "Facility group members",
    syncClass: "B",
    table: "groupFacilities",
    listUrl: "oms/groupFacilities",
    collectionKey: null,
    refetchScope: (pk) => ({
      params: { facilityGroupId: pk.facilityGroupId },
      scope: { field: "facilityGroupId", value: pk.facilityGroupId },
    }),
  }),

  geo: defineSnapshotDomain({
    name: "geo",
    label: "Geos (countries/states)",
    syncClass: "B",
    table: "geos",
    listUrl: "admin/geos",
    collectionKey: null,
    batchSize: 500,
  }),

  geoAssoc: defineSnapshotDomain({
    name: "geoAssoc",
    label: "Geo associations",
    syncClass: "B",
    table: "geoAssocs",
    listUrl: "admin/geos/assocs",
    collectionKey: null,
    batchSize: 500,
  }),

  carrier: defineSnapshotDomain({
    name: "carrier",
    label: "Shipping Carriers",
    syncClass: "B",
    table: "carriers",
    listUrl: "oms/shippingGateways/carrierParties",
    listParams: { roleTypeId: "CARRIER" },
    collectionKey: null,
  }),

  shipmentMethodType: defineSnapshotDomain({
    name: "shipmentMethodType",
    label: "Shipment method types",
    syncClass: "B",
    table: "shipmentMethodTypes",
    listUrl: "oms/shippingGateways/shipmentMethodTypes",
    collectionKey: null,
  }),

  carrierShipmentMethod: defineSnapshotDomain({
    name: "carrierShipmentMethod",
    label: "Carrier Shipment Methods",
    syncClass: "B",
    table: "carrierShipmentMethods",
    listUrl: "oms/shippingGateways/carrierShipmentMethods",
    collectionKey: null,
  }),

  paymentMethodType: defineSnapshotDomain({
    name: "paymentMethodType",
    label: "Payment method types",
    syncClass: "B",
    table: "paymentMethodTypes",
    listUrl: "oms/paymentMethodTypes",
    collectionKey: null,
  }),

  returnReason: defineSnapshotDomain({
    name: "returnReason",
    label: "Return Reasons",
    syncClass: "B",
    table: "returnReasons",
    listUrl: "oms/returnReasons",
    collectionKey: null,
  }),

  returnType: defineSnapshotDomain({
    name: "returnType",
    label: "Return Types",
    syncClass: "B",
    table: "returnTypes",
    listUrl: "oms/returnTypes",
    collectionKey: null,
  }),

  returnItemType: defineSnapshotDomain({
    name: "returnItemType",
    label: "Return Item Types",
    syncClass: "B",
    table: "returnItemTypes",
    listUrl: "oms/returnItemTypes",
    collectionKey: null,
  }),

  roleType: defineSnapshotDomain({
    name: "roleType",
    label: "Role types",
    syncClass: "B",
    table: "roleTypes",
    listUrl: "oms/roleTypes",
    collectionKey: null,
  }),

  orderAdjustmentType: defineSnapshotDomain({
    name: "orderAdjustmentType",
    label: "Order Adjustment Types",
    syncClass: "B",
    table: "orderAdjustmentTypes",
    listUrl: "oms/shippingGateways/orderAdjustmentTypes",
    collectionKey: null,
  }),

  contactMechPurposeType: defineSnapshotDomain({
    name: "contactMechPurposeType",
    label: "Contact Purpose Types",
    syncClass: "B",
    table: "contactMechPurposeTypes",
    listUrl: "oms/contactMechPurposeTypes",
    collectionKey: null,
  }),

  communicationEventType: defineSnapshotDomain({
    name: "communicationEventType",
    label: "Communication Types",
    syncClass: "B",
    table: "communicationEventTypes",
    listUrl: "oms/communicationEventTypes",
    collectionKey: null,
  }),

  partyRelationshipType: defineSnapshotDomain({
    name: "partyRelationshipType",
    label: "Relationship Types",
    syncClass: "B",
    table: "partyRelationshipTypes",
    listUrl: "oms/partyRelationshipTypes",
    collectionKey: null,
  }),

  statusFlowTransition: defineSnapshotDomain({
    name: "statusFlowTransition",
    label: "Status Flow Transitions",
    syncClass: "B",
    table: "statusFlowTransitions",
    listUrl: "admin/statusFlows/transitions",
    collectionKey: null,
  }),

  productStoreFacility: defineSnapshotDomain({
    name: "productStoreFacility",
    label: "Store facilities",
    syncClass: "B",
    table: "productStoreFacilities",
    listUrl: "oms/productStores",
    fanOut: {
      parentTable: "productStores",
      parentKeyField: "productStoreId",
      urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/facilities`,
    },
  }),

  productStoreFacilityGroup: defineSnapshotDomain({
    name: "productStoreFacilityGroup",
    label: "Store Facility Groups",
    syncClass: "B",
    table: "productStoreFacilityGroups",
    listUrl: "oms/productStores",
    fanOut: {
      parentTable: "productStores",
      parentKeyField: "productStoreId",
      urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/facilityGroups`,
    },
  }),

  productStoreShipmentMethod: defineSnapshotDomain({
    name: "productStoreShipmentMethod",
    label: "Store Shipment Methods",
    syncClass: "B",
    table: "productStoreShipmentMethods",
    listUrl: "oms/productStores",
    fanOut: {
      parentTable: "productStores",
      parentKeyField: "productStoreId",
      urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/shipmentMethods`,
    },
  }),

  productStoreEmailSetting: defineSnapshotDomain({
    name: "productStoreEmailSetting",
    label: "Store Email Settings",
    syncClass: "B",
    table: "productStoreEmailSettings",
    listUrl: "oms/productStoreEmailSettings",
    collectionKey: null,
  }),

  shopifyShop: defineSnapshotDomain({
    name: "shopifyShop",
    label: "Shopify Shops",
    syncClass: "B",
    table: "shopifyShops",
    listUrl: "oms/shopifyShops/shops",
    collectionKey: null,
  }),

  shopifyShopLocation: defineSnapshotDomain({
    name: "shopifyShopLocation",
    label: "Shopify Shop Locations",
    syncClass: "B",
    table: "shopifyShopLocations",
    listUrl: "oms/shopifyShops/locations",
    collectionKey: null,
  }),
};

export const commonDomainsByTable: Record<string, SyncDomain> = Object.fromEntries(
  Object.values(commonDomains).map((domain) => [domain.table, domain])
);

export const COMMON_TABLE_NAMES = Object.keys(commonDomainsByTable);
export const COMMON_DOMAIN_NAMES = Object.keys(commonDomains);
