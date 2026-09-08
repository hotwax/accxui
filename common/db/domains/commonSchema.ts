/**
 * The 29 HotWax OMS seed reference tables, each declared exactly once.
 *
 * Keyed by IndexedDB store name, so `commonSchema.stores` is what Dexie's `version().stores()`
 * wants with no name/table mapping in between. `label` and `source` live in the sibling
 * `seedSources.ts`, keyed by the same table names.
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
      roleTypeId: "text",
    },
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
    },
    indexes: ["productStoreId", "shopifyShopId"],
  }),
});
