import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dexie, { liveQuery } from "dexie";
import { type BaseDB, __resetDbVersionChecks, ensureDbReady } from "../db/storage/baseDb";

/**
 * The database records the schema version it was built with, and a declared version that no longer
 * matches means every row in it was written by a different build of the app. Since nothing here is
 * authoritative — every row is re-derivable from the OMS — the database is dropped and rebuilt
 * rather than migrated, which is the one rule that covers a new store, a dropped index, a changed
 * key path and a changed projection alike.
 */
function fakeDb(options: { recorded?: number; declared: number; open?: boolean }) {
  let isOpen = options.open ?? false;
  let recorded = options.recorded;

  const db = {
    name: "demo-TestDB",
    declaredVersion: options.declared,
    isOpen: () => isOpen,
    open: vi.fn(async () => { isOpen = true; }),
    close: vi.fn(() => { isOpen = false; }),
    syncMeta: {
      get: vi.fn(async () => (recorded === undefined ? undefined : { key: "schemaVersion", version: recorded })),
      put: vi.fn(async (record: any) => { recorded = record.version; }),
    },
  };

  return db as unknown as BaseDB & typeof db;
}

describe("ensureDbReady", () => {
  let deleted: string[];

  beforeEach(() => {
    __resetDbVersionChecks();
    deleted = [];
    vi.spyOn(Dexie, "delete").mockImplementation(async (name: string) => { deleted.push(name); });
  });

  it("opens a database that is closed", async () => {
    const db = fakeDb({ declared: 1, recorded: 1, open: false });

    await ensureDbReady(db);

    expect(db.open).toHaveBeenCalled();
  });

  it("leaves a database alone when the recorded version matches", async () => {
    const db = fakeDb({ declared: 2, recorded: 2, open: true });

    await ensureDbReady(db);

    expect(deleted).toEqual([]);
    expect(db.syncMeta.put).not.toHaveBeenCalled();
  });

  it("drops and rebuilds when the declared version has moved on", async () => {
    const db = fakeDb({ declared: 3, recorded: 2, open: true });

    await ensureDbReady(db);

    expect(deleted).toEqual(["demo-TestDB"]);
    expect(db.close).toHaveBeenCalled();
    expect(db.open).toHaveBeenCalled();
    expect(db.syncMeta.put).toHaveBeenCalledWith(expect.objectContaining({ key: "schemaVersion", version: 3 }));
  });

  it("drops and rebuilds when nothing was ever recorded", async () => {
    // Every install that predates this marker, so the rollout lands everyone on a known state.
    const db = fakeDb({ declared: 1, recorded: undefined, open: true });

    await ensureDbReady(db);

    expect(deleted).toEqual(["demo-TestDB"]);
  });

  it("drops and rebuilds on a rollback, where the declared version is older", async () => {
    const db = fakeDb({ declared: 1, recorded: 2, open: true });

    await ensureDbReady(db);

    expect(deleted).toEqual(["demo-TestDB"]);
  });

  it("checks the version once per database, not on every call", async () => {
    const db = fakeDb({ declared: 2, recorded: 2, open: true });

    await ensureDbReady(db);
    await ensureDbReady(db);
    await ensureDbReady(db);

    expect(db.syncMeta.get).toHaveBeenCalledTimes(1);
  });

  it("still reopens a connection that closed after the version was checked", async () => {
    // Memoizing the whole function would answer "ready" for a dead connection — an OMS switch
    // closes the handle, and Dexie closes it itself on another tab's `versionchange`.
    const db = fakeDb({ declared: 2, recorded: 2, open: true });
    await ensureDbReady(db);
    db.close();

    await ensureDbReady(db);

    expect(db.open).toHaveBeenCalledTimes(1);
    expect(db.isOpen()).toBe(true);
  });

  it("checks each database name separately, so an instance switch is verified too", async () => {
    const first = fakeDb({ declared: 2, recorded: 2, open: true });
    const second = fakeDb({ declared: 2, recorded: 1, open: true });
    (second as any).name = "other-TestDB";

    await ensureDbReady(first);
    await ensureDbReady(second);

    expect(deleted).toEqual(["other-TestDB"]);
  });

  it("never throws when the version check fails, so a bad read cannot block boot", async () => {
    const db = fakeDb({ declared: 2, recorded: 2, open: true });
    db.syncMeta.get = vi.fn(async () => { throw new Error("syncMeta unavailable"); }) as any;

    await expect(ensureDbReady(db)).resolves.toBeUndefined();
  });
});

