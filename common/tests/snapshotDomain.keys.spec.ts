import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { canonicalKey, entityKeyOf, projectRow } from "../db/projection";
import { snapshotKeyOf } from "../db/sync/snapshotDomain";

const groupFacility = defineEntity({
  primaryKey: "facilityGroupId,facilityId,fromDate",
  fields: { facilityGroupId: "text", facilityId: "text", fromDate: "date", thruDate: "date" },
  indexes: ["facilityGroupId", "facilityId", "fromDate", "thruDate"],
});

describe("snapshotKeyOf", () => {
  it("derives a canonical dedup string from a raw server record", () => {
    const key = snapshotKeyOf(
      { facilityGroupId: "GRP1", facilityId: "FAC1", fromDate: 1700000000000 },
      groupFacility,
    );

    expect(key).toBe("GRP1\u0000FAC1\u00001700000000000");
  });

  it("returns a string, not a DbKey, because pageAll dedups through a Set", () => {
    const key = snapshotKeyOf({ facilityGroupId: "G", facilityId: "F", fromDate: 1 }, groupFacility);

    expect(typeof key).toBe("string");
  });

  it("returns undefined for a record missing a key member, so pageAll does not dedup on it", () => {
    expect(snapshotKeyOf({ facilityGroupId: "GRP1", facilityId: "FAC1" }, groupFacility))
      .toBeUndefined();
  });

  it("derives the same key from the raw record as from the row that gets stored", () => {
    const raw = { facilityGroupId: "GRP1", facilityId: "FAC1", fromDate: "2023-11-14T22:13:20.000Z" };
    const row = projectRow(raw, groupFacility, 500)!;

    expect(snapshotKeyOf(raw, groupFacility)).toBe(canonicalKey(entityKeyOf(row, groupFacility)!));
  });

  it("distinguishes two memberships of the same facility with different fromDates", () => {
    const a = snapshotKeyOf({ facilityGroupId: "G", facilityId: "F", fromDate: 1 }, groupFacility);
    const b = snapshotKeyOf({ facilityGroupId: "G", facilityId: "F", fromDate: 2 }, groupFacility);

    expect(a).not.toBe(b);
  });

  it("still keys a single-field entity by its bare value", () => {
    const facility = defineEntity({ primaryKey: "facilityId", fields: { facilityId: "text" } });

    expect(snapshotKeyOf({ facilityId: "FAC_1" }, facility)).toBe("FAC_1");
  });
});
