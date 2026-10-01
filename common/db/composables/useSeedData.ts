/**
 * Framework seed reference data lookups over the local database.
 *
 * Each seed table gets one live query per signed-in database, opened the first time any getter
 * needs it and kept for the session, so every caller shares one read. The query re-emits whenever
 * the table changes: the login sync filling it, a `refreshAfterMutation`, or a resync. There is no
 * init step: a table nobody asks for is never read.
 *
 * Two kinds of getter, told apart by name:
 *
 * - Reactive getters (no prefix: `statusDescription`, `enumsByType`, ...) are synchronous. They
 *   read the table's ref, so a template or `computed` calling them re-renders whenever the table
 *   changes. On a cold table they answer with the raw id or an empty list for that first render.
 * - Async getters (`get` prefix: `getFacilities`, ...) wait for the table's first read and return
 *   its current rows. They are kept for stores and for code that must act on the real rows, such
 *   as building a request from them.
 */

import { shallowRef, type ShallowRef } from "vue";
import type { Subscription } from "dexie";
import { getAppDb } from "../schema/appDbRegistry";

export type Row = Record<string, any>;

/** Seed ids on records are often optional; a missing id reads as no match. */
type Id = string | null | undefined;

interface SeedTable {
  rows: ShallowRef<Row[]>;
  /** Settles on the first emission, so async getters can wait for a cold table. */
  loaded: Promise<void>;
  /** Kept only so logout can close it. */
  subscription: Subscription;
}

/**
 * Live tables, keyed by database name and table. At most one entry per seed table: an entry is
 * created on first use and lives until logout, so a long session never adds subscriptions.
 */
const tables = new Map<string, SeedTable>();

/** Close every live table. Called when sync stops on logout, which wipes the database. */
export function clearSeedTables(): void {
  tables.forEach((entry) => entry.subscription.unsubscribe());
  tables.clear();
}

/** Test-only: how many tables are live. */
export function __seedTableCount(): number {
  return tables.size;
}

/** The table's live entry, opening its query on first use. Undefined when no database is signed in. */
function seedTable(table: string): SeedTable | undefined {
  let key: string;
  try {
    key = `${getAppDb().raw().name}/${table}`;
  } catch {
    return undefined;
  }

  let entry = tables.get(key);
  if (!entry) {
    const rows = shallowRef<Row[]>([]);
    let settle!: () => void;
    const loaded = new Promise<void>((resolve) => { settle = resolve; });

    const subscription = getAppDb().client().entity(table).live({}).subscribe({
      next: (all) => {
        rows.value = all;
        settle();
      },
      error: (error) => {
        console.warn(`[seed] Live read of ${table} failed:`, error);
        // A failed query has closed itself; the next use opens a fresh one.
        tables.delete(key);
        settle();
      },
    });

    entry = { rows, loaded, subscription };
    tables.set(key, entry);
  }
  return entry;
}

/** Reactive: the table's rows, empty until its first read lands. */
function rowsOf(table: string): Row[] {
  return seedTable(table)?.rows.value ?? [];
}

/** Async: the table's current rows, once its first read has landed. */
async function loadRows(table: string): Promise<Row[]> {
  const entry = seedTable(table);
  if (!entry) return [];
  await entry.loaded;
  return entry.rows.value;
}

/** Rows by primary key, built once per loaded array. */
const indexes = new WeakMap<Row[], Map<string, Row>>();

function byKey(rows: Row[], keyField: string): Map<string, Row> {
  let index = indexes.get(rows);
  if (!index) {
    index = new Map(rows.map((record) => [record[keyField], record]));
    indexes.set(rows, index);
  }
  return index;
}

const DEFAULT_LABEL_FIELDS = ["description", "enumName", "name", "groupName", "facilityName", "storeName"];

/** First non-empty value among `fields`, else the raw id. */
function labelOf(record: Row | undefined, id: string, fields = DEFAULT_LABEL_FIELDS): string {
  return (fields.map((field) => record?.[field]).find(Boolean) as string) || id;
}

/** Reactive: one label by primary key. */
function label(table: string, keyField: string, id: Id, fields?: string[]): string {
  if (!id) return "";
  return labelOf(byKey(rowsOf(table), keyField).get(id), id, fields);
}

