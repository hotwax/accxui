import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { defineSchema, mergeSchemas } from "../db/defineSchema";
import { defineAppDb } from "../db/defineAppDb";
import { commonSchema } from "../db/domains/commonSchema";
import { SEED_DOMAIN_NAMES, SEED_SOURCES } from "../db/domains/seedSources";
import { registerSeedDomains } from "../db/sync/registerSeedDomains";
import { clearSyncRegistry, getAllSyncDomains } from "../db/sync/syncRegistry";
import { DEFAULT_COMMON_SYNC_CATALOG } from "../db/useDbStatus";

const ownSchema = defineSchema({
  widgets: defineEntity({
    primaryKey: "widgetId",
    fields: { widgetId: "text", statusId: "text" },
    indexes: ["statusId"],
  }),
});

const picked = () => commonSchema.pick(["facilities", "productStores"]);

describe("defineAppDb schema composition", () => {
  it("composes the picked seed tables with the app's own", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: mergeSchemas(picked(), ownSchema) });

    expect(Object.keys(db.schema).sort()).toEqual(["facilities", "productStores", "widgets"]);
  });

  it("lists the composed data tables; BaseDB adds syncMeta on top", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: ownSchema });

    expect(db.tableNames).toEqual(["widgets"]);
    expect(db.tableNames).not.toContain("syncMeta");
  });

  it("derives a status catalog that always matches the composed seed tables", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: mergeSchemas(picked(), ownSchema) });

    expect(db.statusCatalog.map((entry) => entry.name).sort()).toEqual(["facility", "productStore"]);
  });

  it("leaves an own table out of the status catalog, having no seed source", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: ownSchema });

    expect(db.statusCatalog).toEqual([]);
  });

  it("throws on an empty suffix", () => {
    expect(() => defineAppDb({ suffix: "", schema: ownSchema })).toThrow(/non-empty `suffix`/);
  });
});

describe("registerSeedDomains", () => {
  beforeEach(() => clearSyncRegistry());

  it("registers only the composed seed tables, under their domain names", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: mergeSchemas(picked(), ownSchema) });
    registerSeedDomains(db);

    expect(getAllSyncDomains().map((d) => d.name).sort()).toEqual(["facility", "productStore"]);
  });

  it("registers nothing when the app composes no seed table", () => {
    registerSeedDomains(defineAppDb({ suffix: "TestDB", schema: ownSchema }));

    expect(getAllSyncDomains()).toEqual([]);
  });

  it("registers every seed domain when the whole common schema is taken", () => {
    registerSeedDomains(defineAppDb({ suffix: "TestDB", schema: commonSchema }));

    expect(getAllSyncDomains().map((d) => d.name).sort()).toEqual([...SEED_DOMAIN_NAMES].sort());
  });
});

describe("seed fetch config", () => {
  it("re-lists and snapshots just the one facility group, pruning members that left it", () => {
    const { refetchScope } = SEED_SOURCES.groupFacilities.source;
    expect(refetchScope).toBeTypeOf("function");

    expect(refetchScope!({ facilityGroupId: "GRP1" })).toEqual({
      params: { facilityGroupId: "GRP1" },
      scope: { field: "facilityGroupId", value: "GRP1" },
    });
  });

  it("scopes the carrier list to the CARRIER role", () => {
    expect(SEED_SOURCES.carriers.source.listUrl).toBe("oms/shippingGateways/carrierParties");
    expect(SEED_SOURCES.carriers.source.listParams).toEqual({ roleTypeId: "CARRIER" });
  });

  it("fans productStoreFacility out over cached product stores", () => {
    const { fanOut } = SEED_SOURCES.productStoreFacilities.source;

    expect(fanOut?.parentTable).toBe("productStores");
    expect(fanOut?.parentKeyField).toBe("productStoreId");
    expect(fanOut?.urlFor("STORE 1")).toBe("oms/productStores/STORE%201/facilities");
  });
});

describe("defineAppDb", () => {
  const appDb = defineAppDb({ suffix: "TestDB", schema: ownSchema });

  it("names the database per OMS instance", () => {
    expect(appDb.name("demo-oms")).toBe("demo-oms-TestDB");
  });

  it("throws rather than share a database across instances", () => {
    expect(() => appDb.name("")).toThrow(/no OMS instance/i);
  });

  it("reuses one handle per instance and swaps on switch", () => {
    const first = appDb.get("demo-oms");
    expect(appDb.get("demo-oms")).toBe(first);
    const second = appDb.get("other-oms");
    expect(second).not.toBe(first);
    expect(second.name).toBe("other-oms-TestDB");
  });

  it("closes the previous connection on a switch so stale handles stop serving rows", () => {
    const alpha = appDb.get("alpha-oms");
    const close = vi.spyOn(alpha, "close");

    appDb.get("beta-oms");

    expect(close).toHaveBeenCalled();
  });

  it("throws from raw() until a resolver is registered", () => {
    const bare = defineAppDb({ suffix: "BareDB", schema: ownSchema });
    expect(() => bare.raw()).toThrow(/no OMS instance resolver/i);
    bare.setOmsInstanceResolver(() => "demo-oms");
    expect(bare.raw().name).toBe("demo-oms-BareDB");
  });
});

describe("DEFAULT_COMMON_SYNC_CATALOG", () => {
  it("derives one entry per seed table, with its singular domain name and label", () => {
    expect(DEFAULT_COMMON_SYNC_CATALOG).toHaveLength(29);
    expect(DEFAULT_COMMON_SYNC_CATALOG.map((e) => e.name).sort()).toEqual([...SEED_DOMAIN_NAMES].sort());
    for (const entry of DEFAULT_COMMON_SYNC_CATALOG) {
      expect(entry.table, `${entry.name} missing table`).toBeTruthy();
      expect(entry.label, `${entry.name} missing label`).toBeTruthy();
      expect(entry.syncClass).toBe("B");
    }
  });
});
