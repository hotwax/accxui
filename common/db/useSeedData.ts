/**
 * Framework seed reference data lookups, read straight from the local database.
 *
 * `useSeedData()` takes no arguments: it automatically resolves the active app database via `getAppDb().client()`.
 * Every getter opens IndexedDB, reads what it needs, applies whatever filtering or joining the answer requires,
 * and returns a value with raw ID fallbacks.
 */

import { commonUtil } from "../utils/commonUtil";
import type { AppDb } from "./defineAppDb";
import { type DbClient } from "./dbClient";
import { getAppDb } from "./appDbRegistry";
import type { DbKey } from "./types";

export type Row = Record<string, any>;
export type DbTarget = AppDb | DbClient | { client(): DbClient; raw(): any };

/**
 * The seed lookup API.
 *
 * Used as `const seed = useSeedData()` then `seed.getStatusDescription(id)`.
 * If `targetDb` is omitted, it defaults to `getAppDb()`.
 */
export function useSeedData(targetDb?: DbTarget) {
  const getClient = (): DbClient => {
    const db = targetDb ?? getAppDb();
    if ("client" in db && typeof db.client === "function") {
      return db.client();
    }
    return db as DbClient;
  };

  /** Read a whole table, degrading to an empty list. */
  async function rows(table: string): Promise<Row[]> {
    try {
      return await getClient().entity(table).all();
    } catch (error) {
      console.warn(`[seed] Could not read ${table} from the local database:`, error);
      return [];
    }
  }

  /** Read one row by primary key, degrading to undefined. */
  async function row(table: string, key: DbKey): Promise<Row | undefined> {
    const missing = !key || (Array.isArray(key) && key.length === 0);
    if (missing) return undefined;

    try {
      return await getClient().entity(table).get(key);
    } catch (error) {
      console.warn(`[seed] Could not read ${table}/${key} from the local database:`, error);
      return undefined;
    }
  }

  const DEFAULT_LABEL_FIELDS = ["description", "enumName", "name", "groupName", "facilityName", "storeName"];

  /** First non-empty value among `fields`, else the raw id. */
  function labelOf(record: Row | undefined, id: string, fields = DEFAULT_LABEL_FIELDS): string {
    return (fields.map((field) => record?.[field]).find(Boolean) as string) || id;
  }

  /** One label by primary key. */
  async function label(table: string, keyField: string, id: string, fields?: string[]): Promise<string> {
    if (!id) return "";
    const found = await row(table, id);
    return labelOf(found, id, fields);
  }

  /**
   * Labels for many ids in one table read. The workhorse behind every plural getter: a list
   * screen resolves all its labels with a single pass over the table.
   */
  async function labels(
    table: string,
    keyField: string,
    ids: readonly string[],
    fields?: string[],
  ): Promise<Record<string, string>> {
    const wanted = [...new Set(ids.filter(Boolean))];
    if (!wanted.length) return {};

    const all = await rows(table);
    const byKey = new Map(all.map((record) => [record[keyField], record]));

    return Object.fromEntries(wanted.map((id) => [id, labelOf(byKey.get(id), id, fields)]));
  }

  // ── Statuses ──────────────────────────────────────────────────────────────────────────

  const getStatus = (statusId: string) => row("statuses", statusId);
  const getStatusDescription = (statusId: string) => label("statuses", "statusId", statusId);
  const getStatusDescriptions = (statusIds: readonly string[]) => labels("statuses", "statusId", statusIds);

  async function getStatusAge(statusId: string): Promise<number> {
    return Number((await getStatus(statusId))?.statusAge ?? 0);
  }

  async function getStatusAges(statusIds: readonly string[]): Promise<Record<string, number>> {
    const wanted = [...new Set(statusIds.filter(Boolean))];
    if (!wanted.length) return {};

    const all = await rows("statuses");
    const byKey = new Map(all.map((record) => [record.statusId, record]));

    return Object.fromEntries(wanted.map((id) => [id, Number(byKey.get(id)?.statusAge ?? 0)]));
  }

  async function getStatusItemsByType(statusTypeId: string): Promise<Row[]> {
    return (await rows("statuses")).filter((record) => record.statusTypeId === statusTypeId);
  }

  // ── Enums ─────────────────────────────────────────────────────────────────────────────

  const getEnumDescription = (enumId: string) => label("enums", "enumId", enumId);
  const getEnumDescriptions = (enumIds: readonly string[]) => labels("enums", "enumId", enumIds);

  async function getEnumsByType(enumTypeId: string): Promise<Row[]> {
    return (await rows("enums")).filter((record) => record.enumTypeId === enumTypeId);
  }

  async function getEnumsByParentType(parentTypeId: string): Promise<Row[]> {
    const [enums, enumTypes] = await Promise.all([rows("enums"), rows("enumTypes")]);
    const childTypeIds = new Set(
      enumTypes.filter((type) => type.parentTypeId === parentTypeId).map((type) => type.enumTypeId),
    );

    return enums.filter((record) => childTypeIds.has(record.enumTypeId));
  }

  const getOrderIdentificationTypeDescription = (enumId: string) => getEnumDescription(enumId);

  async function getOrderIdentificationTypeOptions(): Promise<Array<{ enumId: string; description: string }>> {
    return (await getEnumsByType("ORDER_IDENTITY")).map((record) => ({
      enumId: record.enumId,
      description: labelOf(record, record.enumId),
    }));
  }

  // ── Product stores ────────────────────────────────────────────────────────────────────

  const getProductStores = () => rows("productStores");
  const getProductStore = (productStoreId: string) => row("productStores", productStoreId);
  const getProductStoreName = (productStoreId: string) =>
    label("productStores", "productStoreId", productStoreId, ["storeName", "companyName"]);
  const getProductStoreNames = (productStoreIds: readonly string[]) =>
    labels("productStores", "productStoreId", productStoreIds, ["storeName", "companyName"]);

  async function getProductStoreFacilities(productStoreId: string): Promise<Row[]> {
    if (!productStoreId) return [];
    return (await rows("productStoreFacilities")).filter((record) => record.productStoreId === productStoreId);
  }

  // ── Facilities ────────────────────────────────────────────────────────────────────────

  const getFacilities = () => rows("facilities");
  const getFacility = (facilityId: string) => row("facilities", facilityId);
  const getFacilityName = (facilityId: string) =>
    label("facilities", "facilityId", facilityId, ["facilityName", "facilityId"]);
  const getFacilityNames = (facilityIds: readonly string[]) =>
    labels("facilities", "facilityId", facilityIds, ["facilityName", "facilityId"]);
  const getFacilityType = (facilityTypeId: string) => row("facilityTypes", facilityTypeId);

  async function getFacilityParentTypeId(facilityTypeId: string): Promise<string> {
    return (await getFacilityType(facilityTypeId))?.parentTypeId ?? "";
  }

  async function getFacilityParentTypeIds(facilityTypeIds: readonly string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(facilityTypeIds.filter(Boolean))];
    if (!wanted.length) return {};

    const all = await rows("facilityTypes");
    const byKey = new Map(all.map((record) => [record.facilityTypeId, record]));

    return Object.fromEntries(wanted.map((id) => [id, byKey.get(id)?.parentTypeId ?? ""]));
  }

  // ── Carriers and shipment methods ─────────────────────────────────────────────────────

  const carrierLabel = (carrier: Row) =>
    [carrier.firstName, carrier.lastName].filter(Boolean).join(" ") || carrier.groupName || carrier.partyId;

  const getCarriers = () => rows("carriers");
  const getCarrier = (partyId: string) => row("carriers", partyId);

  async function getCarrierName(partyId: string): Promise<string> {
    const found = await getCarrier(partyId);
    return found ? carrierLabel(found) : partyId;
  }

  const getShipmentMethodTypes = () => rows("shipmentMethodTypes");
  const getShipmentMethod = (shipmentMethodTypeId: string) => row("shipmentMethodTypes", shipmentMethodTypeId);

  const SHIPMENT_METHOD_LABEL_FIELDS = ["description", "shipmentMethodTypeId"];

  const getShipmentMethodDescription = (shipmentMethodTypeId: string) =>
    label("shipmentMethodTypes", "shipmentMethodTypeId", shipmentMethodTypeId, SHIPMENT_METHOD_LABEL_FIELDS);

  const getShipmentMethodDescriptions = (shipmentMethodTypeIds: readonly string[]) =>
    labels("shipmentMethodTypes", "shipmentMethodTypeId", shipmentMethodTypeIds, SHIPMENT_METHOD_LABEL_FIELDS);

  async function getShipmentMethodOptions(): Promise<Array<{ id: string; label: string }>> {
    return (await getShipmentMethodTypes()).map((record) => ({
      id: record.shipmentMethodTypeId,
      label: labelOf(record, record.shipmentMethodTypeId, SHIPMENT_METHOD_LABEL_FIELDS),
    }));
  }

  async function getShippingMethodsByCarrier(carrierPartyId: string): Promise<Row[]> {
    if (!carrierPartyId) return [];
    return (await rows("carrierShipmentMethods")).filter((record) => record.partyId === carrierPartyId);
  }

  // ── Simple type lookups ───────────────────────────────────────────────────────────────

  const getPaymentMethodDescription = (id: string) => label("paymentMethodTypes", "paymentMethodTypeId", id);
  const getPaymentMethodDescriptions = (ids: readonly string[]) =>
    labels("paymentMethodTypes", "paymentMethodTypeId", ids);

  const getReturnReasonDescription = (id: string) => label("returnReasons", "returnReasonId", id);
  const getReturnReasonDescriptions = (ids: readonly string[]) =>
    labels("returnReasons", "returnReasonId", ids);

  const getReturnTypeDescription = (id: string) => label("returnTypes", "returnTypeId", id);
  const getReturnTypeDescriptions = (ids: readonly string[]) => labels("returnTypes", "returnTypeId", ids);

  const getReturnItemTypeDescription = (id: string) => label("returnItemTypes", "returnItemTypeId", id);
  const getReturnItemTypeDescriptions = (ids: readonly string[]) =>
    labels("returnItemTypes", "returnItemTypeId", ids);

  const getRoleTypeDescription = (id: string) => label("roleTypes", "roleTypeId", id);

  const getOrderAdjustmentTypeDescription = (id: string) => label("orderAdjustmentTypes", "orderAdjustmentTypeId", id);
  const getOrderAdjustmentTypeDescriptions = (ids: readonly string[]) =>
    labels("orderAdjustmentTypes", "orderAdjustmentTypeId", ids);

  const getContactPurposeDescription = (id: string) =>
    label("contactMechPurposeTypes", "contactMechPurposeTypeId", id);
  const getContactPurposeDescriptions = (ids: readonly string[]) =>
    labels("contactMechPurposeTypes", "contactMechPurposeTypeId", ids);

  const getCommunicationEventTypeDescription = (id: string) =>
    label("communicationEventTypes", "communicationEventTypeId", id);
  const getCommunicationEventTypeDescriptions = (ids: readonly string[]) =>
    labels("communicationEventTypes", "communicationEventTypeId", ids);

  const RELATIONSHIP_LABEL_FIELDS = ["description", "partyRelationshipName"];

  const getPartyRelationshipDescription = (id: string) =>
    label("partyRelationshipTypes", "partyRelationshipTypeId", id, RELATIONSHIP_LABEL_FIELDS);
  const getPartyRelationshipDescriptions = (ids: readonly string[]) =>
    labels("partyRelationshipTypes", "partyRelationshipTypeId", ids, RELATIONSHIP_LABEL_FIELDS);

  const getPartyRelationshipTypes = () => rows("partyRelationshipTypes");
  const getRoleTypes = () => rows("roleTypes");

  // ── Shopify ───────────────────────────────────────────────────────────────────────────

  const getShopifyShops = () => rows("shopifyShops");
  const getShopifyShop = (shopId: string) => row("shopifyShops", shopId);
  const getShopifyShopLocations = () => rows("shopifyShopLocations");

  // ── Geography ─────────────────────────────────────────────────────────────────────────

  const byGeoName = (left: Row, right: Row) => (left.geoName || "").localeCompare(right.geoName || "");

  const getGeos = () => rows("geos");
  const getGeoName = (geoId: string) => label("geos", "geoId", geoId, ["geoName"]);
  const getGeoNames = (geoIds: readonly string[]) => labels("geos", "geoId", geoIds, ["geoName"]);

  async function getGeoIdByCode(code: string): Promise<string> {
    if (!code) return "";
    const all = await rows("geos");
    return all.find((geo) => geo.geoCodeAlpha2 === code || geo.geoCode === code)?.geoId ?? "";
  }

  async function getGeoIdsByCode(codes: readonly string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(codes.filter(Boolean))];
    if (!wanted.length) return {};
    const all = await rows("geos");
    return Object.fromEntries(
      wanted.map((code) => [
        code,
        all.find((geo) => geo.geoCodeAlpha2 === code || geo.geoCode === code)?.geoId ?? "",
      ]),
    );
  }

  async function getCountries(): Promise<Row[]> {
    return (await rows("geos")).filter((geo) => geo.geoTypeEnumId === "GEOT_COUNTRY").sort(byGeoName);
  }

  async function getStates(): Promise<Row[]> {
    return (await rows("geos"))
      .filter((geo) => geo.geoTypeEnumId === "GEOT_STATE" || geo.geoTypeEnumId === "GEOT_PROVINCE")
      .sort(byGeoName);
  }

  async function getStatesForCountry(countryGeoId: string): Promise<Row[]> {
    if (!countryGeoId) return [];
    const [geos, geoAssocs] = await Promise.all([rows("geos"), rows("geoAssocs")]);
    const stateIds = new Set(geoAssocs.filter((assoc) => assoc.geoId === countryGeoId).map((assoc) => assoc.toGeoId));
    return geos.filter((geo) => stateIds.has(geo.geoId)).sort(byGeoName);
  }

  // ── Status flow ───────────────────────────────────────────────────────────────────────

  async function getAllowedTransitions(statusId: string): Promise<Array<Row & { toStatusDescription: string; toStatusColor: string }>> {
    if (!statusId) return [];
    const [transitions, statuses] = await Promise.all([rows("statusFlowTransitions"), rows("statuses")]);
    const statusByKey = new Map(statuses.map((record) => [record.statusId, record]));

    return transitions
      .filter((transition) => transition.statusId === statusId)
      .map((transition) => {
        const toStatusDescription = labelOf(statusByKey.get(transition.toStatusId), transition.toStatusId);
        return {
          ...transition,
          toStatusDescription,
          toStatusColor: commonUtil.getStatusColor(toStatusDescription),
        };
      })
      .sort((left, right) => {
        const leftSequence = left.transitionSequence ?? Number.MAX_SAFE_INTEGER;
        const rightSequence = right.transitionSequence ?? Number.MAX_SAFE_INTEGER;
        if (leftSequence !== rightSequence) return leftSequence - rightSequence;
        return (left.toStatusId || "").localeCompare(right.toStatusId || "");
      });
  }

  return {
    getAllowedTransitions,
    getCarrier,
    getCarrierName,
    getCarriers,
    getCommunicationEventTypeDescription,
    getCommunicationEventTypeDescriptions,
    getContactPurposeDescription,
    getContactPurposeDescriptions,
    getCountries,
    getEnumDescription,
    getEnumDescriptions,
    getEnumsByParentType,
    getEnumsByType,
    getFacilities,
    getFacility,
    getFacilityName,
    getFacilityNames,
    getFacilityParentTypeId,
    getFacilityParentTypeIds,
    getFacilityType,
    getGeoIdByCode,
    getGeoIdsByCode,
    getGeoName,
    getGeoNames,
    getGeos,
    getOrderAdjustmentTypeDescription,
    getOrderAdjustmentTypeDescriptions,
    getOrderIdentificationTypeDescription,
    getOrderIdentificationTypeOptions,
    getPartyRelationshipDescription,
    getPartyRelationshipDescriptions,
    getPartyRelationshipTypes,
    getPaymentMethodDescription,
    getPaymentMethodDescriptions,
    getProductStore,
    getProductStores,
    getProductStoreFacilities,
    getProductStoreName,
    getProductStoreNames,
    getReturnItemTypeDescription,
    getReturnItemTypeDescriptions,
    getReturnReasonDescription,
    getReturnReasonDescriptions,
    getReturnTypeDescription,
    getReturnTypeDescriptions,
    getRoleTypeDescription,
    getRoleTypes,
    getShipmentMethod,
    getShipmentMethodDescription,
    getShipmentMethodDescriptions,
    getShipmentMethodOptions,
    getShipmentMethodTypes,
    getShippingMethodsByCarrier,
    getShopifyShop,
    getShopifyShopLocations,
    getShopifyShops,
    getStates,
    getStatesForCountry,
    getStatus,
    getStatusAge,
    getStatusAges,
    getStatusDescription,
    getStatusDescriptions,
    getStatusItemsByType,
  };
}
