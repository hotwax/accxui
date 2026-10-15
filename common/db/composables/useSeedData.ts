/**
 * Framework seed reference data lookups over the local database: labels, option lists and joined
 * lookups (`statusDescription`, `enumsByType`, `statesForCountry`, ...), with every lookup rule
 * kept here so callers never repeat one.
 *
 * Two ways in, with the same getters:
 *
 * - `useSeedData()`, during setup. The first call in a component tree opens the live reads and
 *   provides them; every component below it (a page's cards, rows, segments) injects the same
 *   instance. Each table is opened through `useLiveEntity` the first time a getter needs it and
 *   closes when the providing component unmounts, so a page with 200 cards still holds one query
 *   per table. Never call it in `App.vue` or a layout: everything would inject that one instance,
 *   for the whole session (lint rejects it in `App.vue`).
 * - `await loadSeedData()`, outside components (stores, services, utils). A one-shot snapshot of
 *   the seed tables, read in one transaction. It does not follow later changes: read it again
 *   when the rows must be current.
 *
 * Kinds of getter, told apart by name:
 *
 * - Reactive getters (no prefix: `statusDescription`, `enumsByType`, ...) are synchronous. From
 *   `useSeedData()` they read the table's live rows, so a template or `computed` calling them
 *   re-renders whenever the table changes; on a cold table they answer with the raw id or an empty
 *   list for that first render. List getters also offer `.withSync(...)`, which answers
 *   `{ data, synced }`: `synced` turns true once the tables behind the getter hold this login's
 *   sync, so an empty `data` is real.
 * - Async getters (`get` prefix: `getFacilities`, ...) read the table's current rows once.
 */

import { getCurrentInstance, getCurrentScope, inject, provide, type EffectScope, type InjectionKey } from "vue";
import { getAppDb } from "../schema/appDbRegistry";
import { commonDomainsByTable } from "../seed/seedDomains";
import { loginMarkerKey } from "../storage/baseDb";
import { type DbListResult, useLiveEntity } from "./useLiveEntity";

export type Row = Record<string, any>;

/** Seed ids on records are often optional; a missing id reads as no match. */
type Id = string | null | undefined;

/** Every table the seed getters read. */
export const SEED_TABLES = [
  "carrierShipmentMethods", "carriers", "communicationEventTypes", "contactMechPurposeTypes", "enumTypes",
  "enums", "facilities", "facilityTypes", "geoAssocs", "geos", "orderAdjustmentTypes", "partyRelationshipTypes",
  "paymentMethodTypes", "productStoreFacilities", "productStores", "returnItemTypes", "returnReasons",
  "returnTypes", "roleTypes", "shipmentMethodTypes", "shopifyShopLocations", "shopifyShops",
  "statusFlowTransitions", "statuses",
] as const;

export type SeedTable = (typeof SEED_TABLES)[number];

/** Where the getters' rows come from: live reads for a component tree, or a one-shot snapshot. */
interface SeedSource {
  /** The table's rows; reactive for live reads. */
  rows(table: string): Row[];
  /** Whether `rows` were read after the table's sync landed this login. */
  synced(table: string): boolean;
  /** The table's current rows, read once. */
  load(table: string): Promise<Row[]>;
}

/** The app database's client, or undefined when none is signed in. */
function appClient() {
  try {
    const client = getAppDb().client();
    client.name();
    return client;
  } catch {
    return undefined;
  }
}

/** Whether the signed-in database has `table`; an app may not keep every seed table. */
function hasTable(table: string): boolean {
  try {
    return appClient()?.tableNames().includes(table) ?? false;
  } catch {
    return false;
  }
}

/** One read of a table's current rows; empty when no database is signed in or it has no such table. */
async function readTable(table: string): Promise<Row[]> {
  const client = appClient();
  if (!client || !hasTable(table)) return [];
  return client.entity<Row>(table).all();
}

/**
 * Live reads for one component tree. A table opens through `useLiveEntity` the first time a getter
 * needs it, usually from a template during render, so it is opened inside the scope captured at
 * setup: it closes when that scope does. Its seed domain's login marker is read with the rows,
 * which is what `synced` reports; a table no seed domain fills reports `useLiveEntity`'s `hydrated`.
 */
function liveSource(scope: EffectScope): SeedSource {
  const opened = new Map<string, DbListResult<Row>>();

  function live(table: string): DbListResult<Row> | undefined {
    let entry = opened.get(table);
    if (!entry) {
      if (!hasTable(table)) return undefined;
      // Undefined once the scope has stopped (a getter called after unmount): nothing to open.
      entry = scope.run(() => useLiveEntity<Row>(table, { syncDomain: commonDomainsByTable[table]?.name }));
      if (!entry) return undefined;
      opened.set(table, entry);
    }
    return entry;
  }

  return {
    rows: (table) => live(table)?.records.value ?? [],
    synced: (table) => live(table)?.synced.value ?? false,
    load: readTable,
  };
}

