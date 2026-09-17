import { beforeEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { type BaseDB, __resetDbVersionChecks, ensureDbReady } from "../db/baseDb";

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
