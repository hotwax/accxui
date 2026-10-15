import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `dbClient.liveRead`: the multi-table live read seed lookups use. The live query is replaced by
 * one run of its querier, so these check what one emission reads and in what order, not Dexie's
 * change tracking.
 */
const calls = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock("dexie", () => ({
  liveQuery: (querier: () => Promise<unknown>) => ({
    subscribe: ({ next, error }: { next: (value: any) => void; error?: (err: unknown) => void }) => {
      querier().then(next, error);
      return { unsubscribe: () => undefined };
    },
  }),
}));

vi.mock("../db/storage/baseDb", () => ({
  ensureDbReady: async (db: any) => { calls.log.push(`gate:${db.name}`); },
}));

import { dbClient } from "../db/storage/dbClient";
import type { BaseDB } from "../db/storage/baseDb";

function fakeDb(name: string, tables: Record<string, any[]>) {
  return {
    name,
    table: (table: string) => ({
      toArray: async () => { calls.log.push(`read:${table}`); return tables[table] ?? []; },
      get: async (key: string) => {
        calls.log.push(`get:${table}`);
        return (tables[table] ?? []).find((row) => row.key === key);
      },
    }),
    transaction: vi.fn(async (_mode: string, _tables: string[], run: () => Promise<unknown>) => {
      calls.log.push("tx:begin");
      const result = await run();
      calls.log.push("tx:end");
      return result;
    }),
  };
}

const emitted = <R>(observable: any) =>
  new Promise<R>((resolve, reject) => observable.subscribe({ next: resolve, error: reject }));

beforeEach(() => {
  calls.log = [];
});

describe("dbClient.liveRead", () => {
  it("reads every table in one read transaction, behind one gate", async () => {
    const db = fakeDb("OMS-app", {
      statuses: [{ statusId: "ORDER_APPROVED" }],
      syncMeta: [{ key: "loginSync:status", synced: true }],
    });

    const result = await emitted<{ rows: any[]; marker: any }>(
      dbClient(db as unknown as BaseDB).liveRead(["statuses", "syncMeta"], async (tx) => {
        const [rows, marker] = await Promise.all([
          tx.entity("statuses").all(),
          tx.entity("syncMeta").get("loginSync:status"),
        ]);
        return { rows, marker };
      }),
    );

    expect(result.rows).toEqual([{ statusId: "ORDER_APPROVED" }]);
    expect(result.marker).toEqual({ key: "loginSync:status", synced: true });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.mock.calls[0].slice(0, 2)).toEqual(["r", ["statuses", "syncMeta"]]);
    // The gate runs once, before the transaction; reads inside it are not gated again.
    expect(calls.log.filter((entry) => entry.startsWith("gate:"))).toEqual(["gate:OMS-app"]);
    expect(calls.log.indexOf("gate:OMS-app")).toBeLessThan(calls.log.indexOf("tx:begin"));
    expect(calls.log.indexOf("read:statuses")).toBeGreaterThan(calls.log.indexOf("tx:begin"));
    expect(calls.log.indexOf("get:syncMeta")).toBeLessThan(calls.log.indexOf("tx:end"));
  });

  it("short-circuits a missing key inside the transaction as EntityClient does", async () => {
    const db = fakeDb("OMS-app", { syncMeta: [] });

    const marker = await emitted(
      dbClient(db as unknown as BaseDB).liveRead(["syncMeta"], (tx) => tx.entity("syncMeta").get("")),
    );

    expect(marker).toBeUndefined();
    expect(calls.log).not.toContain("get:syncMeta");
  });

  it("resolves the current database on each run when given a resolver", async () => {
    const first = fakeDb("OMS1-app", { statuses: [{ statusId: "A" }] });
    const second = fakeDb("OMS2-app", { statuses: [{ statusId: "B" }] });
    let active = first;
    const client = dbClient(() => active as unknown as BaseDB);
    const read = () => client.liveRead(["statuses"], (tx) => tx.entity("statuses").all());

    expect(await emitted(read())).toEqual([{ statusId: "A" }]);
    expect(client.name()).toBe("OMS1-app");
    active = second;
    expect(await emitted(read())).toEqual([{ statusId: "B" }]);
    expect(client.name()).toBe("OMS2-app");
    expect(second.transaction).toHaveBeenCalledTimes(1);
  });

  it("answers a one-shot read through the same gate and transaction", async () => {
    const db = fakeDb("OMS-app", { statuses: [{ statusId: "A" }, { statusId: "B" }] });

    const count = await dbClient(db as unknown as BaseDB).read(["statuses"], async (tx) => {
      const rows = await tx.entity("statuses").all();
      return rows.length;
    });

    expect(count).toBe(2);
    expect(db.transaction.mock.calls[0].slice(0, 2)).toEqual(["r", ["statuses"]]);
    expect(calls.log).toEqual(["gate:OMS-app", "tx:begin", "read:statuses", "tx:end"]);
  });

  it("surfaces a failing read as the observable's error", async () => {
    const db = fakeDb("OMS-app", {});
    db.transaction.mockRejectedValueOnce(new Error("NotFoundError"));

    await expect(
      emitted(dbClient(db as unknown as BaseDB).liveRead(["missing"], (tx) => tx.entity("missing").all())),
    ).rejects.toThrow("NotFoundError");
  });
});