/** A snapshot's rows and login markers, read once in one transaction. */
function snapshotSource(read: Map<string, { rows: Row[]; synced: boolean }>, tables: ReadonlySet<string>): SeedSource {
  const entryOf = (table: string) => {
    if (!tables.has(table)) {
      throw new Error(`[seed] "${table}" is not in this snapshot: add it to loadSeedData([...]).`);
    }
    return read.get(table);
  };
  return {
    rows: (table) => entryOf(table)?.rows ?? [],
    synced: (table) => entryOf(table)?.synced ?? false,
    load: readTable,
  };
}

/**
 * A one-shot snapshot of the seed tables, for stores, services and utils, which cannot hold a live
 * read. All of `tables` (by default every seed table) and their login markers are read in ONE
 * transaction, so `.withSync()` on it is as reliable as on the live getters. The getters are the
 * same as `useSeedData()`'s, but they answer from this read and never change: read again when the
 * rows must be current. A getter over a table not in `tables` throws, naming it.
 */
export async function loadSeedData(tables: readonly SeedTable[] = SEED_TABLES): Promise<SeedData> {
  const requested = new Set<string>(tables);
  const client = appClient();
  const present = client ? [...requested].filter(hasTable) : [];
  const read = new Map<string, { rows: Row[]; synced: boolean }>();
  if (client && present.length) {
    const entries = await client.read([...present, "syncMeta"], (tx) => Promise.all(present.map((table) => {
      const domain = commonDomainsByTable[table]?.name;
      return Promise.all([
        tx.entity<Row>(table).all(),
        // A table no seed domain fills has nothing to wait for.
        domain ? tx.entity("syncMeta").get(loginMarkerKey(domain)) : { synced: true },
      ]).then(([rows, marker]) => [table, { rows, synced: Boolean(marker?.synced) }] as const);
    })));
    entries.forEach(([table, entry]) => read.set(table, entry));
  }
  return createSeedLookups(snapshotSource(read, requested));
}

/**
 * Getters over no rows: labels answer the raw id, lists are empty and nothing is synced. For a store
 * getter that runs before its `loadSeedData()` snapshot has been read, as a cold table answers.
 */
export const emptySeedData: SeedData = createSeedLookups(snapshotSource(new Map(), new Set(SEED_TABLES)));

const SEED_KEY: InjectionKey<SeedData> = Symbol("seedData");

/** The instance each component created, so a second call in the same setup reuses it. */
const ownByInstance = new WeakMap<object, SeedData>();

/**
 * The seed lookup API for components and composables: `const seed = useSeedData()` during setup,
 * then `seed.statusDescription(id)` in a template or `computed`. Shares the nearest ancestor's
 * instance when there is one; otherwise opens this component's own and provides it to its
 * descendants. Outside setup use `await loadSeedData()`.
 */
export function useSeedData(): SeedData {
  const scope = getCurrentScope();
  if (!scope) {
    throw new Error("[seed] useSeedData() only works during setup (components, views, composables). Outside them, use await loadSeedData().");
  }
  const instance = getCurrentInstance();
  if (instance) {
    const shared = ownByInstance.get(instance) ?? inject(SEED_KEY, null);
    if (shared) return shared;
  }
  const seed = createSeedLookups(liveSource(scope));
  if (instance) {
    provide(SEED_KEY, seed);
    ownByInstance.set(instance, seed);
  }
  return seed;
}

/** A list getter's result together with whether the tables it reads have synced this login. */
export interface WithSync<T> {
  data: T;
  synced: boolean;
}

/**
 * A reactive list getter. Call it for the list; call `.withSync(...)` with the same arguments
 * where an empty list drives a decision ("this country has no states"), since until `synced` is
 * true, empty may only mean the background sync has not landed yet.
 */
export type ListGetter<Args extends unknown[], T> = ((...args: Args) => T) & {
  withSync: (...args: Args) => WithSync<T>;
};

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
const PRODUCT_STORE_LABEL_FIELDS = ["storeName", "companyName"];

/** The status flow OMS validates an order against when the order names none. */
const DEFAULT_STATUS_FLOW_ID = "Default";

/** Authored sequence first, unsequenced transitions last, then by target status. */
const byTransitionSequence = (left: Row, right: Row) => {
  const leftSequence = left.transitionSequence ?? Number.MAX_SAFE_INTEGER;
  const rightSequence = right.transitionSequence ?? Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  return (left.toStatusId || "").localeCompare(right.toStatusId || "");
};

