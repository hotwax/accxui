import { describe, expect, it, vi } from "vitest";
import { dbClient } from "../db/dbClient";
import { defineEntity } from "../db/defineEntity";
import type { BaseDB } from "../db/baseDb";

function fakeDb() {
  const table = {
    get: vi.fn(async (key: unknown) => ({ key })),
    bulkGet: vi.fn(async (keys: unknown[]) => keys.map((key) => ({ key }))),
    delete: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => undefined),
    bulkPut: vi.fn(async (_rows: any[]) => undefined),
    toCollection: () => ({ primaryKeys: async () => storedKeys }),
    where: (field: string) => ({
      equals: (value: unknown) => ({
        toArray: async () => stored.filter((row: any) => row[field] === value),
      }),
    }),
  };
  let stored: any[] = [];
  let storedKeys: unknown[] = [];
  const db = {
    table: () => table,
    transaction: (_mode: string, _tables: string[], fn: () => Promise<any>) => fn(),
  } as unknown as BaseDB;

  return {
    table,
    db,
    seed(rows: any[], keys: unknown[]) { stored = rows; storedKeys = keys; },
  };
}

/** Same shape as a real seed entity: a renamed field, a date to coerce, a compound key. */
const geoAssoc = defineEntity({
  primaryKey: "geoId,toGeoId",
  fields: { geoId: "text", toGeoId: "text", updatedAt: "date" },
  indexes: ["toGeoId"],
  rename: { toGeoId: "geoIdTo" },
});

describe("dbClient compound keys", () => {
  it("passes an array key through to Dexie unchanged", async () => {
    const { table, db } = fakeDb();
    await dbClient(db).get("productStoreFacilities", ["STORE_1", "FAC_1"]);

    expect(table.get).toHaveBeenCalledWith(["STORE_1", "FAC_1"]);
  });

  it("passes array keys through to bulkDelete unchanged", async () => {
    const { table, db } = fakeDb();
    await dbClient(db).bulkRemove("productStoreFacilities", [["STORE_1", "FAC_1"]]);

    expect(table.bulkDelete).toHaveBeenCalledWith([["STORE_1", "FAC_1"]]);
  });

  it("short-circuits an empty array key instead of treating it as present", async () => {
    const { table, db } = fakeDb();

    expect(await dbClient(db).get("productStoreFacilities", [])).toBeUndefined();
    expect(table.get).not.toHaveBeenCalled();
  });

  it("still short-circuits an empty string key", async () => {
    const { table, db } = fakeDb();

    expect(await dbClient(db).get("facilities", "")).toBeUndefined();
    expect(table.get).not.toHaveBeenCalled();
  });

  it("reads a numeric key, which a date key member produces", async () => {
    const { table, db } = fakeDb();
    await dbClient(db).get("syncRuns", 1700000000000);

    expect(table.get).toHaveBeenCalledWith(1700000000000);
  });
});

describe("dbClient database binding", () => {
  it("resolves the current database per operation when given a resolver", async () => {
    const first = fakeDb();
    const second = fakeDb();
    let active = first.db;
    const client = dbClient(() => active);

    // Held across the switch, exactly as a worker sync domain holds its entity client.
    const entity = client.entity("facilities");
    await entity.get("FAC_1");
    active = second.db;
    await entity.get("FAC_2");

    expect(first.table.get).toHaveBeenCalledWith("FAC_1");
    expect(second.table.get).toHaveBeenCalledWith("FAC_2");
    expect(first.table.get).not.toHaveBeenCalledWith("FAC_2");
  });
});

describe("dbClient projection", () => {
  it("projects raw server records on upsertMany when given the schema entities", async () => {
    const { table, db } = fakeDb();
    const client = dbClient(db, { geoAssocs: geoAssoc });

    await client.entity("geoAssocs").upsertMany([
      { geoId: "USA", geoIdTo: "CA", updatedAt: "2026-01-02T00:00:00.000Z", extra: "dropped" },
    ]);

    const [written] = table.bulkPut.mock.calls[0][0];
    expect(written.toGeoId).toBe("CA");                     // rename applied
    expect(written.updatedAt).toBe(Date.parse("2026-01-02T00:00:00.000Z")); // date coerced
    expect(written.extra).toBeUndefined();                  // undeclared field dropped
  });

  it("prunes a scope by primary key, not by the scope value, on snapshotReplace", async () => {
    const { table, db, seed } = fakeDb();
    // One stored row in the scope; the fresh fetch no longer contains it.
    seed([{ geoId: "USA", toGeoId: "CA" }], [["USA", "CA"]]);
    const client = dbClient(db, { geoAssocs: geoAssoc });

    await client.entity("geoAssocs").snapshotReplace(
      [{ geoId: "USA", geoIdTo: "NY" }],
      { field: "geoId", value: "USA" },
    );

    // The stale row must be deleted by its real compound key — never by the scope value "USA".
    expect(table.bulkDelete).toHaveBeenCalledWith([["USA", "CA"]]);
  });

  it("refuses to write a table it has no entity definition for", async () => {
    const { db } = fakeDb();
    const client = dbClient(db, { geoAssocs: geoAssoc });

    await expect(client.entity("undeclared").upsertMany([{ id: "X" }]))
      .rejects.toThrow(/undeclared/);
  });
});