/**
 * A live query runs its querier in a Dexie zone that refuses writes, and the version check writes
 * when it rebuilds. Live queries call `ensureDbReady` inside their querier (`dbClient.live`,
 * `useSeedData`, `useDbStatus`), so the database's first use is often inside one.
 */
describe("ensureDbReady and live queries", () => {
  const dependencies = Dexie.dependencies as { indexedDB?: unknown };
  let realIndexedDB: unknown;
  const inLiveQuery = () => Boolean((Dexie.Promise as any).PSD?.subscr);

  beforeEach(() => {
    __resetDbVersionChecks();
    vi.spyOn(Dexie, "delete").mockImplementation(() => Dexie.Promise.resolve() as any);
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Without IndexedDB a live query never runs its querier. The database below is a fake, so
    // nothing reads IndexedDB; the live query's zone is Dexie's own.
    realIndexedDB = dependencies.indexedDB;
    dependencies.indexedDB = {};
  });

  afterEach(() => {
    dependencies.indexedDB = realIndexedDB;
    vi.restoreAllMocks();
  });

  /**
   * Nothing recorded, so the check rebuilds. Like Dexie: closed at first, one open shared by every
   * caller, requests answered on a later task, and a write refused inside a live query.
   */
  function unverifiedDb() {
    let recorded: number | undefined;
    let isOpen = false;
    let opening: Promise<void> | null = null;
    const later = <T>(value: () => T) => new Dexie.Promise<T>((resolve) => { setTimeout(() => resolve(value()), 1); });
    const db = {
      name: "demo-LiveQueryTestDB",
      declaredVersion: 1,
      isOpen: () => isOpen,
      open: vi.fn(() => (opening ??= later(() => { isOpen = true; }).then(() => { opening = null; }))),
      close: vi.fn(() => { isOpen = false; }),
      syncMeta: {
        get: vi.fn(() => later(() => (recorded === undefined ? undefined : { key: "schemaVersion", version: recorded }))),
        put: vi.fn((record: any) => {
          if(inLiveQuery()) {
            return Dexie.Promise.reject(Object.assign(new Error("Readwrite transaction in liveQuery context"), { name: "ReadOnlyError" }));
          }

          return later(() => { recorded = record.version; });
        }),
      },
      recorded: () => recorded,
    };

    return db as unknown as BaseDB & typeof db;
  }

  /** The first value a live query emits. */
  function firstValue<T>(querier: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const subscription = liveQuery(querier).subscribe({
        next: (value) => { subscription.unsubscribe(); resolve(value); },
        error: reject,
      });
    });
  }

  it("records the version when a live query is the database's first use", async () => {
    const db = unverifiedDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await firstValue(async () => {
      await ensureDbReady(db);

      return true;
    });

    expect(db.recorded()).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("resumes a querier inside its live query when the check it awaits was started by another caller", async () => {
    // A querier that resumed outside its live query would not have its reads tracked, and the
    // query would never re-run when the table changed.
    const db = unverifiedDb();

    const caller = ensureDbReady(db);
    const resumedInside = await firstValue(async () => {
      await ensureDbReady(db);

      return inLiveQuery();
    });
    await caller;

    expect(resumedInside).toBe(true);
    expect(db.recorded()).toBe(1);
  });
});
