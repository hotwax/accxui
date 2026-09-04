/**
 * Standard HotWax OMS Entity Projections & Database Schemas.
 */

import type { EntityProjection } from "../types";

export const COMMON_DB_SCHEMA: Record<string, string> = {
  statuses: "statusId, statusTypeId",
  enums: "enumId, enumTypeId, enumCode",
  enumTypes: "enumTypeId, parentTypeId",
  productStores: "productStoreId, storeName",
  facilities: "facilityId, facilityTypeId, parentTypeId, ownerPartyId",
  facilityTypes: "facilityTypeId, parentTypeId",
  facilityGroups: "facilityGroupId, facilityGroupTypeId",
  groupFacilities: "memberKey, facilityGroupId, facilityId, fromDate, thruDate",
  geos: "geoId, geoTypeEnumId, geoCode",
  geoAssocs: "geoAssocKey, geoId, toGeoId, geoAssocTypeEnumId",
  carriers: "partyId",
  shipmentMethodTypes: "shipmentMethodTypeId",
  carrierShipmentMethods: "carrierShipmentMethodKey, partyId, shipmentMethodTypeId",
  paymentMethodTypes: "paymentMethodTypeId",
  returnReasons: "returnReasonId",
  returnTypes: "returnTypeId",
  returnItemTypes: "returnItemTypeId",
  roleTypes: "roleTypeId, parentTypeId",
  orderAdjustmentTypes: "orderAdjustmentTypeId",
  contactMechPurposeTypes: "contactMechPurposeTypeId",
  communicationEventTypes: "communicationEventTypeId",
  partyRelationshipTypes: "partyRelationshipTypeId",
  statusFlowTransitions: "transitionKey, statusId, toStatusId",
  productStoreFacilities: "storeFacilityKey, productStoreId, facilityId",
  productStoreFacilityGroups: "storeFacilityGroupKey, productStoreId, facilityGroupId",
  productStoreShipmentMethods: "storeShipmentMethodKey, productStoreId, shipmentMethodTypeId",
  productStoreEmailSettings: "emailSettingKey, productStoreId, emailTypeEnumId",
  shopifyShops: "shopId, productStoreId, shopifyShopId",
  shopifyShopLocations: "locationKey, shopId, facilityId, shopifyLocationId",
};

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
    wellKnownText: "text",
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
