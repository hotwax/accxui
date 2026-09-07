import { describe, expect, it } from "vitest";
import { composeAppSchema, assertDistinctSeedTables } from "../db/defineAppDb";

describe("composeAppSchema", () => {
  it("includes only the picked seed tables", () => {
    const composed = composeAppSchema({ suffix: "TestDB", seed: ["status", "enum"], schema: {} });
    expect(Object.keys(composed.schema).sort()).toEqual(["enums", "statuses"]);
    expect(composed.schema.statuses).toBe("statusId, statusTypeId");
  });

  it("merges the app's own tables alongside the picks", () => {
    const composed = composeAppSchema({
      suffix: "TestDB",
      seed: ["status"],
      schema: { auditLogs: "logId, createdAt" },
    });
    expect(Object.keys(composed.schema).sort()).toEqual(["auditLogs", "statuses"]);
  });

  it("creates no seed tables when nothing is picked", () => {
    const composed = composeAppSchema({ suffix: "TestDB", seed: [], schema: { foo: "id" } });
    expect(Object.keys(composed.schema)).toEqual(["foo"]);
  });

  it("appends extendIndexes after the seed primary key and indexes", () => {
    const composed = composeAppSchema({
      suffix: "TestDB",
      seed: ["carrier"],
      schema: {},
      extendIndexes: { carriers: "groupName, roleTypeId" },
    });
    expect(composed.schema.carriers).toBe("partyId, groupName, roleTypeId");
  });

  it("derives a status catalog that always matches the picks", () => {
    const composed = composeAppSchema({ suffix: "TestDB", seed: ["status", "carrier"], schema: {} });
    expect(composed.statusCatalog).toEqual([
      { name: "status", table: "statuses", label: "Statuses", syncClass: "B" },
      { name: "carrier", table: "carriers", label: "Shipping Carriers", syncClass: "B" },
    ]);
    expect(composed.statusCatalog.length).toBe(composed.seed.length);
  });

  it("allows an own table whose name matches an UNPICKED seed table", () => {
    // Company's `statuses` case: it keeps its own table because the endpoints disagree.
    const composed = composeAppSchema({
      suffix: "TestDB",
      seed: ["enum"],
      schema: { statuses: "statusId, statusTypeId, description" },
    });
    expect(composed.schema.statuses).toBe("statusId, statusTypeId, description");
  });
});

describe("composeAppSchema validation", () => {
  it("throws on an unknown seed name", () => {
    expect(() =>
      composeAppSchema({ suffix: "TestDB", seed: ["nope" as any], schema: {} }),
    ).toThrow(/unknown seed entity "nope"/i);
  });

  it("throws when two picked seed entities claim the same table", () => {
    const entity1 = { name: "foo", table: "shared", schema: "id", label: "Foo", projection: {} };
    const entity2 = { name: "bar", table: "shared", schema: "id", label: "Bar", projection: {} };
    expect(() => assertDistinctSeedTables([entity1, entity2])).toThrow(/seed entities "foo" and "bar" both claim table "shared"/i);
  });

  it("throws when an own table collides with a PICKED seed table", () => {
    expect(() =>
      composeAppSchema({ suffix: "TestDB", seed: ["carrier"], schema: { carriers: "partyId, x" } }),
    ).toThrow(/carriers.*already provided by seed entity "carrier".*extendIndexes/is);
  });

  it("throws when extendIndexes names a table that was not picked", () => {
    expect(() =>
      composeAppSchema({ suffix: "TestDB", seed: ["status"], schema: {}, extendIndexes: { carriers: "x" } }),
    ).toThrow(/extendIndexes.*"carriers".*not a picked seed table/is);
  });

  it("throws when extendIndexes restates the primary key", () => {
    expect(() =>
      composeAppSchema({ suffix: "TestDB", seed: ["carrier"], schema: {}, extendIndexes: { carriers: "partyId" } }),
    ).toThrow(/must not restate the primary key "partyId"/i);
  });

  it("throws when the app declares syncMeta", () => {
    expect(() =>
      composeAppSchema({ suffix: "TestDB", seed: [], schema: { syncMeta: "key" } }),
    ).toThrow(/syncMeta.*provided by BaseDB/is);
  });

  it("throws on an empty suffix", () => {
    expect(() => composeAppSchema({ suffix: "", seed: [], schema: { foo: "id" } })).toThrow(/suffix/i);
  });
});

