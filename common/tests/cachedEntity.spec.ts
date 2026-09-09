import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { defineCachedEntity } from "../db/sync/snapshotDomain";

const logs = defineEntity({
  primaryKey: "logId",
  fields: { logId: "text", configId: "text", createdDate: "date", finishDateTime: "date" },
  indexes: ["configId", "createdDate"],
});

/** An in-memory stand-in for one Dexie table, enough for the read paths under test. */
function stubDb(rows: any[]) {
  const collection = (subset: any[]) => ({
    toArray: async () => subset,
    primaryKeys: async () => subset.map((r) => r.logId),
    count: async () => subset.length,
    filter: (fn: (r: any) => boolean) => collection(subset.filter(fn)),
    limit: (n: number) => collection(subset.slice(0, n)),
    reverse: () => collection([...subset].reverse()),
  });

  return {
    table: () => ({
      ...collection(rows),
      toCollection: () => collection(rows),
      where: (field: string) => ({
        equals: (value: unknown) => collection(rows.filter((r) => r[field] === value)),
      }),
      bulkPut: async () => {},
      bulkDelete: async () => {},
      delete: async () => {},
    }),
    transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
  } as any;
}

const ROWS = [
  { logId: "L1", configId: "C1", createdDate: 300, finishDateTime: 350 },
  { logId: "L2", configId: "C1", createdDate: 500 },
  { logId: "L3", configId: "C2", createdDate: 900 },
];

describe("defineCachedEntity cursor operations", () => {
  it("counts every row when no scope is given", async () => {
    const entity = defineCachedEntity(stubDb(ROWS), "dataManagerLogs", logs);

    expect(await entity.count()).toBe(3);
  });

  it("counts only the scoped partition", async () => {
    const entity = defineCachedEntity(stubDb(ROWS), "dataManagerLogs", logs);

    expect(await entity.count({ field: "configId", value: "C1" })).toBe(2);
  });

  it("finds the newest cursor value in a scope", async () => {
    const entity = defineCachedEntity(stubDb(ROWS), "dataManagerLogs", logs);

    expect(await entity.newestCursor("createdDate", { field: "configId", value: "C1" })).toBe(500);
  });

  // An empty scope must be undefined, NOT 0: a 0 cursor would be sent as a real lower bound and
  // the first sync would fetch only rows after the epoch boundary instead of seeding the window.
  it("returns undefined for an empty scope rather than zero", async () => {
    const entity = defineCachedEntity(stubDb([]), "dataManagerLogs", logs);

    expect(await entity.newestCursor("createdDate")).toBeUndefined();
  });

  it("ignores rows whose cursor field is absent", async () => {
    const entity = defineCachedEntity(
      stubDb([{ logId: "L9", configId: "C1" }, { logId: "L8", configId: "C1", createdDate: 42 }]),
      "dataManagerLogs",
      logs,
    );

    expect(await entity.newestCursor("createdDate", { field: "configId", value: "C1" })).toBe(42);
  });
});
