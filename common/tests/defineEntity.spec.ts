import { describe, expect, it } from "vitest";
import { defineEntity, normalizePrimaryKey } from "../db/defineEntity";

describe("normalizePrimaryKey", () => {
  it("returns a bare string for a single field", () => {
    expect(normalizePrimaryKey("facilityId")).toBe("facilityId");
  });

  it("returns an array for a composite key, trimming whitespace", () => {
    expect(normalizePrimaryKey(" productId , facilityId ")).toEqual(["productId", "facilityId"]);
  });

  it("drops empty segments from trailing or doubled commas", () => {
    expect(normalizePrimaryKey("productId,facilityId,")).toEqual(["productId", "facilityId"]);
    expect(normalizePrimaryKey("productId,,facilityId")).toEqual(["productId", "facilityId"]);
  });
});

describe("defineEntity schema emission", () => {
  it("emits a plain keyPath followed by its indexes", () => {
    const entity = defineEntity({
      primaryKey: "facilityId",
      fields: { facilityId: "text", facilityName: "text", facilityTypeId: "text" },
      indexes: ["facilityTypeId"],
    });

    expect(entity.schema).toBe("facilityId, facilityTypeId");
    expect(entity.primaryKey).toBe("facilityId");
    expect(entity.primaryKeyFields).toEqual(["facilityId"]);
  });

  it("emits a Dexie compound keyPath for a composite key", () => {
    const entity = defineEntity({
      primaryKey: "productId,facilityId",
      fields: { productId: "text", facilityId: "text", minimumStock: "count" },
      indexes: ["productId", "facilityId"],
    });

    expect(entity.schema).toBe("[productId+facilityId], productId, facilityId");
    expect(entity.primaryKey).toEqual(["productId", "facilityId"]);
    expect(entity.primaryKeyFields).toEqual(["productId", "facilityId"]);
  });

  it("emits only the keyPath when there are no indexes", () => {
    const entity = defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } });

    expect(entity.schema).toBe("partyId");
    expect(entity.indexes).toEqual([]);
  });

  it("exposes field names in declaration order as the projection list", () => {
    const entity = defineEntity({
      primaryKey: "geoId",
      fields: { geoId: "text", geoName: "text", geoCode: "text" },
    });

    expect(entity.fieldNames).toEqual(["geoId", "geoName", "geoCode"]);
  });

  it("carries rename through untouched", () => {
    const entity = defineEntity({
      primaryKey: "geoId,toGeoId",
      fields: { geoId: "text", toGeoId: "text" },
      rename: { toGeoId: "geoIdTo" },
    });

    expect(entity.rename).toEqual({ toGeoId: "geoIdTo" });
  });
});

describe("defineEntity validation", () => {
  it("throws on an empty primary key", () => {
    expect(() => defineEntity({ primaryKey: "  ", fields: { a: "text" } }))
      .toThrow(/non-empty `primaryKey`/);
  });

  it("throws when the primary key repeats a field", () => {
    expect(() => defineEntity({ primaryKey: "a,a", fields: { a: "text" } }))
      .toThrow(/repeats field "a"/);
  });

  it("throws when a primary-key field is not a declared field", () => {
    expect(() => defineEntity({ primaryKey: "a,b", fields: { a: "text" } }))
      .toThrow(/primary-key field "b" is not declared in `fields`/);
  });

  it("throws when an index is not a declared field", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text" }, indexes: ["status"] }))
      .toThrow(/index "status" is not declared in `fields`/);
  });

  it("throws when an index restates a single-field primary key", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text" }, indexes: ["a"] }))
      .toThrow(/index "a" restates the primary key/);
  });

  it("throws when an index restates the compound key expression", () => {
    expect(() =>
      defineEntity({ primaryKey: "a,b", fields: { a: "text", b: "text" }, indexes: ["[a+b]"] }),
    ).toThrow(/index "\[a\+b\]" restates the primary key/);
  });

  it("allows an index on an individual member of a compound key", () => {
    expect(() =>
      defineEntity({ primaryKey: "a,b", fields: { a: "text", b: "text" }, indexes: ["a"] }),
    ).not.toThrow();
  });

  it("throws on a duplicate index", () => {
    expect(() =>
      defineEntity({ primaryKey: "a", fields: { a: "text", b: "text" }, indexes: ["b", "b"] }),
    ).toThrow(/duplicate index "b"/);
  });

  it("accepts a compound secondary index and emits it verbatim", () => {
    const entity = defineEntity({
      primaryKey: "logId",
      fields: { logId: "text", configId: "text", createdDate: "date" },
      indexes: ["configId", "[configId+createdDate]"],
    });

    expect(entity.schema).toBe("logId, configId, [configId+createdDate]");
  });

  it("throws when a compound index names an unprojected field", () => {
    expect(() => defineEntity({
      primaryKey: "logId",
      fields: { logId: "text", configId: "text" },
      indexes: ["[configId+createdDate]"],
    })).toThrow(/compound index "\[configId\+createdDate\]" names "createdDate"/);
  });
});