/** The getters over a source of rows. Every lookup rule lives here, once. */
function createSeedLookups(source: SeedSource) {
  const rowsOf = (table: string): Row[] => source.rows(table);
  const loadRows = (table: string): Promise<Row[]> => source.load(table);

  /** Declares the tables a list getter reads, once, so callers never name them. */
  function listGetter<Args extends unknown[], T>(tables: string[], read: (...args: Args) => T): ListGetter<Args, T> {
    return Object.assign(read, {
      withSync: (...args: Args): WithSync<T> => ({ data: read(...args), synced: tables.every((table) => source.synced(table)) }),
    });
  }

  /** One row by primary key. */
  function row(table: string, keyField: string, id: Id): Row | undefined {
    return id ? byKey(rowsOf(table), keyField).get(id) : undefined;
  }

  /** One label by primary key. */
  function label(table: string, keyField: string, id: Id, fields?: string[]): string {
    if (!id) return "";
    return labelOf(row(table, keyField, id), id, fields);
  }

  // ── Reactive getters ──────────────────────────────────────────────────────────────────

  // List getters are built with `listGetter`, so each also offers `.withSync(...)`. Label getters
  // are not: a missing row already answers with the raw id.

  // Whole tables, for pickers and for callers that build their own maps.
  const statuses = listGetter(["statuses"], () => rowsOf("statuses"));
  const enums = listGetter(["enums"], () => rowsOf("enums"));
  const enumTypes = listGetter(["enumTypes"], () => rowsOf("enumTypes"));
  const geos = listGetter(["geos"], () => rowsOf("geos"));
  const shipmentMethodTypes = listGetter(["shipmentMethodTypes"], () => rowsOf("shipmentMethodTypes"));
  const paymentMethodTypes = listGetter(["paymentMethodTypes"], () => rowsOf("paymentMethodTypes"));
  const roleTypes = listGetter(["roleTypes"], () => rowsOf("roleTypes"));
  const partyRelationshipTypes = listGetter(["partyRelationshipTypes"], () => rowsOf("partyRelationshipTypes"));

  const statusDescription = (statusId: Id) => label("statuses", "statusId", statusId);
  const statusItemsByType = listGetter(["statuses"], (statusTypeId: string) =>
    rowsOf("statuses").filter((record) => record.statusTypeId === statusTypeId));

  const enumDescription = (enumId: Id) => label("enums", "enumId", enumId);
  const enumsByType = listGetter(["enums"], (enumTypeId: string) =>
    rowsOf("enums").filter((record) => record.enumTypeId === enumTypeId));

  const enumsByParentType = listGetter(["enumTypes", "enums"], (parentTypeId: string): Row[] => {
    const childTypeIds = new Set(
      rowsOf("enumTypes").filter((type) => type.parentTypeId === parentTypeId).map((type) => type.enumTypeId),
    );
    return rowsOf("enums").filter((record) => childTypeIds.has(record.enumTypeId));
  });

  const orderIdentificationTypeOptions = listGetter(["enums"], () =>
    enumsByType("ORDER_IDENTITY").map((record) => ({ enumId: record.enumId, description: labelOf(record, record.enumId) })));

  const facilities = listGetter(["facilities"], () => rowsOf("facilities"));
  const facilityTypes = listGetter(["facilityTypes"], () => rowsOf("facilityTypes"));
  const facility = (facilityId: Id) => row("facilities", "facilityId", facilityId);
  const facilityType = (facilityTypeId: Id) => row("facilityTypes", "facilityTypeId", facilityTypeId);
  const facilityName = (facilityId: Id) => label("facilities", "facilityId", facilityId, FACILITY_LABEL_FIELDS);

  const productStoreName = (productStoreId: Id) =>
    label("productStores", "productStoreId", productStoreId, PRODUCT_STORE_LABEL_FIELDS);

  const productStoreFacilities = listGetter(["productStoreFacilities"], (productStoreId: Id) =>
    productStoreId ? rowsOf("productStoreFacilities").filter((record) => record.productStoreId === productStoreId) : []);

  const carriers = listGetter(["carriers"], () => rowsOf("carriers"));
  function carrierName(partyId: Id): string {
    if (!partyId) return "";
    const found = byKey(rowsOf("carriers"), "partyId").get(partyId);
    return found ? carrierLabel(found) : partyId;
  }

  const shipmentMethodDescription = (shipmentMethodTypeId: Id) =>
    label("shipmentMethodTypes", "shipmentMethodTypeId", shipmentMethodTypeId, SHIPMENT_METHOD_LABEL_FIELDS);
  const shipmentMethodsByCarrier = listGetter(["carrierShipmentMethods"], (carrierPartyId: Id) =>
    carrierPartyId ? rowsOf("carrierShipmentMethods").filter((method) => method.partyId === carrierPartyId) : []);
  const shipmentMethodOptions = listGetter(["shipmentMethodTypes"], () => rowsOf("shipmentMethodTypes").map((record) => ({
    id: record.shipmentMethodTypeId as string,
    label: labelOf(record, record.shipmentMethodTypeId, SHIPMENT_METHOD_LABEL_FIELDS),
  })));

  const paymentMethodDescription = (id: Id) => label("paymentMethodTypes", "paymentMethodTypeId", id);
  const returnReasonDescription = (id: Id) => label("returnReasons", "returnReasonId", id);
  const returnTypeDescription = (id: Id) => label("returnTypes", "returnTypeId", id);
  const returnItemTypeDescription = (id: Id) => label("returnItemTypes", "returnItemTypeId", id);
  const contactPurposeDescription = (id: Id) => label("contactMechPurposeTypes", "contactMechPurposeTypeId", id);
  const communicationEventTypeDescription = (id: Id) =>
    label("communicationEventTypes", "communicationEventTypeId", id);
  const partyRelationshipDescription = (id: Id) =>
    label("partyRelationshipTypes", "partyRelationshipTypeId", id, ["description", "partyRelationshipName"]);
  const orderAdjustmentTypeDescription = (id: Id) => label("orderAdjustmentTypes", "orderAdjustmentTypeId", id);

  /**
   * The transitions out of `statusId` in one status flow, in their authored sequence. Flows reuse
   * status ids (a transfer order's flow also leaves ITEM_CREATED), so only one flow is read: the
   * `Default` flow unless `statusFlowId` names another, as OMS validates an order without one.
   */
  const allowedTransitions = listGetter(["statusFlowTransitions", "statuses"], (statusId: Id, statusFlowId?: Id) => {
    const flowId = statusFlowId || DEFAULT_STATUS_FLOW_ID;
    if (!statusId) return [];
    return rowsOf("statusFlowTransitions")
      .filter((transition) => transition.statusFlowId === flowId && transition.statusId === statusId)
      .map((transition) => ({ ...transition, toStatusDescription: statusDescription(transition.toStatusId) }))
      .sort(byTransitionSequence);
  });

  const shopifyShops = listGetter(["shopifyShops"], () => rowsOf("shopifyShops"));

  const shopifyShopLocations = listGetter(["shopifyShopLocations"], () => rowsOf("shopifyShopLocations"));

  const geoName = (geoId: Id) => label("geos", "geoId", geoId, ["geoName"]);
  const countries = listGetter(["geos"], () =>
    rowsOf("geos").filter((geo) => geo.geoTypeEnumId === "GEOT_COUNTRY").sort(byGeoName));
  const states = listGetter(["geos"], () => rowsOf("geos")
    .filter((geo) => geo.geoTypeEnumId === "GEOT_STATE" || geo.geoTypeEnumId === "GEOT_PROVINCE")
    .sort(byGeoName));
  const statesForCountry = listGetter(["geos", "geoAssocs"], (countryGeoId: Id) =>
    statesIn(rowsOf("geos"), rowsOf("geoAssocs"), countryGeoId));

  /** Countries in the DBIC association group. */
  const dbicCountries = listGetter(["geos", "geoAssocs"], (): Row[] => {
    const geoById = byKey(rowsOf("geos"), "geoId");
    return rowsOf("geoAssocs")
      .filter((assoc) => assoc.toGeoId === "DBIC")
      .map((assoc) => geoById.get(assoc.geoId) ?? { geoId: assoc.geoId });
  });

  // ── Async getters ─────────────────────────────────────────────────────────────────────

  const getProductStores = () => loadRows("productStores");
  const getFacilities = () => loadRows("facilities");
  const getFacilityTypes = () => loadRows("facilityTypes");
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
    allowedTransitions,
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
    facilities,
    facility,
    facilityName,
    facilityType,
    facilityTypes,
    geoName,
    geos,
    orderAdjustmentTypeDescription,
    orderIdentificationTypeOptions,
    partyRelationshipDescription,
    partyRelationshipTypes,
    paymentMethodDescription,
    paymentMethodTypes,
    productStoreFacilities,
    productStoreName,
    returnItemTypeDescription,
    returnReasonDescription,
    returnTypeDescription,
    roleTypes,
    shipmentMethodDescription,
    shipmentMethodOptions,
    shipmentMethodsByCarrier,
    shipmentMethodTypes,
    shopifyShopLocations,
    shopifyShops,
    states,
    statesForCountry,
    statusDescription,
    statusItemsByType,
    statuses,

    getFacilities,
    getEnumsByType,
    getFacilityParentTypeIds,
    getFacilityTypes,
    getGeos,
    getPaymentMethodTypes,
    getProductStoreFacilities,
    getProductStores,
    getStatesForCountry,
  };
}

export type SeedData = ReturnType<typeof createSeedLookups>;
