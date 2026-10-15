import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

/**
 * A reactive query (shop A to shop B) re-subscribes. Until the new query's first emit, the list
 * must be empty and not hydrated, or shop A's rows render under shop B with no skeleton.
 */
const harness = vi.hoisted(() => ({
  emit: {} as Record<string, (rows: any[]) => void>,
  unsubscribed: [] as string[],
}));

vi.mock("../db/schema/appDbRegistry", () => ({
  getAppDb: () => ({
    client: () => ({
      entity: () => ({
        live: (options: any) => ({
          subscribe: ({ next }: any) => {
            const shopId = options.scope.value;
            harness.emit[shopId] = next;
            return { unsubscribe: () => harness.unsubscribed.push(shopId) };
          },
        }),
      }),
    }),
  }),
}));

/** The wrapper a `BaseDB` passed to useLiveEntity goes through; returns a client that records its table. */
const wrapped = vi.hoisted(() => ({ dbs: [] as unknown[], tables: [] as string[] }));
vi.mock("../db/storage/dbClient", () => ({
  dbClient: (db: unknown) => {
    wrapped.dbs.push(db);
    return {
      entity: (table: string) => ({
        live: () => ({
          subscribe: ({ next }: any) => {
            wrapped.tables.push(table);
            next([{ from: "wrapped" }]);
            return { unsubscribe: () => undefined };
          },
        }),
      }),
    };
  },
}));

import { useLiveEntity } from "../db/composables/useLiveEntity";

describe("useLiveEntity with a reactive query", () => {
  it("re-subscribes on a scope change without showing the old scope's rows", async () => {
    const shopId = ref("A");
    const scope = effectScope();
    const list = scope.run(() => useLiveEntity("ledger", () => ({ scope: { field: "shopId", value: shopId.value } })))!;

    harness.emit.A([{ shopId: "A" }]);
    expect(list.records.value).toEqual([{ shopId: "A" }]);
    expect(list.hydrated.value).toBe(true);

    shopId.value = "B";
    await nextTick();
    expect(harness.unsubscribed).toEqual(["A"]);
    expect(list.records.value).toEqual([]);
    expect(list.hydrated.value).toBe(false);

    harness.emit.B([{ shopId: "B" }]);
    expect(list.records.value).toEqual([{ shopId: "B" }]);
    expect(list.hydrated.value).toBe(true);
    scope.stop();
  });
});

describe("useLiveEntity database source", () => {
  it("reads through a DbClient passed explicitly, without wrapping it", () => {
    const tables: string[] = [];
    const client = {
      liveRead: () => undefined,
      entity: (table: string) => ({
        live: () => ({
          subscribe: ({ next }: any) => {
            tables.push(table);
            next([{ from: "client" }]);
            return { unsubscribe: () => undefined };
          },
        }),
      }),
    } as any;
    wrapped.dbs = [];

    const scope = effectScope();
    const list = scope.run(() => useLiveEntity(client, "facilities"))!;

    expect(tables).toEqual(["facilities"]);
    expect(list.records.value).toEqual([{ from: "client" }]);
    expect(wrapped.dbs).toEqual([]);
    scope.stop();
  });

  it("still accepts a BaseDB, wrapping it in a dbClient", () => {
    const db = { name: "OMS-other" } as any;
    wrapped.dbs = [];
    wrapped.tables = [];

    const scope = effectScope();
    const list = scope.run(() => useLiveEntity(db, "facilities"))!;

    expect(wrapped.dbs).toEqual([db]);
    expect(wrapped.tables).toEqual(["facilities"]);
    expect(list.records.value).toEqual([{ from: "wrapped" }]);
    scope.stop();
  });
});

describe("useLiveEntity table guard", () => {
  /** A client over a database with `statuses` and `syncMeta`, whose live reads never emit. */
  const knownClient = () => ({
    liveRead: () => undefined,
    name: () => "OMS-AppDB",
    tableNames: () => ["syncMeta", "statuses"],
    entity: () => ({ live: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) }),
  }) as any;

  it("fails at the call on a table the database does not have, naming both", () => {
    const scope = effectScope();

    expect(() => scope.run(() => useLiveEntity(knownClient(), "statuss")))
      .toThrow('[db] useLiveEntity: "statuss" is not a table in OMS-AppDB.');
    scope.stop();
  });

  it("subscribes normally to a table the database has", () => {
    const scope = effectScope();

    expect(() => scope.run(() => useLiveEntity(knownClient(), "statuses"))).not.toThrow();
    scope.stop();
  });
});

describe("useLiveEntity syncDomain", () => {
  /** A client whose `liveRead` hands the reader the rows and, when present, the domain's login marker. */
  const markerClient = (rows: any[], markers: Record<string, unknown>) => {
    const reads: { tables: string[]; markerKey?: string }[] = [];
    const client = {
      liveRead: (tables: string[], read: (tx: any) => Promise<unknown>) => ({
        subscribe: ({ next }: any) => {
          const entry: { tables: string[]; markerKey?: string } = { tables };
          reads.push(entry);
          read({
            entity: (table: string) => ({
              query: async () => (table === "statuses" ? rows : []),
              get: async (key: string) => { entry.markerKey = key; return markers[key]; },
            }),
          }).then(next);
          return { unsubscribe: () => undefined };
        },
      }),
      entity: () => { throw new Error("syncDomain reads go through liveRead"); },
    } as any;
    return { client, reads };
  };

  it("reads the rows and the domain's login marker in one transaction, reporting synced", async () => {
    const { client, reads } = markerClient([], { "loginSync:status": { synced: true } });
    const scope = effectScope();
    const list = scope.run(() => useLiveEntity(client, "statuses", { syncDomain: "status" }))!;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reads).toEqual([{ tables: ["statuses", "syncMeta"], markerKey: "loginSync:status" }]);
    expect(list.records.value).toEqual([]);
    expect(list.synced.value).toBe(true);
    scope.stop();
  });

  it("is not synced while the marker is missing, even with rows", async () => {
    const { client } = markerClient([{ statusId: "A" }], {});
    const scope = effectScope();
    const list = scope.run(() => useLiveEntity(client, "statuses", { syncDomain: "status" }))!;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(list.records.value).toEqual([{ statusId: "A" }]);
    expect(list.synced.value).toBe(false);
    scope.stop();
  });
});