import { defineAppDb } from "../db/defineAppDb";

describe("defineAppDb", () => {
  const appDb = defineAppDb({
    suffix: "TestDB",
    seed: ["status", "carrier"],
    schema: { auditLogs: "logId, createdAt" },
    extendIndexes: { carriers: "groupName" },
  });

  it("names the database per OMS instance", () => {
    expect(appDb.name("demo-oms")).toBe("demo-oms-TestDB");
  });

  it("throws rather than share a database across instances", () => {
    expect(() => appDb.name("")).toThrow(/no OMS instance/i);
  });

  it("exposes the composed schema and the picks", () => {
    expect(appDb.schema.carriers).toBe("partyId, groupName");
    expect(appDb.seed.map((e) => e.name)).toEqual(["status", "carrier"]);
    expect(appDb.statusCatalog.length).toBe(2);
  });

  it("lists the composed data tables; BaseDB adds syncMeta on top", () => {
    expect(appDb.tableNames.sort()).toEqual(["auditLogs", "carriers", "statuses"]);
    // BaseDB injects syncMeta, so the live handle reports one more.
    expect(appDb.get("demo-oms").getTableNames()).toContain("syncMeta");
  });

  it("reuses one handle per instance and swaps on switch", () => {
    const first = appDb.get("demo-oms");
    expect(appDb.get("demo-oms")).toBe(first);
    const second = appDb.get("other-oms");
    expect(second).not.toBe(first);
    expect(second.name).toBe("other-oms-TestDB");
  });

  it("throws from raw() until a resolver is registered", () => {
    const bare = defineAppDb({ suffix: "BareDB", seed: [], schema: { foo: "id" } });
    expect(() => bare.raw()).toThrow(/no OMS instance resolver/i);
    bare.setOmsInstanceResolver(() => "demo-oms");
    expect(bare.raw().name).toBe("demo-oms-BareDB");
  });
});

import { registerSeedDomains } from "../db/sync/registerSeedDomains";
import { clearSyncRegistry, getAllSyncDomains } from "../db/sync/syncRegistry";

describe("registerSeedDomains", () => {
  it("registers only the declared entities", () => {
    clearSyncRegistry();
    registerSeedDomains(defineAppDb({ suffix: "PickDB", seed: ["status", "enum"], schema: {} }));
    expect(getAllSyncDomains().map((d) => d.name).sort()).toEqual(["enum", "status"]);
  });

  it("registers nothing when no seed entity is picked", () => {
    clearSyncRegistry();
    registerSeedDomains(defineAppDb({ suffix: "NoneDB", seed: [], schema: { foo: "id" } }));
    expect(getAllSyncDomains()).toEqual([]);
  });
});

import { DEFAULT_COMMON_SYNC_CATALOG } from "../db/useDbStatus";
import { SEED_ENTITY_NAMES } from "../db/domains/seedEntities";

describe("DEFAULT_COMMON_SYNC_CATALOG", () => {
  it("derives one entry per seed entity, restoring the two the hand-written list lost", () => {
    expect(DEFAULT_COMMON_SYNC_CATALOG.length).toBe(29);
    expect(DEFAULT_COMMON_SYNC_CATALOG.length).toBe(SEED_ENTITY_NAMES.length);
    expect(DEFAULT_COMMON_SYNC_CATALOG.map((e) => e.name)).toContain("carrierShipmentMethod");
    expect(DEFAULT_COMMON_SYNC_CATALOG.map((e) => e.name)).toContain("productStoreEmailSetting");
  });
});