const byGeoName = (left: Row, right: Row) => (left.geoName || "").localeCompare(right.geoName || "");

/** A country's states and provinces: its `GAT_REGIONS` links only, not group memberships like DBIC. */
function statesIn(geos: Row[], geoAssocs: Row[], countryGeoId: Id): Row[] {
  if (!countryGeoId) return [];
  const stateIds = new Set(geoAssocs
    .filter((assoc) => assoc.geoId === countryGeoId && assoc.geoAssocTypeEnumId === "GAT_REGIONS")
    .map((assoc) => assoc.toGeoId));
  return geos.filter((geo) => stateIds.has(geo.geoId)).sort(byGeoName);
}

const carrierLabel = (carrier: Row) =>
  [carrier.firstName, carrier.lastName].filter(Boolean).join(" ") || carrier.groupName || carrier.partyId;

const SHIPMENT_METHOD_LABEL_FIELDS = ["description", "shipmentMethodTypeId"];
const FACILITY_LABEL_FIELDS = ["facilityName", "facilityId"];

/**
 * The seed lookup API: `const seed = useSeedData()`, then `seed.statusDescription(id)` in a
 * template or computed, or `await seed.getFacilities()` where the rows must be in hand.
 */
export function useSeedData() {
  // ── Reactive getters ──────────────────────────────────────────────────────────────────

  // Whole tables, for pickers and for callers that build their own maps.
  const statuses = () => rowsOf("statuses");
  const enums = () => rowsOf("enums");
  const enumTypes = () => rowsOf("enumTypes");
  const geos = () => rowsOf("geos");
  const shipmentMethodTypes = () => rowsOf("shipmentMethodTypes");
  const paymentMethodTypes = () => rowsOf("paymentMethodTypes");
  const roleTypes = () => rowsOf("roleTypes");
  const partyRelationshipTypes = () => rowsOf("partyRelationshipTypes");

  const statusDescription = (statusId: Id) => label("statuses", "statusId", statusId);
  const statusItemsByType = (statusTypeId: string) =>
    rowsOf("statuses").filter((record) => record.statusTypeId === statusTypeId);

  const enumDescription = (enumId: Id) => label("enums", "enumId", enumId);
  const enumsByType = (enumTypeId: string) => rowsOf("enums").filter((record) => record.enumTypeId === enumTypeId);

  function enumsByParentType(parentTypeId: string): Row[] {
    const childTypeIds = new Set(
      rowsOf("enumTypes").filter((type) => type.parentTypeId === parentTypeId).map((type) => type.enumTypeId),
    );
    return rowsOf("enums").filter((record) => childTypeIds.has(record.enumTypeId));
  }

  const orderIdentificationTypeOptions = () =>
    enumsByType("ORDER_IDENTITY").map((record) => ({ enumId: record.enumId, description: labelOf(record, record.enumId) }));

  const facilityName = (facilityId: Id) => label("facilities", "facilityId", facilityId, FACILITY_LABEL_FIELDS);

  const productStoreFacilities = (productStoreId: Id) =>
    productStoreId ? rowsOf("productStoreFacilities").filter((record) => record.productStoreId === productStoreId) : [];

  const carriers = () => rowsOf("carriers");
  function carrierName(partyId: Id): string {
    if (!partyId) return "";
    const found = byKey(rowsOf("carriers"), "partyId").get(partyId);
    return found ? carrierLabel(found) : partyId;
  }

  const shipmentMethodDescription = (shipmentMethodTypeId: Id) =>
    label("shipmentMethodTypes", "shipmentMethodTypeId", shipmentMethodTypeId, SHIPMENT_METHOD_LABEL_FIELDS);
  const shipmentMethodOptions = () => rowsOf("shipmentMethodTypes").map((record) => ({
    id: record.shipmentMethodTypeId as string,
    label: labelOf(record, record.shipmentMethodTypeId, SHIPMENT_METHOD_LABEL_FIELDS),
  }));

  const paymentMethodDescription = (id: Id) => label("paymentMethodTypes", "paymentMethodTypeId", id);
  const returnReasonDescription = (id: Id) => label("returnReasons", "returnReasonId", id);
  const returnTypeDescription = (id: Id) => label("returnTypes", "returnTypeId", id);
  const returnItemTypeDescription = (id: Id) => label("returnItemTypes", "returnItemTypeId", id);
  const contactPurposeDescription = (id: Id) => label("contactMechPurposeTypes", "contactMechPurposeTypeId", id);
  const communicationEventTypeDescription = (id: Id) =>
    label("communicationEventTypes", "communicationEventTypeId", id);
  const partyRelationshipDescription = (id: Id) =>
    label("partyRelationshipTypes", "partyRelationshipTypeId", id, ["description", "partyRelationshipName"]);

  const shopifyShopLocations = () => rowsOf("shopifyShopLocations");

  const countries = () => rowsOf("geos").filter((geo) => geo.geoTypeEnumId === "GEOT_COUNTRY").sort(byGeoName);
  const states = () => rowsOf("geos")
    .filter((geo) => geo.geoTypeEnumId === "GEOT_STATE" || geo.geoTypeEnumId === "GEOT_PROVINCE")
    .sort(byGeoName);
  const statesForCountry = (countryGeoId: Id) => statesIn(rowsOf("geos"), rowsOf("geoAssocs"), countryGeoId);

  /** Countries in the DBIC association group. */
  function dbicCountries(): Row[] {
    const geoById = byKey(rowsOf("geos"), "geoId");
    return rowsOf("geoAssocs")
      .filter((assoc) => assoc.toGeoId === "DBIC")
      .map((assoc) => geoById.get(assoc.geoId) ?? { geoId: assoc.geoId });
  }

  // ── Async getters ─────────────────────────────────────────────────────────────────────

  const getProductStores = () => loadRows("productStores");
  const getFacilities = () => loadRows("facilities");
  const getGeos = () => loadRows("geos");
  const getPaymentMethodTypes = () => loadRows("paymentMethodTypes");

  async function getEnumsByType(enumTypeId: string): Promise<Row[]> {
    return (await loadRows("enums")).filter((record) => record.enumTypeId === enumTypeId);
  }

  async function getProductStoreFacilities(productStoreId: string): Promise<Row[]> {
    if (!productStoreId) return [];
    return (await loadRows("productStoreFacilities")).filter((record) => record.productStoreId === productStoreId);
  }

  async function getFacilityParentTypeIds(facilityTypeIds: readonly string[]): Promise<Record<string, string>> {
    const index = byKey(await loadRows("facilityTypes"), "facilityTypeId");
    const wanted = [...new Set(facilityTypeIds.filter(Boolean))];
    return Object.fromEntries(wanted.map((id) => [id, index.get(id)?.parentTypeId ?? ""]));
  }

  async function getStatesForCountry(countryGeoId: string): Promise<Row[]> {
    if (!countryGeoId) return [];
    const [geos, geoAssocs] = await Promise.all([loadRows("geos"), loadRows("geoAssocs")]);
    return statesIn(geos, geoAssocs, countryGeoId);
  }

  return {
    carrierName,
    carriers,
    communicationEventTypeDescription,
    contactPurposeDescription,
    countries,
    dbicCountries,
    enumDescription,
    enumTypes,
    enums,
    enumsByParentType,
    enumsByType,
    facilityName,
    geos,
    orderIdentificationTypeOptions,
    partyRelationshipDescription,
    partyRelationshipTypes,
    paymentMethodDescription,
    paymentMethodTypes,
    productStoreFacilities,
    returnItemTypeDescription,
    returnReasonDescription,
    returnTypeDescription,
    roleTypes,
    shipmentMethodDescription,
    shipmentMethodOptions,
    shipmentMethodTypes,
    shopifyShopLocations,
    states,
    statesForCountry,
    statusDescription,
    statusItemsByType,
    statuses,

    getFacilities,
    getEnumsByType,
    getFacilityParentTypeIds,
    getGeos,
    getPaymentMethodTypes,
    getProductStoreFacilities,
    getProductStores,
    getStatesForCountry,
  };
}
