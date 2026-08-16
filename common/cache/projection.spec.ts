import { describe, expect, it } from "vitest";
import { diffStaleKeys, isUnkeyableFetch, projectRow, projectRows, toCount, toMillis, toText } from "./projection";
import type { EntityProjection } from "./types";

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

  it("projects raw server payload correctly", () => {
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
      raw,
      cachedAt: 12345,
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
