// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, effectScope, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";

/**
 * Seed lookups over a fixture database: labels with raw-id fallbacks, row joins and the status
 * flow, answered by the one-shot snapshot stores use and by the live reads a component tree shares.
 */
const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  /** Domains whose login marker is present. */
  synced: new Set<string>(),
  /** Live reads opened and closed, by table. */
  opened: [] as string[],
  closed: [] as string[],
}));

vi.mock("../db/schema/appDbRegistry", () => {
  const tx = {
    entity: (table: string) => ({
      all: async () => fixture.tables[table] || [],
      query: async () => fixture.tables[table] || [],
      get: async (key: string) => (fixture.synced.has(key.replace("loginSync:", "")) ? { synced: true } : undefined),
    }),
  };
  const client = {
    name: () => "TestDB",
    tableNames: () => [...Object.keys(fixture.tables), "syncMeta"],
    entity: (table: string) => ({
      all: async () => fixture.tables[table] || [],
      live: () => ({
        subscribe: ({ next }: any) => {
          fixture.opened.push(table);
          Promise.resolve(fixture.tables[table] || []).then(next);
          return { unsubscribe: () => fixture.closed.push(table) };
        },
      }),
    }),
    liveRead: (tables: string[], read: (reader: typeof tx) => Promise<unknown>) => ({
      subscribe: ({ next }: any) => {
        fixture.opened.push(tables[0]);
        read(tx).then(next);
        return { unsubscribe: () => fixture.closed.push(tables[0]) };
      },
    }),
    read: (_tables: string[], read: (reader: typeof tx) => Promise<unknown>) => read(tx),
  };
  return { getAppDb: () => ({ client: () => client }) };
});

import { emptySeedData, loadSeedData, useSeedData, type SeedData } from "../db/composables/useSeedData";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fixture.opened = [];
  fixture.closed = [];
  fixture.synced = new Set(["status", "geo", "geoAssoc"]);
  fixture.tables = {
    facilities: [{ facilityId: "WH", facilityName: "Main Warehouse", facilityTypeId: "WAREHOUSE" }, { facilityId: "BARE" }],
    facilityTypes: [{ facilityTypeId: "WAREHOUSE", parentTypeId: "DISTRIBUTION_CENTER" }],
    statuses: [{ statusId: "ORDER_APPROVED", description: "Approved" }, { statusId: "ORDER_COMPLETED", description: "Completed" }],
    enums: [{ enumId: "SALES_CHANNEL_WEB", description: "Web" }],
    geos: [{ geoId: "CA", geoName: "California", geoTypeEnumId: "GEOT_STATE" }],
    geoAssocs: [],
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
});

