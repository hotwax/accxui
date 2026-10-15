import { describe, expect, it, vi } from "vitest";

vi.mock("dexie", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, liveQuery: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) };
});

import { useDbStatus } from "../db/composables/useDbStatus";

const stubDb = () => ({
  getTableNames: () => ["syncMeta", "as"],
  table: () => ({ count: async () => 0, toArray: async () => [] }),
}) as any;

const actions = { resyncDomain: vi.fn(async () => {}), resyncAll: vi.fn(async () => {}) };

describe("useDbStatus catalog source", () => {
  it("accepts a static array, unchanged", () => {
    const { domains } = useDbStatus(
      stubDb(),
      [{ name: "a", table: "as", label: "Alpha", syncClass: "B" }],
      actions,
    );

    expect(domains.value).toEqual([]); // not yet emitted; the array is the source, not the rows
  });

  it("accepts an async source and resolves it", async () => {
    const source = vi.fn(async () => [{ name: "a", label: "Alpha", syncClass: "B" as const }]);

    const { catalogLoaded } = useDbStatus(stubDb(), source, actions);
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true));

    expect(source).toHaveBeenCalledTimes(1);
  });

  /**
   * The worker may not be up when a status view mounts. A rejected catalog must leave the card
   * empty and loaded, not spinning forever.
   */
  it("settles when the async source rejects", async () => {
    const source = vi.fn(async () => { throw new Error("worker not started"); });

    const { catalogLoaded, domains } = useDbStatus(stubDb(), source, actions);
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true));

    expect(domains.value).toEqual([]);
  });

  it("queries the specified table when catalog item contains table property", async () => {
    const tableSpy = vi.fn(() => ({ count: async () => 42 }));
    const db = {
      getTableNames: () => ["syncMeta", "productStores"],
      table: tableSpy,
    } as any;
    const source = vi.fn(async () => [{ name: "productStore", table: "productStores", label: "Product Stores", syncClass: "B" as const }]);

    const { catalogLoaded } = useDbStatus(db, source, actions);
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true));

    expect(source).toHaveBeenCalledTimes(1);
  });
});

/**
 * A client whose `liveRead` runs its read once against fixture tables, recording the tables the
 * transaction was opened over.
 */
function fakeClient(tables: Record<string, any[]>) {
  const opened: string[][] = [];
  const tx = {
    entity: (table: string) => ({
      all: async () => tables[table] ?? [],
      count: async () => (tables[table] ?? []).length,
    }),
  };
  const client = {
    tableNames: () => Object.keys(tables),
    liveRead: (names: string[], read: (tx: any) => Promise<unknown>) => ({
      subscribe: ({ next }: { next: (rows: any) => void }) => {
        opened.push(names);
        read(tx).then(next);
        return { unsubscribe: () => {} };
      },
    }),
    read: async (names: string[], read: (tx: any) => Promise<unknown>) => {
      opened.push(names);
      return read(tx);
    },
  } as any;
  return { client, opened };
}

describe("useDbStatus rows", () => {
  it("counts each catalogued table and its sync time in one read through the client", async () => {
    const { client, opened } = fakeClient({
      syncMeta: [{ key: "loginSync:status", timestamp: 100 }, { key: "domain:status", timestamp: 200 }],
      statuses: [{ statusId: "A" }, { statusId: "B" }],
      enums: [],
    });

    const { domains, loaded } = useDbStatus(client, [
      { name: "status", table: "statuses", label: "Statuses", syncClass: "B" },
      { name: "enum", table: "enums", label: "Enums", syncClass: "B" },
    ], actions);
    await vi.waitFor(() => expect(loaded.value).toBe(true));

    expect(opened).toEqual([["syncMeta", "statuses", "enums"]]);
    expect(domains.value.map(({ name, count, syncedAt, status }) => ({ name, count, syncedAt, status }))).toEqual([
      // `domain:` wins over `loginSync:` for the same domain.
      { name: "status", count: 2, syncedAt: 200, status: "success" },
      { name: "enum", count: 0, syncedAt: null, status: "none" },
    ]);
  });

  it("counts a table the database lacks as 0 without opening the transaction over it", async () => {
    const { client, opened } = fakeClient({ syncMeta: [], statuses: [{ statusId: "A" }] });

    const { domains, loaded } = useDbStatus(client, [
      { name: "status", table: "statuses", label: "Statuses", syncClass: "B" },
      { name: "ghost", table: "ghosts", label: "Ghosts", syncClass: "A" },
    ], actions);
    await vi.waitFor(() => expect(loaded.value).toBe(true));

    expect(opened).toEqual([["syncMeta", "statuses"]]);
    expect(domains.value.map(({ name, count, status }) => ({ name, count, status }))).toEqual([
      { name: "status", count: 1, status: "success" },
      { name: "ghost", count: 0, status: "empty" },
    ]);
  });
});
