import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/model/defineEntity";
import { defineSchema } from "../db/model/defineSchema";
import { projectRow, valuesAtPath } from "../db/storage/projection";
import { dbClient } from "../db/storage/dbClient";
import type { BaseDB } from "../db/storage/baseDb";

const shipments = () => defineEntity({
  primaryKey: "shipmentId",
  fields: {
    shipmentId: "text",
    statusId: "text",
    carrier: { partyId: "text", name: "text", createdDate: "date" },
    packages: [{ packageSeqId: "text", weight: "count", trackingCodes: ["text"] }],
    tags: ["text"],
    extra: "structured",
  },
  indexes: ["carrier.partyId", "[statusId+carrier.partyId]", "*packages.packageSeqId", "*packages.trackingCodes", "*tags"],
  rename: { "carrier.name": "groupName", "packages.weight": "grossWeight" },
});

describe("defineEntity with nested fields", () => {
  it("emits dotted indexes as-is and declares a list-crossing index on its hidden field", () => {
    expect(shipments().schema).toBe(
      "shipmentId, carrier.partyId, [statusId+carrier.partyId], *packages$packageSeqId, *packages$trackingCodes, *tags",
    );
    expect(shipments().listIndexes).toEqual({
      "packages.packageSeqId": "packages$packageSeqId",
      "packages.trackingCodes": "packages$trackingCodes",
    });
  });

  it("keeps the declared index list and top-level field names unchanged", () => {
    const entity = shipments();
    expect(entity.indexes).toContain("*packages.packageSeqId");
    expect(entity.fieldNames).toEqual(["shipmentId", "statusId", "carrier", "packages", "tags", "extra"]);
  });

  it("throws on an undeclared nested path, in an index or a rename", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text", c: { x: "text" } }, indexes: ["c.y"] }))
      .toThrow(/index "c.y" is not declared/);
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text", c: { x: "text" } }, rename: { "c.y": "z" } }))
      .toThrow(/`rename` names "c.y"/);
  });

  it("requires the multi-value form for a field inside a list, and rejects it on a single value", () => {
    const fields = { a: "text", l: [{ x: "text" }], o: { x: "text" } } as const;
    expect(() => defineEntity({ primaryKey: "a", fields, indexes: ["l.x"] })).toThrow(/inside a list; declare it as "\*l.x"/);
    expect(() => defineEntity({ primaryKey: "a", fields, indexes: ["*o.x"] })).toThrow(/"o.x" is a single value/);
    expect(() => defineEntity({ primaryKey: "a", fields, indexes: ["[a+l.x]"] })).toThrow(/inside a list/);
  });

  it("rejects an index on a nested object itself", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text", o: { x: "text" } }, indexes: ["o.x", "*o"] }))
      .toThrow(/must end at a text, count or date value/);
  });

  it("rejects malformed declarations", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text", o: {} } })).toThrow(/declares no fields/);
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text", l: [] as any } })).toThrow(/exactly one item spec/);
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text", o: { "x.y": "text" } } })).toThrow(/plain identifier/);
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text", o: { x: "string" as any } } })).toThrow(/unknown kind/);
  });

  it("requires a primary-key field to be a top-level scalar", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: { x: "text" } } })).toThrow(/must be a text, count or date/);
  });
});

describe("projectRow with nested fields", () => {
  const raw = {
    shipmentId: "S1",
    statusId: "SHIPPED",
    junk: "dropped",
    carrier: { partyId: " UPS ", groupName: "United Parcel", createdDate: "2026-01-01T00:00:00Z", secret: "x" },
    packages: [
      { packageSeqId: "01", grossWeight: "2.5", trackingCodes: ["1Z1", "1Z2"], other: 1 },
      { packageSeqId: "02", weight: 4, trackingCodes: ["1Z2"] },
      "not an object",
    ],
    tags: ["fragile", " ", "gift"],
    extra: { anything: [1, 2] },
  };

  it("keeps only declared nested fields, coerces leaves, and applies nested renames", () => {
    const row = projectRow(raw, shipments(), 7)!;

    expect(row.carrier).toEqual({ partyId: "UPS", name: "United Parcel", createdDate: Date.parse("2026-01-01T00:00:00Z") });
    expect(row.packages).toEqual([
      { packageSeqId: "01", weight: 2.5, trackingCodes: ["1Z1", "1Z2"] },
      { packageSeqId: "02", weight: 4, trackingCodes: ["1Z2"] },
    ]);
    expect(row.tags).toEqual(["fragile", "gift"]);
    expect(row.extra).toEqual({ anything: [1, 2] });
    expect(row).not.toHaveProperty("junk");
  });

  it("writes each list-crossing index's values, flattened and de-duplicated", () => {
    const row = projectRow(raw, shipments(), 7)!;

    expect(row.packages$packageSeqId).toEqual(["01", "02"]);
    expect(row.packages$trackingCodes).toEqual(["1Z1", "1Z2"]);
  });

  it("leaves a nested field out when the server sends the wrong shape, and keeps an empty list", () => {
    const row = projectRow({ shipmentId: "S2", carrier: "UPS", packages: [] }, shipments(), 7)!;

    expect(row).not.toHaveProperty("carrier");
    expect(row.packages).toEqual([]);
    expect(row.packages$packageSeqId).toEqual([]);
  });
});

