import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The order page's lookups over seed tables: labels with raw-id fallbacks, row joins and the
 * status flow. The live query is replaced by one read of a
 * fixture database, so a getter answers once that read has landed.
 */
const fixture = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));

vi.mock("dexie", () => ({
  liveQuery: (querier: () => Promise<unknown>) => ({
    subscribe: ({ next }: { next: (value: any) => void }) => {
      querier().then(next);
      return { unsubscribe: () => undefined };
    },
  }),
}));

vi.mock("../db/storage/baseDb", () => ({ ensureDbReady: async () => undefined }));

vi.mock("../db/schema/appDbRegistry", () => ({
  getAppDb: () => ({
    raw: () => ({
      name: "TestDB",
      transaction: (_mode: string, _tables: string[], run: () => Promise<unknown>) => run(),
      table: (table: string) => ({ toArray: async () => fixture.tables[table] || [] }),
      syncMeta: { get: async () => ({ synced: true }) },
    }),
  }),
}));

import { clearSeedTables, seedData, useSeedData } from "../db/composables/useSeedData";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  clearSeedTables();
  fixture.tables = {
    facilities: [{ facilityId: "WH", facilityName: "Main Warehouse", facilityTypeId: "WAREHOUSE" }, { facilityId: "BARE" }],
    facilityTypes: [{ facilityTypeId: "WAREHOUSE", parentTypeId: "DISTRIBUTION_CENTER" }],
    statuses: [{ statusId: "ORDER_APPROVED", description: "Approved" }, { statusId: "ORDER_COMPLETED", description: "Completed" }],
    enums: [{ enumId: "SALES_CHANNEL_WEB", description: "Web" }],
    geos: [{ geoId: "CA", geoName: "California", geoTypeEnumId: "GEOT_STATE" }],
    carrierShipmentMethods: [{ partyId: "UPS", shipmentMethodTypeId: "STANDARD" }, { partyId: "FEDEX", shipmentMethodTypeId: "STANDARD" }],
    productStores: [{ productStoreId: "STORE", storeName: "Demo Store" }, { productStoreId: "CO", companyName: "Demo Co" }],
    orderAdjustmentTypes: [{ orderAdjustmentTypeId: "SALES_TAX", description: "Sales Tax" }],
    shopifyShops: [{ shopId: "SHOP", productStoreId: "STORE" }],
    statusFlowTransitions: [
      { statusFlowId: "Default", statusId: "ORDER_CREATED", toStatusId: "ORDER_COMPLETED", transitionSequence: 2 },
      { statusFlowId: "Default", statusId: "ORDER_CREATED", toStatusId: "ORDER_APPROVED", transitionSequence: 1 },
      { statusFlowId: "Default", statusId: "ORDER_CREATED", toStatusId: "ORDER_HELD" },
      { statusFlowId: "Default", statusId: "ORDER_APPROVED", toStatusId: "ORDER_COMPLETED" },
      // Another flow leaving the same status, as transfer orders' flows do.
      { statusFlowId: "TO_Fulfill_Only", statusId: "ORDER_CREATED", toStatusId: "ORDER_APPROVED" },
      { statusFlowId: "TO_Fulfill_Only", statusId: "ORDER_CREATED", toStatusId: "ORDER_PENDING_FULFILL" },
    ],
  };
  // Open every table the specs read, then let the reads land.
  const seed = useSeedData();
  seed.facility("WH"); seed.facilityType("WAREHOUSE"); seed.statusDescription("x"); seed.enumDescription("x");
  seed.geoName("x"); seed.shipmentMethodsByCarrier("x"); seed.productStoreName("x");
  seed.orderAdjustmentTypeDescription("x"); seed.shopifyShops(); seed.allowedTransitions("x");
  await flush();
});

describe("useSeedData order lookups", () => {
  it("answers the same through the plain seedData stores use", () => {
    expect(useSeedData().facilityName("WH")).toBe(seedData.facilityName("WH"));
  });

  it("labels rows by their table, falling back to the raw id", () => {
    expect(seedData.facilityName("WH")).toBe("Main Warehouse");
    expect(seedData.facilityName("BARE")).toBe("BARE");
    expect(seedData.productStoreName("STORE")).toBe("Demo Store");
    expect(seedData.productStoreName("CO")).toBe("Demo Co");
    expect(seedData.orderAdjustmentTypeDescription("SALES_TAX")).toBe("Sales Tax");
    expect(seedData.geoName("CA")).toBe("California");
    expect(seedData.geoName("MISSING")).toBe("MISSING");
    expect(seedData.geoName("")).toBe("");
  });

  it("joins a facility to its type", () => {
    expect(seedData.facilityType(seedData.facility("WH")?.facilityTypeId)?.parentTypeId).toBe("DISTRIBUTION_CENTER");
    expect(seedData.facility("MISSING")).toBeUndefined();
    expect(seedData.facility("")).toBeUndefined();
  });

  it("orders the transitions out of a status by sequence, unsequenced last, with descriptions", () => {
    expect(seedData.allowedTransitions("ORDER_CREATED").map((transition) => [transition.toStatusId, transition.toStatusDescription]))
      .toEqual([["ORDER_APPROVED", "Approved"], ["ORDER_COMPLETED", "Completed"], ["ORDER_HELD", "ORDER_HELD"]]);
    expect(seedData.allowedTransitions("NONE")).toEqual([]);
    expect(seedData.allowedTransitions("")).toEqual([]);
  });

  it("reads the Default flow unless another is named, keeping flows that reuse a status apart", () => {
    const targets = (statusFlowId?: string) =>
      seedData.allowedTransitions("ORDER_CREATED", statusFlowId).map((transition) => transition.toStatusId);
    expect(targets()).toEqual(["ORDER_APPROVED", "ORDER_COMPLETED", "ORDER_HELD"]);
    expect(targets("Default")).toEqual(targets());
    expect(targets("")).toEqual(targets());
    expect(targets("TO_Fulfill_Only")).toEqual(["ORDER_APPROVED", "ORDER_PENDING_FULFILL"]);
  });

  it("filters shipment methods by carrier and lists shops", () => {
    expect(seedData.shipmentMethodsByCarrier("UPS")).toEqual([{ partyId: "UPS", shipmentMethodTypeId: "STANDARD" }]);
    expect(seedData.shipmentMethodsByCarrier("")).toEqual([]);
    expect(seedData.shopifyShops().map((shop) => shop.shopId)).toEqual(["SHOP"]);
  });

  it("waits for a cold facility type table in its async getter", async () => {
    clearSeedTables();
    expect(seedData.facilityType("WAREHOUSE")).toBeUndefined();
    expect((await seedData.getFacilityTypes()).map((type) => type.facilityTypeId)).toEqual(["WAREHOUSE"]);
  });
});
