import { describe, expect, it } from "vitest";
import { canonicalKey, diffStaleKeys, entityKeyOf, isUnkeyableFetch, projectRow, projectRows, toCount, toMillis, toText } from "../db/projection";
import { defineEntity } from "../db/defineEntity";

describe("projection coercion helpers", () => {
  it("coerces dates accurately to epoch millis", () => {
    expect(toMillis(1700000000000)).toBe(1700000000000);
    expect(toMillis("1700000000000")).toBe(1700000000000);
    expect(toMillis("2024-01-01T00:00:00.000Z")).toBe(1704067200000);
    expect(toMillis("")).toBeUndefined();
    expect(toMillis(null)).toBeUndefined();
  });

  it("coerces counts to finite numbers", () => {
    expect(toCount(42)).toBe(42);
    expect(toCount("15")).toBe(15);
    expect(toCount("invalid")).toBeUndefined();
    expect(toCount(null)).toBeUndefined();
  });

  it("coerces text and trims whitespace", () => {
    expect(toText("  STORE_1  ")).toBe("STORE_1");
    expect(toText("")).toBeUndefined();
    expect(toText(null)).toBeUndefined();
  });
});

describe("projectRow & projectRows", () => {
  const facility = defineEntity({
    primaryKey: "facilityId",
    fields: { facilityId: "text", facilityName: "text", maximumOrderLimit: "count" },
  });

  it("stores only the projected fields, never the raw server payload", () => {
    const raw = {
      facilityId: "FAC_01",
      facilityName: "Main Warehouse",
      maximumOrderLimit: "100",
      extraServerField: "ignored",
    };

    expect(projectRow(raw, facility, 12345)).toEqual({
      facilityId: "FAC_01",
      facilityName: "Main Warehouse",
      maximumOrderLimit: 100,
      syncedAt: 12345,
    });
  });

  it("stores a compound key as its real member fields, with no synthetic column", () => {
    const storeFacility = defineEntity({
      primaryKey: "productStoreId,facilityId",
      fields: { productStoreId: "text", facilityId: "text" },
    });

    expect(projectRow({ productStoreId: "STORE_1", facilityId: "FAC_1" }, storeFacility, 1000))
      .toEqual({ productStoreId: "STORE_1", facilityId: "FAC_1", syncedAt: 1000 });
  });

  it("drops a record missing any compound-key member", () => {
    const storeFacility = defineEntity({
      primaryKey: "productStoreId,facilityId",
      fields: { productStoreId: "text", facilityId: "text" },
    });

    expect(projectRow({ productStoreId: "STORE_1" }, storeFacility, 1000)).toBeNull();
  });

  it("reads a key member supplied only under its rename source", () => {
    const geoAssoc = defineEntity({
      primaryKey: "geoId,toGeoId",
      fields: { geoId: "text", toGeoId: "text" },
      rename: { toGeoId: "geoIdTo" },
    });

    expect(projectRow({ geoId: "USA", geoIdTo: "CA" }, geoAssoc, 1000))
      .toEqual({ geoId: "USA", toGeoId: "CA", syncedAt: 1000 });
  });

  it("coerces a date key member to millis, so it is a valid IndexedDB key", () => {
    const dated = defineEntity({
      primaryKey: "facilityGroupId,fromDate",
      fields: { facilityGroupId: "text", fromDate: "date" },
    });

    const row = projectRow({ facilityGroupId: "GRP1", fromDate: "2024-01-01T00:00:00.000Z" }, dated, 1);
    expect(row?.fromDate).toBe(1704067200000);
  });

  it("drops records without a valid key", () => {
    expect(projectRow({ facilityName: "Nameless" }, facility, 1000)).toBeNull();
    expect(projectRows([{ facilityId: "A" }, { facilityName: "X" }], facility, 1000)).toHaveLength(1);
  });
});

describe("diffStaleKeys", () => {
  it("finds keys that were removed in fresh dataset", () => {
    const existing = ["A", "B", "C", "D"];
    const fresh = ["B", "D", "E"];
    expect(diffStaleKeys(existing, fresh)).toEqual(["A", "C"]);
  });
});

describe("isUnkeyableFetch", () => {
  const entity = defineEntity({ primaryKey: "id", fields: { id: "text" } });

  it("flags unkeyable fetches", () => {
    expect(isUnkeyableFetch([{ wrongIdField: "123" }], entity)).toBe(true);
    expect(isUnkeyableFetch([{ id: "123" }], entity)).toBe(false);
  });

  it("does not flag an empty fetch", () => {
    expect(isUnkeyableFetch([], entity)).toBe(false);
  });
});

describe("canonicalKey", () => {
  it("passes a scalar key through as a string", () => {
    expect(canonicalKey("FAC_1")).toBe("FAC_1");
    expect(canonicalKey(42)).toBe("42");
  });

  it("joins a compound key on NUL, which cannot occur in an OFBiz id", () => {
    expect(canonicalKey(["A", "B"])).toBe("A\u0000B");
  });

  it("does not conflate compound keys a pipe separator would collide on", () => {
    // "A|B" is a legal single id, and ["A","B"] is a legal compound key.
    expect(canonicalKey(["A", "B"])).not.toBe(canonicalKey("A|B"));
  });

  it("distinguishes compound keys that share a prefix", () => {
    expect(canonicalKey(["AB", "C"])).not.toBe(canonicalKey(["A", "BC"]));
  });
});

describe("entityKeyOf", () => {
  const single = defineEntity({ primaryKey: "facilityId", fields: { facilityId: "text" } });
  const compound = defineEntity({
    primaryKey: "productStoreId,facilityId",
    fields: { productStoreId: "text", facilityId: "text" },
  });

  it("returns a scalar for a single-field key", () => {
    expect(entityKeyOf({ facilityId: "FAC_1" }, single)).toBe("FAC_1");
  });

  it("returns an array in declared order for a compound key", () => {
    expect(entityKeyOf({ facilityId: "FAC_1", productStoreId: "STORE_1" }, compound))
      .toEqual(["STORE_1", "FAC_1"]);
  });

  it("returns undefined when any member is missing or empty", () => {
    expect(entityKeyOf({ productStoreId: "STORE_1" }, compound)).toBeUndefined();
    expect(entityKeyOf({ productStoreId: "STORE_1", facilityId: "" }, compound)).toBeUndefined();
    expect(entityKeyOf({}, single)).toBeUndefined();
  });

  it("keeps a numeric member numeric, since a date key is stored as millis", () => {
    const dated = defineEntity({
      primaryKey: "facilityId,fromDate",
      fields: { facilityId: "text", fromDate: "date" },
    });

    expect(entityKeyOf({ facilityId: "FAC_1", fromDate: 1700000000000 }, dated))
      .toEqual(["FAC_1", 1700000000000]);
  });
});

describe("diffStaleKeys with compound keys", () => {
  it("diffs array keys by value, not identity", () => {
    const existing = [["A", "1"], ["B", "2"], ["C", "3"]];
    const fresh = [["B", "2"], ["D", "4"]];

    expect(diffStaleKeys(existing, fresh)).toEqual([["A", "1"], ["C", "3"]]);
  });

  it("returns the original array form, so the result can be passed to bulkDelete", () => {
    const [stale] = diffStaleKeys([["A", "1"]], []);
    expect(Array.isArray(stale)).toBe(true);
  });

  it("does not treat prefix-sharing compound keys as equal", () => {
    expect(diffStaleKeys([["AB", "C"]], [["A", "BC"]])).toEqual([["AB", "C"]]);
  });
});