describe("seed lookups (loadSeedData snapshot)", () => {
  let seed: SeedData;
  beforeEach(async () => {
    seed = await loadSeedData();
  });

  it("labels rows by their table, falling back to the raw id", () => {
    expect(seed.facilityName("WH")).toBe("Main Warehouse");
    expect(seed.facilityName("BARE")).toBe("BARE");
    expect(seed.productStoreName("STORE")).toBe("Demo Store");
    expect(seed.productStoreName("CO")).toBe("Demo Co");
    expect(seed.orderAdjustmentTypeDescription("SALES_TAX")).toBe("Sales Tax");
    expect(seed.geoName("CA")).toBe("California");
    expect(seed.geoName("MISSING")).toBe("MISSING");
    expect(seed.geoName("")).toBe("");
  });

  it("joins a facility to its type", () => {
    expect(seed.facilityType(seed.facility("WH")?.facilityTypeId)?.parentTypeId).toBe("DISTRIBUTION_CENTER");
    expect(seed.facility("MISSING")).toBeUndefined();
    expect(seed.facility("")).toBeUndefined();
  });

  it("orders the transitions out of a status by sequence, unsequenced last, with descriptions", () => {
    expect(seed.allowedTransitions("ORDER_CREATED").map((transition) => [transition.toStatusId, transition.toStatusDescription]))
      .toEqual([["ORDER_APPROVED", "Approved"], ["ORDER_COMPLETED", "Completed"], ["ORDER_HELD", "ORDER_HELD"]]);
    expect(seed.allowedTransitions("NONE")).toEqual([]);
    expect(seed.allowedTransitions("")).toEqual([]);
  });

  it("reads the Default flow unless another is named, keeping flows that reuse a status apart", () => {
    const targets = (statusFlowId?: string) =>
      seed.allowedTransitions("ORDER_CREATED", statusFlowId).map((transition) => transition.toStatusId);
    expect(targets()).toEqual(["ORDER_APPROVED", "ORDER_COMPLETED", "ORDER_HELD"]);
    expect(targets("Default")).toEqual(targets());
    expect(targets("")).toEqual(targets());
    expect(targets("TO_Fulfill_Only")).toEqual(["ORDER_APPROVED", "ORDER_PENDING_FULFILL"]);
  });

  it("filters shipment methods by carrier and lists shops", () => {
    expect(seed.shipmentMethodsByCarrier("UPS")).toEqual([{ partyId: "UPS", shipmentMethodTypeId: "STANDARD" }]);
    expect(seed.shipmentMethodsByCarrier("")).toEqual([]);
    expect(seed.shopifyShops().map((shop) => shop.shopId)).toEqual(["SHOP"]);
  });

  it("reports synced from the login markers read with the rows", () => {
    expect(seed.statuses.withSync()).toEqual({ data: fixture.tables.statuses, synced: true });
    expect(seed.statesForCountry.withSync("US").synced).toBe(true);
    expect(seed.enums.withSync().synced).toBe(false);
  });

  it("answers an app without a seed table with nothing, not an error", () => {
    expect(seed.returnReasonDescription("DAMAGED")).toBe("DAMAGED");
    expect(seed.carriers()).toEqual([]);
  });

  it("throws on a table left out of a narrowed snapshot, naming it", async () => {
    const narrow = await loadSeedData(["facilities"]);
    expect(narrow.facilityName("WH")).toBe("Main Warehouse");
    expect(() => narrow.statusDescription("ORDER_APPROVED")).toThrow(/"statuses" is not in this snapshot/);
  });

  it("reads a table once in its async getter", async () => {
    expect((await seed.getFacilityTypes()).map((type) => type.facilityTypeId)).toEqual(["WAREHOUSE"]);
  });
});

describe("emptySeedData", () => {
  it("answers raw ids and empty, unsynced lists, as a cold table does", () => {
    expect(emptySeedData.statusDescription("ORDER_APPROVED")).toBe("ORDER_APPROVED");
    expect(emptySeedData.facility("WH")).toBeUndefined();
    expect(emptySeedData.enums.withSync()).toEqual({ data: [], synced: false });
  });
});

describe("useSeedData (live, per component tree)", () => {
  it("only works during setup", () => {
    expect(() => useSeedData()).toThrow(/only works during setup/);
  });

  it("opens a table on first use, re-renders when it lands, and answers like the snapshot", async () => {
    const scope = effectScope();
    const seed = scope.run(() => useSeedData())!;
    expect(fixture.opened).toEqual([]);
    expect(seed.statusDescription("ORDER_APPROVED")).toBe("ORDER_APPROVED");
    await flush();
    expect(seed.statusDescription("ORDER_APPROVED")).toBe("Approved");
    expect(seed.statuses.withSync().synced).toBe(true);
    expect(fixture.opened).toEqual(["statuses"]);
    scope.stop();
    expect(fixture.closed).toEqual(["statuses"]);
  });

  it("shares one read per table across a page and its cards, closing it when the page unmounts", async () => {
    const Card = defineComponent({
      props: { statusId: { type: String, required: true } },
      setup(props) {
        const seed = useSeedData();
        return () => h("li", seed.statusDescription(props.statusId));
      },
    });
    const Page = defineComponent({
      setup() {
        const seed = useSeedData();
        return () => h("ul", { title: seed.facilityName("WH") }, ["ORDER_APPROVED", "ORDER_COMPLETED", "ORDER_APPROVED"]
          .map((statusId) => h(Card, { statusId })));
      },
    });

    const page = mount(Page);
    await flush();
    await nextTick();
    expect(page.findAll("li").map((item) => item.text())).toEqual(["Approved", "Completed", "Approved"]);
    expect(page.find("ul").attributes("title")).toBe("Main Warehouse");
    expect([...fixture.opened].sort()).toEqual(["facilities", "statuses"]);

    page.unmount();
    expect([...fixture.closed].sort()).toEqual(["facilities", "statuses"]);
  });

  it("reuses the instance on a second call in the same setup", () => {
    let calls: SeedData[] = [];
    mount(defineComponent({
      setup() {
        calls = [useSeedData(), useSeedData()];
        return () => h("div");
      },
    }));
    expect(calls[0]).toBe(calls[1]);
  });
});
