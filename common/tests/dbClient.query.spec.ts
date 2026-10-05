import { describe, expect, it } from "vitest";
import { dbClient } from "../db/storage/dbClient";
import type { BaseDB } from "../db/storage/baseDb";

/**
 * A minimal in-memory stand-in for one Dexie table: enough of `where` / `orderBy` / `between` /
 * `equals` to exercise every read path `query` can take, keyed on the declared index names.
 */
function memoryTable(rows: any[], indexes: string[]) {
  const fieldsOf = (path: string) => path.replace(/^\[|\]$/g, "").split("+");
  const valueAt = (row: any, path: string) => {
    const fields = fieldsOf(path);
    return fields.length === 1 ? row[fields[0]] : fields.map((field) => row[field]);
  };
  const compare = (a: any, b: any): number => {
    if (Array.isArray(a)) {
      for (let i = 0; i < a.length; i++) {
        const c = compare(a[i], b[i]);
        if (c) return c;
      }
      return 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const indexed = (path: string) =>
    rows
      .filter((row) => fieldsOf(path).every((field) => row[field] !== undefined))
      .sort((a, b) => compare(valueAt(a, path), valueAt(b, path)));
  const collection = (list: any[]) => ({ toArray: async () => list });

  return {
    schema: { primKey: { name: "id" }, indexes: indexes.map((name) => ({ name })) },
    toArray: async () => [...rows],
    orderBy: (path: string) => collection(indexed(path)),
    where: (path: string) => ({
      equals: (value: any) => collection(indexed(path).filter((row) => compare(valueAt(row, path), value) === 0)),
      between: (lower: any, upper: any) => collection(indexed(path).filter((row) =>
        compare(valueAt(row, path), lower) >= 0 && compare(valueAt(row, path), upper) <= 0)),
    }),
  };
}

function clientOver(rows: any[], indexes: string[]) {
  const table = memoryTable(rows, indexes);
  const db = { table: () => table } as unknown as BaseDB;
  return dbClient(db).entity<any>("messages");
}

const ROWS = [
  { id: "1", remoteId: "R1", typeId: "A", initDate: 100 },
  { id: "2", remoteId: "R1", typeId: "B", initDate: 300 },
  { id: "3", remoteId: "R1", typeId: "A", initDate: 200 },
  { id: "4", remoteId: "R2", typeId: "A", initDate: 400 },
];

describe("dbClient.query", () => {
  it("orders by dateField newest first by default", async () => {
    const entity = clientOver(ROWS, ["initDate"]);
    const rows = await entity.query({ dateField: "initDate", limit: 2 });
    expect(rows.map((row) => row.id)).toEqual(["4", "2"]);
  });

  it("orders oldest first when asked", async () => {
    const entity = clientOver(ROWS, ["initDate"]);
    const rows = await entity.query({ dateField: "initDate", order: "asc" });
    expect(rows.map((row) => row.id)).toEqual(["1", "3", "2", "4"]);
  });

  it("applies scope AND every equals key", async () => {
    for (const indexes of [["remoteId"], ["[remoteId+typeId]"], ["[remoteId+typeId+initDate]"], []]) {
      const entity = clientOver(ROWS, indexes);
      const rows = await entity.query({
        scope: { field: "remoteId", value: "R1" },
        equals: { typeId: "A" },
        dateField: "initDate",
      });
      expect(rows.map((row) => row.id), indexes.join()).toEqual(["3", "1"]);
    }
  });

  it("applies every equals key when there is no scope", async () => {
    const entity = clientOver(ROWS, ["remoteId"]);
    const rows = await entity.query({ equals: { remoteId: "R1", typeId: "B" } });
    expect(rows.map((row) => row.id)).toEqual(["2"]);
  });

  it("bounds by since/until inside a scope", async () => {
    const entity = clientOver(ROWS, ["remoteId"]);
    const rows = await entity.query({
      scope: { field: "remoteId", value: "R1" },
      dateField: "initDate",
      since: 150,
      until: 300,
    });
    expect(rows.map((row) => row.id)).toEqual(["2", "3"]);
  });

  it("counts with the same semantics as query", async () => {
    const entity = clientOver(ROWS, ["remoteId"]);
    expect(await entity.count({ scope: { field: "remoteId", value: "R1" }, equals: { typeId: "A" } })).toBe(2);
  });
});
