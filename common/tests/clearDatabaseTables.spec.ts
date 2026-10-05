import { beforeEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { type BaseDB, __resetDbVersionChecks, clearDatabaseTables, ensureDbReady } from "../db/storage/baseDb";

describe("clearDatabaseTables", () => {
  let deleted: string[];

  beforeEach(() => {
    __resetDbVersionChecks();
    deleted = [];
    vi.spyOn(Dexie, "delete").mockImplementation(async (name: string) => { deleted.push(name); });
  });

  it("keeps the schema version, so the next realm to open the emptied database does not rebuild it", async () => {
    // Logout clears the tables, and the sync worker the next login starts has not checked the version yet.
    const rows: Record<string, Map<string, any>> = {
      orders: new Map([["10001", { orderId: "10001" }]]),
      syncMeta: new Map<string, any>([
        ["schemaVersion", { key: "schemaVersion", version: 2 }],
        ["loginSync:orders", { key: "loginSync:orders", synced: true }],
      ]),
    };
    const db = {
      name: "demo-TestDB",
      declaredVersion: 2,
      isOpen: () => true,
      open: vi.fn(async () => {}),
      close: vi.fn(),
      getTableNames: () => Object.keys(rows),
      transaction: async (_mode: string, _tables: string[], fn: () => Promise<void>) => fn(),
      table: (name: string) => ({ clear: async () => rows[name].clear() }),
      syncMeta: {
        get: async (key: string) => rows.syncMeta.get(key),
        put: async (record: any) => { rows.syncMeta.set(record.key, record); },
        toCollection: () => ({ primaryKeys: async () => [...rows.syncMeta.keys()] }),
        bulkDelete: async (keys: string[]) => { keys.forEach((key) => rows.syncMeta.delete(key)); },
      },
    } as unknown as BaseDB;

    await clearDatabaseTables(db);
    await ensureDbReady(db);

    expect(rows.orders.size).toBe(0);
    expect([...rows.syncMeta.keys()]).toEqual(["schemaVersion"]);
    expect(deleted).toEqual([]);
  });
});
