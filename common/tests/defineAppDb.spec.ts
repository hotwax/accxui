import { describe, expect, it } from "vitest";
import { composeAppSchema } from "../db/defineAppDb";

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
