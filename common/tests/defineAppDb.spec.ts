import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { defineSchema, mergeSchemas } from "../db/defineSchema";
import { defineAppDb } from "../db/defineAppDb";
import { commonSchema } from "../db/domains/commonSchema";
import { COMMON_DOMAIN_NAMES, commonDomainsByTable } from "../db/domains/commonDomains";
import { registerDomains } from "../db/sync/registerDomains";
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

  it("lists the composed data tables, excluding syncMeta", () => {
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

describe("registerDomains", () => {
  beforeEach(() => clearSyncRegistry());

  it("registers domain definitions provided to it", () => {
    registerDomains([commonDomainsByTable.facilities, commonDomainsByTable.productStores]);

    expect(getAllSyncDomains().map((d) => d.name).sort()).toEqual(["facility", "productStore"]);
  });
});

describe("seed fetch config", () => {
  it("re-lists and snapshots just the one facility group, pruning members that left it", () => {
    expect(commonDomainsByTable.groupFacilities.name).toBe("groupFacility");
  });

  it("scopes the carrier list to the CARRIER role", () => {
    expect(commonDomainsByTable.carriers.name).toBe("carrier");
  });

  it("fans productStoreFacility out over cached product stores", () => {
    expect(commonDomainsByTable.productStoreFacilities.name).toBe("productStoreFacility");
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

describe("provenance keeps an app's own table out of the seed machinery", () => {
  // Mirrors Company: its own `statuses` table, same name as the seed one, different endpoint.
  const ownStatuses = defineSchema({
    statuses: defineEntity({ primaryKey: "statusId", fields: { statusId: "text", statusTypeId: "text" } }),
  });

  it("does not include custom app status table in statusCatalog", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: ownStatuses });
    expect(db.statusCatalog).toEqual([]);
  });

  it("includes common status table in statusCatalog when picked from commonSchema", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: commonSchema.pick(["statuses"]) });
    expect(db.statusCatalog.map((s) => s.name)).toEqual(["status"]);
  });
});

describe("DEFAULT_COMMON_SYNC_CATALOG", () => {
  it("derives one entry per seed table, with its singular domain name and label", () => {
    expect(DEFAULT_COMMON_SYNC_CATALOG).toHaveLength(29);
    expect(DEFAULT_COMMON_SYNC_CATALOG.map((e) => e.name).sort()).toEqual([...COMMON_DOMAIN_NAMES].sort());
    for (const entry of DEFAULT_COMMON_SYNC_CATALOG) {
      expect(entry.table, `${entry.name} missing table`).toBeTruthy();
      expect(entry.label, `${entry.name} missing label`).toBeTruthy();
      expect(entry.syncClass).toBe("B");
    }
  });
});
