/**
 * The 29 HotWax OMS seed reference tables, each declared exactly once.
 *
 * Keyed by IndexedDB store name, so `commonSchema.stores` is what Dexie's `version().stores()`
 * wants with no name/table mapping in between. Standard domains live in the sibling
 * `commonDomains.ts`, keyed by the same table names.
 *
 * Imports only `defineEntity`/`defineSchema`, both of which import only `./types` — app db modules
 * reach this file and the sync workers import those, so nothing here may pull in `vue`.
 */

import { defineEntity } from "../defineEntity";
import { defineSchema } from "../defineSchema";
import type { FieldKind } from "../types";

/** A description-carrying lookup table: `<id>` plus `description`, plus whatever else is passed. */
const lookupFields = (
  keyField: string,
  extra: Record<string, FieldKind> = {},
): Record<string, FieldKind> => ({ [keyField]: "text", description: "text", ...extra });

export const commonSchema = defineSchema({
  productStores: defineEntity({
    primaryKey: "productStoreId",
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
    indexes: ["storeName"],
  }),

  statuses: defineEntity({
    primaryKey: "statusId",
    fields: lookupFields("statusId", { statusTypeId: "text", statusAge: "count" }),
    indexes: ["statusTypeId"],
  }),

  enums: defineEntity({
    primaryKey: "enumId",
    fields: {
      enumId: "text",
      enumTypeId: "text",
      enumCode: "text",
      description: "text",
      typeDescription: "text",
      sequenceNum: "count",
    },
    indexes: ["enumTypeId", "enumCode"],
  }),

  enumTypes: defineEntity({
    primaryKey: "enumTypeId",
    fields: { enumTypeId: "text", parentTypeId: "text", description: "text" },
    indexes: ["parentTypeId"],
  }),

  facilities: defineEntity({
    primaryKey: "facilityId",
    fields: {
      facilityId: "text",
      facilityName: "text",
      facilityTypeId: "text",
      parentTypeId: "text",
      ownerPartyId: "text",
      maximumOrderLimit: "count",
      description: "text",
    },
    indexes: ["facilityTypeId", "parentTypeId", "ownerPartyId"],
  }),

  facilityTypes: defineEntity({
    primaryKey: "facilityTypeId",
    fields: lookupFields("facilityTypeId", { parentTypeId: "text" }),
    indexes: ["parentTypeId"],
  }),

  facilityGroups: defineEntity({
    primaryKey: "facilityGroupId",
    fields: lookupFields("facilityGroupId", {
      facilityGroupName: "text",
      facilityGroupTypeId: "text",
      lastUpdatedStamp: "date",
    }),
    indexes: ["facilityGroupTypeId"],
  }),

  geos: defineEntity({
    primaryKey: "geoId",
    fields: {
      geoId: "text",
      geoTypeEnumId: "text",
      geoName: "text",
      geoCode: "text",
      geoCodeAlpha2: "text",
      geoCodeAlpha3: "text",
    },
    indexes: ["geoTypeEnumId", "geoCode"],
  }),

  carriers: defineEntity({
    primaryKey: "partyId",
    fields: {
      partyId: "text",
      groupName: "text",
      firstName: "text",
      lastName: "text",
      partyTypeId: "text",
      roleTypeId: "text",
      statusId: "text",
    },
    indexes: ["groupName", "roleTypeId"],
  }),

  shipmentMethodTypes: defineEntity({
    primaryKey: "shipmentMethodTypeId",
    fields: lookupFields("shipmentMethodTypeId", { sequenceNum: "count" }),
  }),

  paymentMethodTypes: defineEntity({
    primaryKey: "paymentMethodTypeId",
    fields: lookupFields("paymentMethodTypeId", { paymentMethodCode: "text" }),
  }),

  returnReasons: defineEntity({
    primaryKey: "returnReasonId",
    fields: lookupFields("returnReasonId", { sequenceId: "count" }),
  }),

  returnTypes: defineEntity({
    primaryKey: "returnTypeId",
    fields: lookupFields("returnTypeId"),
  }),

  returnItemTypes: defineEntity({
    primaryKey: "returnItemTypeId",
    fields: lookupFields("returnItemTypeId"),
  }),

  roleTypes: defineEntity({
    primaryKey: "roleTypeId",
    fields: lookupFields("roleTypeId", { parentTypeId: "text" }),
    indexes: ["parentTypeId"],
  }),

  orderAdjustmentTypes: defineEntity({
    primaryKey: "orderAdjustmentTypeId",
    fields: lookupFields("orderAdjustmentTypeId", { hasTable: "text" }),
  }),

  contactMechPurposeTypes: defineEntity({
    primaryKey: "contactMechPurposeTypeId",
    fields: lookupFields("contactMechPurposeTypeId"),
  }),

  communicationEventTypes: defineEntity({
    primaryKey: "communicationEventTypeId",
    fields: lookupFields("communicationEventTypeId"),
  }),

  partyRelationshipTypes: defineEntity({
    primaryKey: "partyRelationshipTypeId",
    fields: lookupFields("partyRelationshipTypeId", { parentTypeId: "text" }),
  }),

  shopifyShops: defineEntity({
    primaryKey: "shopId",
    fields: {
      shopId: "text",
      productStoreId: "text",
      shopifyShopId: "text",
      name: "text",
      // Read by views/OrderDetail.vue to build the Shopify admin order link.
      myshopifyDomain: "text",
      domain: "text",
      systemMessageRemoteId: "text",
      currency: "text",
      primaryLocationId: "text",
      realTimeInventoryPush: "text",
      lastUpdatedStamp: "date",
    },
    indexes: ["productStoreId", "shopifyShopId"],
  }),

  groupFacilities: defineEntity({
    // Real compound key. OFBiz FacilityGroupMember is (facilityGroupId, facilityId, fromDate);
    // the old synthetic `memberKey` joined those three into one string.
    primaryKey: "facilityGroupId,facilityId,fromDate",
    fields: {
      facilityGroupId: "text",
      facilityId: "text",
      facilityName: "text",
      facilityGroupName: "text",
      facilityTypeId: "text",
      fromDate: "date",
      thruDate: "date",
    },
    indexes: ["facilityGroupId", "facilityId", "fromDate", "thruDate"],
  }),

  geoAssocs: defineEntity({
    primaryKey: "geoId,toGeoId",
    fields: {
      geoId: "text",
      toGeoId: "text",
      geoAssocTypeEnumId: "text",
    },
    indexes: ["geoId", "toGeoId", "geoAssocTypeEnumId"],
    // The list response names the far side `geoIdTo` on some routes.
    rename: { toGeoId: "geoIdTo" },
  }),

  carrierShipmentMethods: defineEntity({
    primaryKey: "partyId,shipmentMethodTypeId",
    fields: {
      partyId: "text",
      shipmentMethodTypeId: "text",
      roleTypeId: "text",
      sequenceNumber: "count",
      carrierServiceCode: "text",
      deliveryDays: "count",
    },
    indexes: ["partyId", "roleTypeId", "shipmentMethodTypeId", "sequenceNumber"],
  }),

  statusFlowTransitions: defineEntity({
    primaryKey: "statusFlowId,statusId,toStatusId",
    fields: {
      statusId: "text",
      toStatusId: "text",
      statusFlowId: "text",
      transitionSequence: "count",
    },
    indexes: ["statusId", "toStatusId", "statusFlowId"],
  }),

  productStoreFacilities: defineEntity({
    primaryKey: "productStoreId,facilityId",
    fields: {
      productStoreId: "text",
      facilityId: "text",
      facilityName: "text",
      facilityTypeId: "text",
      sequenceNum: "count",
      fromDate: "date",
    },
    indexes: ["productStoreId", "facilityId"],
  }),

  productStoreFacilityGroups: defineEntity({
    primaryKey: "productStoreId,facilityGroupId",
    fields: {
      productStoreId: "text",
      facilityGroupId: "text",
      fromDate: "date",
    },
    indexes: ["productStoreId", "facilityGroupId"],
  }),

  productStoreShipmentMethods: defineEntity({
    // OFBiz ProductStoreShipmentMeth is keyed by a SURROGATE id, not by the natural triple, and
    // Company's own `productStoreShippingMethods` table already keys on it. The old synthetic
    // `storeShipmentMethodKey` joined productStore + method + party, and tolerated NO party at
    // all (`partyId || carrierPartyId || ""`), so a natural compound key would have had to either
    // drop carrier-less rows or collide on them. The surrogate avoids both.
    primaryKey: "productStoreShipMethId",
    fields: {
      productStoreShipMethId: "text",
      productStoreId: "text",
      shipmentMethodTypeId: "text",
      partyId: "text",
      carrierPartyId: "text",
      description: "text",
    },
    indexes: ["productStoreId", "shipmentMethodTypeId", "partyId"],
    // Some routes name the carrier only `carrierPartyId`; keep `partyId` populated either way.
    rename: { partyId: "carrierPartyId" },
  }),

  productStoreEmailSettings: defineEntity({
    primaryKey: "productStoreId,emailTypeEnumId",
    fields: {
      productStoreId: "text",
      emailTypeEnumId: "text",
      subject: "text",
      bodyScreenLocation: "text",
      systemMessageRemoteId: "text",
    },
    indexes: ["productStoreId", "emailTypeEnumId"],
    rename: { emailTypeEnumId: "emailType" },
  }),

  shopifyShopLocations: defineEntity({
    primaryKey: "shopId,shopifyLocationId",
    fields: {
      shopId: "text",
      facilityId: "text",
      shopifyLocationId: "text",
    },
    indexes: ["shopId", "facilityId", "shopifyLocationId"],
  }),
}, { seed: true });
