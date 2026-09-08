import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { defineSchema, mergeSchemas } from "../db/defineSchema";

const facilities = defineEntity({
  primaryKey: "facilityId",
  fields: { facilityId: "text", facilityName: "text", facilityTypeId: "text", ownerPartyId: "text" },
  indexes: ["facilityTypeId"],
});

const productStores = defineEntity({
  primaryKey: "productStoreId",
  fields: { productStoreId: "text", storeName: "text" },
  indexes: ["storeName"],
});

const base = () => defineSchema({ facilities, productStores });

describe("defineSchema", () => {
  it("exposes entities and a Dexie-ready stores map keyed by table name", () => {
    const schema = base();

    expect(Object.keys(schema.entities)).toEqual(["facilities", "productStores"]);
    expect(schema.stores).toEqual({
      facilities: "facilityId, facilityTypeId",
      productStores: "productStoreId, storeName",
    });
  });

  it("throws when a table is named syncMeta, which BaseDB provides", () => {
    expect(() => defineSchema({ syncMeta: facilities }))
      .toThrow(/"syncMeta" is provided by BaseDB/);
  });
});

describe("AppSchema.pick", () => {
  it("returns only the requested tables", () => {
    const picked = base().pick(["productStores"]);

    expect(Object.keys(picked.entities)).toEqual(["productStores"]);
    expect(picked.stores).toEqual({ productStores: "productStoreId, storeName" });
  });

  it("throws on an unknown table rather than silently skipping it", () => {
    expect(() => base().pick(["facility"]))
      .toThrow(/pick names "facility", which is not a table in this schema/);
  });

  it("does not mutate the source schema", () => {
    const schema = base();
    schema.pick(["productStores"]);

    expect(Object.keys(schema.entities)).toEqual(["facilities", "productStores"]);
  });
});

describe("AppSchema.extendIndexes", () => {
  it("appends indexes after the entity's own", () => {
    const widened = base().extendIndexes({ facilities: ["ownerPartyId"] });

    expect(widened.stores.facilities).toBe("facilityId, facilityTypeId, ownerPartyId");
  });

  it("throws when the named table is not in the schema", () => {
    expect(() => base().extendIndexes({ carriers: ["partyId"] }))
      .toThrow(/extendIndexes names "carriers", which is not a table in this schema/);
  });

  it("throws when the extra index restates the primary key", () => {
    expect(() => base().extendIndexes({ facilities: ["facilityId"] }))
      .toThrow(/restates the primary key/);
  });

  it("throws when the extra index is not a declared field", () => {
    expect(() => base().extendIndexes({ facilities: ["nope"] }))
      .toThrow(/is not declared in `fields`/);
  });

  it("ignores an index the entity already declares rather than duplicating it", () => {
    const widened = base().extendIndexes({ facilities: ["facilityTypeId"] });

    expect(widened.stores.facilities).toBe("facilityId, facilityTypeId");
  });

  it("does not mutate the source schema", () => {
    const schema = base();
    schema.extendIndexes({ facilities: ["ownerPartyId"] });

    expect(schema.stores.facilities).toBe("facilityId, facilityTypeId");
  });
});

describe("mergeSchemas", () => {
  it("combines every input's tables", () => {
    const own = defineSchema({ carriers: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }) });
    const merged = mergeSchemas(base().pick(["facilities"]), own);

    expect(Object.keys(merged.stores).sort()).toEqual(["carriers", "facilities"]);
  });

  it("throws when two inputs claim the same table", () => {
    expect(() => mergeSchemas(base(), base().pick(["facilities"])))
      .toThrow(/table "facilities" is claimed by more than one schema/);
  });

  it("returns a composable schema, so pick still works on the result", () => {
    const own = defineSchema({ carriers: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }) });
    const merged = mergeSchemas(base(), own);

    expect(Object.keys(merged.pick(["carriers"]).entities)).toEqual(["carriers"]);
  });

  it("returns an empty schema when given nothing", () => {
    expect(mergeSchemas().stores).toEqual({});
  });
});

describe("seed provenance", () => {
  it("marks nothing as a seed table by default", () => {
    expect(base().seedTables.size).toBe(0);
  });

  it("marks every table when the schema declares itself the seed schema", () => {
    const seed = defineSchema({ facilities, productStores }, { seed: true });

    expect([...seed.seedTables].sort()).toEqual(["facilities", "productStores"]);
  });

  it("narrows provenance through pick", () => {
    const seed = defineSchema({ facilities, productStores }, { seed: true });

    expect([...seed.pick(["facilities"]).seedTables]).toEqual(["facilities"]);
  });

  it("preserves provenance through extendIndexes", () => {
    const seed = defineSchema({ facilities }, { seed: true });

    expect([...seed.extendIndexes({ facilities: ["ownerPartyId"] }).seedTables]).toEqual(["facilities"]);
  });

  it("keeps the two sides distinct when merged, even on a NAME COLLISION-free merge", () => {
    const seed = defineSchema({ facilities }, { seed: true });
    const own = defineSchema({ widgets: defineEntity({ primaryKey: "widgetId", fields: { widgetId: "text" } }) });
    const merged = mergeSchemas(seed, own);

    expect(merged.seedTables.has("facilities")).toBe(true);
    expect(merged.seedTables.has("widgets")).toBe(false);
  });

  it("treats an app's OWN table as app-owned even when its name matches a seed table", () => {
    // The real case: Company declares its own `statuses` because the framework fetches
    // admin/status while Company fetches oms/statuses.
    const own = defineSchema({ statuses: defineEntity({ primaryKey: "statusId", fields: { statusId: "text" } }) });

    expect(own.seedTables.has("statuses")).toBe(false);
  });
});
