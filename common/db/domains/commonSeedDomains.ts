/**
 * Standard HotWax OMS Reference (Class B) Snapshot Domain Registrations.
 */

import type { BaseDB } from "../baseDb";
import { registerSnapshotDomain } from "../sync/snapshotDomain";
import {
  carrierProjection,
  carrierShipmentMethodProjection,
  communicationEventTypeProjection,
  contactMechPurposeTypeProjection,
  enumProjection,
  enumTypeProjection,
  facilityGroupProjection,
  facilityProjection,
  facilityTypeProjection,
  geoAssocProjection,
  geoProjection,
  groupFacilityProjection,
  orderAdjustmentTypeProjection,
  partyRelationshipTypeProjection,
  paymentMethodTypeProjection,
  productStoreEmailSettingProjection,
  productStoreFacilityGroupProjection,
  productStoreFacilityProjection,
  productStoreProjection,
  productStoreShipmentMethodProjection,
  returnItemTypeProjection,
  returnReasonProjection,
  returnTypeProjection,
  roleTypeProjection,
  shipmentMethodTypeProjection,
  shopifyShopLocationProjection,
  shopifyShopProjection,
  statusFlowTransitionProjection,
  statusProjection,
} from "./commonSeedEntities";

export function registerCommonSeedDomains(getDb: (omsInstance: string) => BaseDB): void {
  registerSnapshotDomain({
    name: "productStore",
    table: "productStores",
    projection: productStoreProjection,
    listUrl: "admin/productStores",
    collectionKey: null,
    byPk: (pk) => ({ url: `admin/productStores/${encodeURIComponent(String(pk.productStoreId))}` }),
  }, getDb);

  registerSnapshotDomain({
    name: "status",
    table: "statuses",
    projection: statusProjection,
    listUrl: "admin/status",
    collectionKey: null,
    batchSize: 500,
  }, getDb);

  registerSnapshotDomain({
    name: "enum",
    table: "enums",
    projection: enumProjection,
    listUrl: "admin/enums",
    collectionKey: null,
    batchSize: 500,
  }, getDb);

  registerSnapshotDomain({
    name: "enumType",
    table: "enumTypes",
    projection: enumTypeProjection,
    listUrl: "admin/enumTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "facility",
    table: "facilities",
    projection: facilityProjection,
    listUrl: "oms/facilities",
    collectionKey: null,
    byPk: (pk) => ({ url: `oms/facilities/${encodeURIComponent(String(pk.facilityId))}` }),
  }, getDb);

  registerSnapshotDomain({
    name: "facilityType",
    table: "facilityTypes",
    projection: facilityTypeProjection,
    listUrl: "oms/facilityTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "facilityGroup",
    table: "facilityGroups",
    projection: facilityGroupProjection,
    listUrl: "oms/facilityGroups",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "groupFacility",
    table: "groupFacilities",
    projection: groupFacilityProjection,
    listUrl: "oms/groupFacilities",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "geo",
    table: "geos",
    projection: geoProjection,
    listUrl: "admin/geos",
    collectionKey: null,
    batchSize: 500,
  }, getDb);

  registerSnapshotDomain({
    name: "geoAssoc",
    table: "geoAssocs",
    projection: geoAssocProjection,
    listUrl: "admin/geos/assocs",
    collectionKey: null,
    batchSize: 500,
  }, getDb);

  registerSnapshotDomain({
    name: "carrier",
    table: "carriers",
    projection: carrierProjection,
    listUrl: "oms/shippingGateways/carrierParties",
    listParams: {
      roleTypeId: "CARRIER",
    },
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "shipmentMethodType",
    table: "shipmentMethodTypes",
    projection: shipmentMethodTypeProjection,
    listUrl: "oms/shippingGateways/shipmentMethodTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "carrierShipmentMethod",
    table: "carrierShipmentMethods",
    projection: carrierShipmentMethodProjection,
    listUrl: "oms/shippingGateways/carrierShipmentMethods",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "paymentMethodType",
    table: "paymentMethodTypes",
    projection: paymentMethodTypeProjection,
    listUrl: "oms/paymentMethodTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "returnReason",
    table: "returnReasons",
    projection: returnReasonProjection,
    listUrl: "oms/returnReasons",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "returnType",
    table: "returnTypes",
    projection: returnTypeProjection,
    listUrl: "oms/returnTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "returnItemType",
    table: "returnItemTypes",
    projection: returnItemTypeProjection,
    listUrl: "oms/returnItemTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "roleType",
    table: "roleTypes",
    projection: roleTypeProjection,
    listUrl: "oms/roleTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "orderAdjustmentType",
    table: "orderAdjustmentTypes",
    projection: orderAdjustmentTypeProjection,
    listUrl: "oms/shippingGateways/orderAdjustmentTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "contactMechPurposeType",
    table: "contactMechPurposeTypes",
    projection: contactMechPurposeTypeProjection,
    listUrl: "oms/contactMechPurposeTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "communicationEventType",
    table: "communicationEventTypes",
    projection: communicationEventTypeProjection,
    listUrl: "oms/communicationEventTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "partyRelationshipType",
    table: "partyRelationshipTypes",
    projection: partyRelationshipTypeProjection,
    listUrl: "oms/partyRelationshipTypes",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "statusFlowTransition",
    table: "statusFlowTransitions",
    projection: statusFlowTransitionProjection,
    listUrl: "admin/statusFlows/transitions",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "productStoreFacility",
    table: "productStoreFacilities",
    projection: productStoreFacilityProjection,
    listUrl: "oms/productStores",
    fanOut: {
      parentTable: "productStores",
      parentKeyField: "productStoreId",
      urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/facilities`,
    },
  }, getDb);

  registerSnapshotDomain({
    name: "productStoreFacilityGroup",
    table: "productStoreFacilityGroups",
    projection: productStoreFacilityGroupProjection,
    listUrl: "oms/productStores",
    fanOut: {
      parentTable: "productStores",
      parentKeyField: "productStoreId",
      urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/facilityGroups`,
    },
  }, getDb);

  registerSnapshotDomain({
    name: "productStoreShipmentMethod",
    table: "productStoreShipmentMethods",
    projection: productStoreShipmentMethodProjection,
    listUrl: "oms/productStores",
    fanOut: {
      parentTable: "productStores",
      parentKeyField: "productStoreId",
      urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/shipmentMethods`,
    },
  }, getDb);

  registerSnapshotDomain({
    name: "productStoreEmailSetting",
    table: "productStoreEmailSettings",
    projection: productStoreEmailSettingProjection,
    listUrl: "oms/productStoreEmailSettings",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "shopifyShop",
    table: "shopifyShops",
    projection: shopifyShopProjection,
    listUrl: "oms/shopifyShops/shops",
    collectionKey: null,
  }, getDb);

  registerSnapshotDomain({
    name: "shopifyShopLocation",
    table: "shopifyShopLocations",
    projection: shopifyShopLocationProjection,
    listUrl: "oms/shopifyShops/locations",
    collectionKey: null,
  }, getDb);
}
