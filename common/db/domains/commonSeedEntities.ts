/**
 * Standard HotWax OMS Entity Projections & Database Schemas.
 *
 * The projections now live in ./seedEntities (the source of truth) and are re-exported here so
 * existing importers keep working. This indirection avoids a circular import between the two
 * modules: seedEntities.ts needs the projections at module-evaluation time to build
 * SEED_ENTITIES, so it owns them directly instead of importing them back from this file.
 */

import { SEED_ENTITY_NAMES, seedSchemaOf } from "./seedEntities";

/**
 * Every seed table. Derived from SEED_ENTITIES, which is the source of truth.
 *
 * Prefer declaring the tables you need via `defineAppDb({ seed: [...] })` — that creates only
 * the stores your app reads. This full map exists for backwards compatibility.
 */
export const COMMON_DB_SCHEMA: Record<string, string> = seedSchemaOf(SEED_ENTITY_NAMES);

export {
  statusProjection,
  enumProjection,
  enumTypeProjection,
  productStoreProjection,
  facilityProjection,
  facilityTypeProjection,
  facilityGroupProjection,
  groupFacilityProjection,
  geoProjection,
  geoAssocProjection,
  carrierProjection,
  shipmentMethodTypeProjection,
  carrierShipmentMethodProjection,
  paymentMethodTypeProjection,
  returnReasonProjection,
  returnTypeProjection,
  returnItemTypeProjection,
  roleTypeProjection,
  orderAdjustmentTypeProjection,
  contactMechPurposeTypeProjection,
  communicationEventTypeProjection,
  partyRelationshipTypeProjection,
  statusFlowTransitionProjection,
  productStoreFacilityProjection,
  productStoreFacilityGroupProjection,
  productStoreShipmentMethodProjection,
  shopifyShopProjection,
  shopifyShopLocationProjection,
  productStoreEmailSettingProjection,
} from "./seedEntities";
