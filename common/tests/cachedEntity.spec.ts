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
      // The unscoped, un-narrowed `newestCursor` path reads through this instead of a full-table
      // scan — see Fix 6. `last()` is the max by `field` among rows where it is defined.
      orderBy: (field: string) => ({
        last: async () => {
          let max: any;
          for (const row of rows) {
            if (row[field] !== undefined && (max === undefined || row[field] > max[field])) max = row;
          }
          return max;
        },
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

  // Fix 6: the unscoped, un-narrowed case must not read every row to find the newest one.
  it("finds the newest cursor value with no scope and no narrowing", async () => {
    const entity = defineCachedEntity(
      stubDb([
        { logId: "A", configId: "C1", createdDate: 300 },
        { logId: "B", configId: "C2", createdDate: 900 },
      ]),
      "dataManagerLogs",
      logs,
    );

    expect(await entity.newestCursor("createdDate")).toBe(900);
  });
});

describe("defineCachedEntity `equals` narrowing", () => {
  it("counts only rows matching equals within a scoped partition", async () => {
    const rows = [
      { logId: "A", configId: "C1", createdDate: 100, logLevel: "INFO" },
      { logId: "B", configId: "C1", createdDate: 200, logLevel: "ERROR" },
      { logId: "C", configId: "C2", createdDate: 300, logLevel: "ERROR" },
    ];
    const entity = defineCachedEntity(stubDb(rows), "dataManagerLogs", logs);

    expect(await entity.count({ field: "configId", value: "C1" }, { logLevel: "ERROR" })).toBe(1);
  });

  it("counts only rows matching equals with no scope", async () => {
    const rows = [
      { logId: "A", configId: "C1", createdDate: 100, logLevel: "INFO" },
      { logId: "B", configId: "C1", createdDate: 200, logLevel: "ERROR" },
      { logId: "C", configId: "C2", createdDate: 300, logLevel: "ERROR" },
    ];
    const entity = defineCachedEntity(stubDb(rows), "dataManagerLogs", logs);

    expect(await entity.count(undefined, { logLevel: "ERROR" })).toBe(2);
  });

  /**
   * The bug this guards: a filter applied server-side (e.g. via a cursor domain's `paramsOf`)
   * but not to the cursor computation takes the cursor from the newest row of ANY value of that
   * field. Here the scope-only newest is the ERROR row (900); narrowed to `logLevel: "INFO"` it
   * must be the INFO row (100) instead — a different value, proving `equals` actually narrows.
   */
  it("finds the newest cursor value matching equals within a scoped partition", async () => {
    const rows = [
      { logId: "A", configId: "C1", createdDate: 100, logLevel: "INFO" },
      { logId: "B", configId: "C1", createdDate: 900, logLevel: "ERROR" },
    ];
    const entity = defineCachedEntity(stubDb(rows), "dataManagerLogs", logs);

    expect(
      await entity.newestCursor("createdDate", { field: "configId", value: "C1" }, { logLevel: "INFO" }),
    ).toBe(100);
  });

  it("finds the newest cursor value matching equals with no scope", async () => {
    const rows = [
      { logId: "A", configId: "C1", createdDate: 100, logLevel: "INFO" },
      { logId: "B", configId: "C2", createdDate: 900, logLevel: "ERROR" },
    ];
    const entity = defineCachedEntity(stubDb(rows), "dataManagerLogs", logs);

    expect(await entity.newestCursor("createdDate", undefined, { logLevel: "INFO" })).toBe(100);
  });
});
