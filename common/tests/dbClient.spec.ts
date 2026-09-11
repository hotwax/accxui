import { describe, expect, it, vi } from "vitest";
import { dbClient } from "../db/dbClient";
import type { BaseDB } from "../db/baseDb";

function fakeDb() {
  const table = {
    get: vi.fn(async (key: unknown) => ({ key })),
    bulkGet: vi.fn(async (keys: unknown[]) => keys.map((key) => ({ key }))),
    delete: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => undefined),
  };
  return { table, db: { table: () => table } as unknown as BaseDB };
}

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
