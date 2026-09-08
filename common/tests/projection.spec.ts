import { describe, expect, it } from "vitest";
import { canonicalKey, diffStaleKeys, entityKeyOf, isUnkeyableFetch, projectRow, projectRows, toCount, toMillis, toText } from "../db/projection";
import type { EntityProjection } from "../db/types";
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
  const facilityProjection: EntityProjection = {
    keyField: "facilityId",
    fields: {
      facilityId: "text",
      facilityName: "text",
      maximumOrderLimit: "count",
    },
  };

  it("stores only the projected fields, never the raw server payload", () => {
    const raw = {
      facilityId: "FAC_01",
      facilityName: "Main Warehouse",
      maximumOrderLimit: "100",
      extraServerField: "ignored",
    };

    const row = projectRow(raw, facilityProjection, 12345);
    expect(row).toEqual({
      facilityId: "FAC_01",
      facilityName: "Main Warehouse",
      maximumOrderLimit: 100,
      syncedAt: 12345,
    });
  });

  it("handles composite synthetic keys", () => {
    const compositeProjection: EntityProjection = {
      keyField: "storeFacilityKey",
      fields: {
        storeFacilityKey: "text",
        productStoreId: "text",
        facilityId: "text",
      },
      buildKey: (raw) => `${raw.productStoreId}|${raw.facilityId}`,
    };

    const raw = { productStoreId: "STORE_1", facilityId: "FAC_1" };
    const row = projectRow(raw, compositeProjection, 1000);
    expect(row?.storeFacilityKey).toBe("STORE_1|FAC_1");
  });

  it("drops records without a valid key", () => {
    const raw = { facilityName: "Nameless" };
    const row = projectRow(raw, facilityProjection, 1000);
    expect(row).toBeNull();
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
  const projection: EntityProjection = {
    keyField: "id",
    fields: { id: "text" },
  };

  it("flags unkeyable fetches", () => {
    const mismatchedRows = [{ wrongIdField: "123" }];
    expect(isUnkeyableFetch(mismatchedRows, projection)).toBe(true);

    const validRows = [{ id: "123" }];
    expect(isUnkeyableFetch(validRows, projection)).toBe(false);
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