describe("valuesAtPath", () => {
  it("fans out through lists at any depth", () => {
    const row = { a: [{ b: [{ c: 1 }, { c: 2 }] }, { b: [{ c: 3 }] }], d: { e: "x" } };
    expect(valuesAtPath(row, "a.b.c")).toEqual([1, 2, 3]);
    expect(valuesAtPath(row, "d.e")).toEqual(["x"]);
    expect(valuesAtPath(row, "d.nope")).toEqual([]);
  });
});

describe("extendEntities with nested fields", () => {
  const schema = () => defineSchema({ shipments: shipments() });

  it("merges into an existing nested object and list item", () => {
    const extended = schema().extendEntities({
      shipments: {
        fields: { carrier: { email: "text" }, packages: [{ boxTypeId: "text" }] },
        indexes: ["carrier.email", "*packages.boxTypeId"],
        rename: { "carrier.email": "emailAddress" },
      },
    });
    const entity = extended.entities.shipments;

    expect(entity.fields.carrier).toEqual({ partyId: "text", name: "text", createdDate: "date", email: "text" });
    expect(extended.stores.shipments).toContain("carrier.email");
    expect(extended.stores.shipments).toContain("*packages$boxTypeId");

    const row = projectRow({
      shipmentId: "S1",
      carrier: { partyId: "UPS", emailAddress: "ops@ups.test" },
      packages: [{ packageSeqId: "01", boxTypeId: "BOX_S" }],
    }, entity, 1)!;
    expect(row.carrier).toMatchObject({ email: "ops@ups.test" });
    expect(row.packages$boxTypeId).toEqual(["BOX_S"]);
  });

  it("throws on a nested field the entity already declares", () => {
    expect(() => schema().extendEntities({ shipments: { fields: { carrier: { partyId: "count" } } } }))
      .toThrow(/already declares field "carrier.partyId"/);
    expect(() => schema().extendEntities({ shipments: { fields: { carrier: "structured" } } }))
      .toThrow(/already declares field "carrier"/);
  });

  it("leaves the source entity untouched", () => {
    const source = schema();
    source.extendEntities({ shipments: { fields: { carrier: { email: "text" } } } });
    expect(source.entities.shipments.fields.carrier).not.toHaveProperty("email");
  });
});

/**
 * Enough of a Dexie table to exercise `query` on nested paths: dotted key paths and multi-value
 * (`*`) indexes resolve the way IndexedDB resolves them.
 */
function memoryTable(rows: any[], schema: string) {
  const specs = schema.split(",").slice(1).map((s) => s.trim());
  const indexes = specs.map((spec) => ({ name: spec.replace(/^\*/, ""), multi: spec.startsWith("*") }));
  const at = (row: any, path: string) => path.split(".").reduce((value, key) => value?.[key], row);
  const lookups: string[] = [];

  return {
    lookups,
    schema: { primKey: { name: "shipmentId" }, indexes },
    toArray: async () => [...rows],
    where: (name: string) => ({
      equals: (value: any) => {
        lookups.push(name);
        const index = indexes.find((i) => i.name === name)!;
        const hit = rows.filter((row) => {
          const indexed = at(row, name);
          return index.multi ? Array.isArray(indexed) && indexed.includes(value) : indexed === value;
        });
        return { toArray: async () => hit };
      },
    }),
  };
}

describe("query on nested fields", () => {
  const entity = shipments();
  const rows = [
    { shipmentId: "S1", statusId: "SHIPPED", carrier: { partyId: "UPS" }, packages: [{ trackingCodes: ["1Z1"] }], tags: ["gift"] },
    { shipmentId: "S2", statusId: "PACKED", carrier: { partyId: "FEDEX" }, packages: [{ trackingCodes: ["9F1", "9F2"] }], tags: [] },
  ].map((raw) => projectRow(raw, entity, 1)!);

  function client(schema: string) {
    const table = memoryTable(rows, schema);
    const db = { table: () => table } as unknown as BaseDB;
    return { table, entity: dbClient(db).entity<any>("shipments") };
  }

  it("seeks a dotted path through its index", async () => {
    const { table, entity: shipmentsClient } = client(entity.schema);
    const found = await shipmentsClient.query({ equals: { "carrier.partyId": "FEDEX" } });

    expect(found.map((r) => r.shipmentId)).toEqual(["S2"]);
    expect(table.lookups).toEqual(["carrier.partyId"]);
  });

  it("seeks a path inside a list through its hidden multi-value index", async () => {
    const { table, entity: shipmentsClient } = client(entity.schema);
    const found = await shipmentsClient.query({ equals: { "packages.trackingCodes": "9F2" } });

    expect(found.map((r) => r.shipmentId)).toEqual(["S2"]);
    expect(table.lookups).toEqual(["packages$trackingCodes"]);
  });

  it("answers the same in memory when no index covers the path", async () => {
    const { table, entity: shipmentsClient } = client("shipmentId");

    expect((await shipmentsClient.query({ equals: { "packages.trackingCodes": "1Z1" } })).map((r) => r.shipmentId))
      .toEqual(["S1"]);
    expect((await shipmentsClient.query({ equals: { "carrier.partyId": "FEDEX" } })).map((r) => r.shipmentId))
      .toEqual(["S2"]);
    expect((await shipmentsClient.query({ equals: { tags: "gift" } })).map((r) => r.shipmentId)).toEqual(["S1"]);
    expect(table.lookups).toEqual([]);
  });
});
