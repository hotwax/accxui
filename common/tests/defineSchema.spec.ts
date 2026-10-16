import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/schema/defineEntity";
import { defineSchema, mergeSchemas } from "../db/schema/defineSchema";
import { projectRow } from "../db/storage/projection";

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

describe("AppSchema.extendEntities", () => {
  it("keeps retainOnLogout on an extended entity", () => {
    const retained = defineSchema({
      products: defineEntity({ primaryKey: "productId", fields: { productId: "text" }, retainOnLogout: true }),
    });
    const extended = retained.extendEntities({ products: { fields: { productName: "text" } } });

    expect(extended.entities.products.retainOnLogout).toBe(true);
  });

  it("adds fields to the entity's projection, after its own", () => {
    const extended = base().extendEntities({ facilities: { fields: { externalId: "text", openedDate: "date" } } });

    expect(extended.entities.facilities.fieldNames)
      .toEqual(["facilityId", "facilityName", "facilityTypeId", "ownerPartyId", "externalId", "openedDate"]);
    expect(extended.entities.facilities.fields.openedDate).toBe("date");
  });

  it("makes the added fields reach the stored row, so a shared sync domain keeps them", () => {
    const extended = base().extendEntities({ facilities: { fields: { externalId: "text" } } });

    expect(projectRow({ facilityId: "F1", externalId: " EXT-1 ", junk: "x" }, extended.entities.facilities, 1))
      .toMatchObject({ facilityId: "F1", externalId: "EXT-1" });
    expect(projectRow({ facilityId: "F1", externalId: "EXT-1" }, extended.entities.facilities, 1))
      .not.toHaveProperty("junk");
  });

  it("indexes a field added in the same extension", () => {
    const extended = base().extendEntities({
      facilities: { fields: { externalId: "text" }, indexes: ["externalId", "[facilityTypeId+externalId]"] },
    });

    expect(extended.stores.facilities).toBe("facilityId, facilityTypeId, externalId, [facilityTypeId+externalId]");
  });

  it("ignores an index the entity already declares rather than duplicating it", () => {
    const extended = base().extendEntities({ facilities: { indexes: ["facilityTypeId", "ownerPartyId"] } });

    expect(extended.stores.facilities).toBe("facilityId, facilityTypeId, ownerPartyId");
  });

  it("adds a rename for an added field, so the server's name is read into it", () => {
    const extended = base().extendEntities({
      facilities: { fields: { externalId: "text" }, rename: { externalId: "externalFacilityId" } },
    });

    expect(projectRow({ facilityId: "F1", externalFacilityId: "EXT-1" }, extended.entities.facilities, 1))
      .toMatchObject({ externalId: "EXT-1" });
  });

  it("keeps the entity's own renames alongside the added ones", () => {
    const named = defineSchema({
      facilities: defineEntity({
        primaryKey: "facilityId",
        fields: { facilityId: "text", name: "text" },
        rename: { name: "facilityName" },
      }),
    });
    const extended = named.extendEntities({
      facilities: { fields: { externalId: "text" }, rename: { externalId: "externalFacilityId" } },
    });

    expect(extended.entities.facilities.rename).toEqual({ name: "facilityName", externalId: "externalFacilityId" });
  });

  it("throws when the named table is not in the schema", () => {
    expect(() => base().extendEntities({ carriers: { fields: { partyId: "text" } } }))
      .toThrow(/extendEntities names "carriers", which is not a table in this schema/);
  });

  it("throws when an added field is already declared, rather than silently redefining it", () => {
    expect(() => base().extendEntities({ facilities: { fields: { facilityName: "count" } } }))
      .toThrow(/extendEntities: "facilities" already declares field "facilityName"/);
  });

  it("throws when a rename targets a field the entity does not declare", () => {
    expect(() => base().extendEntities({ facilities: { rename: { nope: "serverNope" } } }))
      .toThrow(/extendEntities: "facilities" renames "nope", which is not declared in `fields`/);
  });

  it("throws when a rename would replace one the entity already has", () => {
    const named = defineSchema({
      facilities: defineEntity({
        primaryKey: "facilityId",
        fields: { facilityId: "text", name: "text" },
        rename: { name: "facilityName" },
      }),
    });

    expect(() => named.extendEntities({ facilities: { rename: { name: "storeName" } } }))
      .toThrow(/extendEntities: "facilities" already renames "name"/);
  });

  it("throws when an extra index is not a declared field", () => {
    expect(() => base().extendEntities({ facilities: { indexes: ["nope"] } }))
      .toThrow(/is not declared in `fields`/);
  });

  it("throws when an extra index restates the primary key", () => {
    expect(() => base().extendEntities({ facilities: { indexes: ["facilityId"] } }))
      .toThrow(/restates the primary key/);
  });

  it("leaves the primary key and key defaults untouched", () => {
    const keyed = defineSchema({
      docs: defineEntity({
        primaryKey: "docId,feedId",
        fields: { docId: "text", feedId: "text" },
        keyDefaults: { feedId: "" },
      }),
    });
    const extended = keyed.extendEntities({ docs: { fields: { title: "text" } } });

    expect(extended.entities.docs.primaryKeyFields).toEqual(["docId", "feedId"]);
    expect(extended.entities.docs.keyDefaults).toEqual({ feedId: "" });
    expect(extended.stores.docs).toBe("[docId+feedId]");
  });

  it("leaves tables it does not name unchanged", () => {
    const schema = base();
    const extended = schema.extendEntities({ facilities: { fields: { externalId: "text" } } });

    expect(extended.entities.productStores).toBe(schema.entities.productStores);
  });

  it("does not mutate the source schema", () => {
    const schema = base();
    schema.extendEntities({ facilities: { fields: { externalId: "text" }, indexes: ["externalId"] } });

    expect(schema.entities.facilities.fieldNames).not.toContain("externalId");
    expect(schema.stores.facilities).toBe("facilityId, facilityTypeId");
  });

  it("returns a composable schema, so pick and mergeSchemas still work on the result", () => {
    const own = defineSchema({ carriers: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }) });
    const merged = mergeSchemas(base().pick(["facilities"]).extendEntities({ facilities: { fields: { externalId: "text" } } }), own);

    expect(merged.entities.facilities.fieldNames).toContain("externalId");
    expect(Object.keys(merged.stores).sort()).toEqual(["carriers", "facilities"]);
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

  it("preserves provenance through extendEntities", () => {
    const seed = defineSchema({ facilities }, { seed: true });

    expect([...seed.extendEntities({ facilities: { fields: { externalId: "text" } } }).seedTables]).toEqual(["facilities"]);
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
