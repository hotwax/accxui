import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessStub = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  setDomains: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  syncAll: vi.fn(async () => {}),
  syncDomainNow: vi.fn(async () => 3),
  refetchOne: vi.fn(async () => 1),
  domains: vi.fn(async () => []),
  catalog: vi.fn(async () => []),
  stop: vi.fn(),
}));
const workerStub = vi.hoisted(() => ({ onmessage: null as any }));

vi.mock("../core/workerFactory", () => ({
  WorkerFactory: { createWorker: () => ({ api: harnessStub, terminate: vi.fn(), worker: workerStub }) },
}));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    getToken: () => "tok",
    getMaargURL: () => "https://x.test/",
    getOMSInstanceName: () => "demo",
  },
}));
vi.mock("../db/sync/channels", () => ({
  createTokenPublisher: () => ({ publish: vi.fn(), close: vi.fn() }),
}));

import { setupAppDbSync } from "../db/sync/setupAppDbSync";
import { cacheScopeKey } from "../db/sync/reconciliation";
import { createSyncService, __resetErrorState, serviceState } from "../db/sync/syncService";
import type { AppDb } from "../db/schema/defineAppDb";

const fakeAppDb = () => ({
  raw: () => ({
    name: "test-db",
    isOpen: () => true,
    open: async () => {},
    close: () => {},
    getTableNames: () => [],
    table: () => ({ clear: async () => {} }),
    transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
    syncMeta: {
      get: async () => ({ key: "dbShapeVersion", version: 2 }),
      put: async () => {},
      delete: async () => {},
      toCollection: () => ({ primaryKeys: async () => [] }),
      bulkDelete: async () => {},
    },
  }),
}) as unknown as AppDb;

/** Deliver a worker status message the way the real worker does. */
const post = (data: Record<string, any>) => workerStub.onmessage?.({ data } as MessageEvent);

/**
 * The error-surfacing contract, driven through the REAL `createSyncService` so both the service and
 * `setupAppDbSync` see every status message. Pinned before consolidating the two copies of the
 * domain/scope bookkeeping onto `syncService`, which owns it.
 */
describe("app db sync error surfacing", () => {
  beforeEach(async () => {
    __resetErrorState();
    workerStub.onmessage = null;
  });

  const start = async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();
    return sync;
  };

  it("surfaces a domain failure", async () => {
    await start();

    post({ type: "sync-error", domain: "carrier", message: "boom" });

    expect(serviceState.errors.carrier).toBe("boom");
  });

  it("shows the newest scoped failure when two scopes fail in order", async () => {
    await start();

    post({ type: "sync-error", domain: "carrier", scope: "partyId=A", message: "first" });
    post({ type: "sync-error", domain: "carrier", scope: "partyId=B", message: "second" });

    expect(serviceState.errors.carrier).toBe("second");
  });

  it("clears only the scope a targeted refetch verified", async () => {
    await start();

    post({ type: "sync-error", domain: "carrier", scope: "partyId=A", message: "first" });
    post({ type: "sync-error", domain: "carrier", scope: "partyId=B", message: "second" });
    post({ type: "refetch-end", domain: "carrier", scope: "partyId=B", written: 1 });

    // B recovered; A never did, so the domain stays in error carrying A's message.
    expect(serviceState.errors.carrier).toBe("first");
  });

  it("clears a failed mutation refetch once that record refetches successfully", async () => {
    const sync = await start();
    const pk = { enumId: "X" };
    harnessStub.refetchOne.mockImplementationOnce(async () => {
      // The worker reports the failure before its Comlink promise rejects.
      post({ type: "sync-error", domain: "enum", scope: cacheScopeKey(pk), message: "boom" });
      throw new Error("boom");
    });

    await expect(sync.refreshAfterMutation("enum", pk)).rejects.toThrow();
    post({ type: "refetch-end", domain: "enum", scope: cacheScopeKey(pk), written: 1 });

    expect(serviceState.errors.enum).toBeUndefined();
  });

  it("clears the whole domain when a full snapshot succeeds", async () => {
    await start();

    post({ type: "sync-error", domain: "carrier", scope: "partyId=A", message: "first" });
    post({ type: "sync-end", domain: "carrier", written: 3 });

    expect(serviceState.errors.carrier).toBeUndefined();
  });

  it("surfaces an auth failure as a domain error too", async () => {
    await start();

    post({ type: "auth-error", domain: "carrier", message: "401 unauthorized" });

    expect(serviceState.errors.carrier).toBe("401 unauthorized");
  });

  it("records the written count a successful sync reports", async () => {
    const sync = await start();

    post({ type: "sync-end", domain: "carrier", written: 7 });

    expect(sync.bootstrapState.written.carrier).toBe(7);
  });
});

describe("serviceState.syncedAt", () => {
  beforeEach(async () => {
    __resetErrorState();
    workerStub.onmessage = null;
    for (const key of Object.keys(serviceState.syncedAt)) delete serviceState.syncedAt[key];
  });

  it("records the timestamp the worker posted, per domain", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();

    post({ type: "sync-end", domain: "shopifyTransferSync", written: 4, at: 1_700_000_000_000 });

    expect(serviceState.syncedAt.shopifyTransferSync).toBe(1_700_000_000_000);
  });

  it("keeps domains independent", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();

    post({ type: "sync-end", domain: "syncRun", written: 1, at: 1_000 });
    post({ type: "sync-end", domain: "shopifyTransferSync", written: 2, at: 2_000 });

    expect(serviceState.syncedAt.syncRun).toBe(1_000);
    expect(serviceState.syncedAt.shopifyTransferSync).toBe(2_000);
  });

  // A screen waiting on syncedAt asks whether ITS set was fetched; one re-read record says nothing.
  it("does not count a targeted refetch as a pass", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();

    post({ type: "refetch-end", domain: "serviceJob", written: 1, scope: "jobName=x", at: 5_000 });

    expect(serviceState.syncedAt.serviceJob).toBeUndefined();
  });

  // Shop A's pass finishing after the screen moved to shop B must not mark B as fetched.
  it("ignores a pass for an activation that is no longer current", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();

    post({ type: "sync-end", domain: "syncRun", written: 1, at: 1_000, current: false });

    expect(serviceState.syncedAt.syncRun).toBeUndefined();
  });

  it("forgets a domain the worker reset when its screen left or re-scoped", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();
    post({ type: "sync-end", domain: "syncRun", written: 1, at: 1_000 });
    post({ type: "sync-end", domain: "facility", written: 1, at: 1_000 });

    post({ type: "activations-reset", domains: ["syncRun"] });

    expect(serviceState.syncedAt.syncRun).toBeUndefined();
    expect(serviceState.syncedAt.facility).toBe(1_000);
  });

  it("clears every domain when sync stops, so the next login starts unfetched", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();
    post({ type: "sync-end", domain: "syncRun", written: 1, at: 1_000 });

    await sync.stopAppDbSync();

    expect(serviceState.syncedAt).toEqual({});
  });
});

describe("view-scoped domain activation", () => {
  beforeEach(async () => {
    __resetErrorState();
    workerStub.onmessage = null;
    harnessStub.setDomains.mockClear();
  });

  const started = async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();
    return sync;
  };

  it("hands the domain set to the worker and reports ready", async () => {
    const sync = await started();

    await sync.activateSyncDomains([{ name: "shopifyTransferSync", args: { shopId: "1" } }], "transferView");

    expect(harnessStub.setDomains).toHaveBeenCalledWith([
      { name: "shopifyTransferSync", args: { shopId: "1" } },
    ]);
    expect(sync.syncDomainsReady.value).toBe(true);
  });

  it("re-scopes without a second activation call", async () => {
    const sync = await started();

    await sync.activateSyncDomains([{ name: "syncRun", args: { shopId: "1" } }], "runsView");
    await sync.activateSyncDomains([{ name: "syncRun", args: { shopId: "2" } }], "runsView");

    expect(harnessStub.setDomains).toHaveBeenCalledTimes(2);
    expect(harnessStub.setDomains).toHaveBeenLastCalledWith([
      { name: "syncRun", args: { shopId: "2" } },
    ]);
  });

  it("clears the set and drops readiness on deactivate", async () => {
    const sync = await started();
    await sync.activateSyncDomains([{ name: "syncRun" }], "runsView");
    harnessStub.setDomains.mockClear();

    await sync.deactivateSyncDomains("runsView");

    expect(harnessStub.setDomains).toHaveBeenCalledWith([]);
    expect(sync.syncDomainsReady.value).toBe(false);
  });

  it("does not call the worker when deactivating with nothing active", async () => {
    const sync = await started();
    harnessStub.setDomains.mockClear();

    await sync.deactivateSyncDomains();

    expect(harnessStub.setDomains).not.toHaveBeenCalled();
  });

  it("does not resurrect readiness when a teardown lands mid-activation", async () => {
    const sync = await started();
    let releaseSetDomains: () => void = () => {};
    harnessStub.setDomains.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseSetDomains = () => resolve(); }));

    const activation = sync.activateSyncDomains([{ name: "syncRun" }], "runsView");
    await sync.deactivateSyncDomains();   // lands while setDomains is still in flight
    releaseSetDomains();
    await activation;

    expect(sync.syncDomainsReady.value).toBe(false);
  });

  it("lets the newest activation win when two overlap, and rejects viewA's late teardown", async () => {
    const sync = await started();
    let releaseFirst: () => void = () => {};
    harnessStub.setDomains.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseFirst = () => resolve(); }));

    // viewA's activation is left in flight (its setDomains never resolves in this test) while
    // viewB activates and wins.
    const first = sync.activateSyncDomains([{ name: "syncRun" }], "viewA");
    await sync.activateSyncDomains([{ name: "shopifyTransferSync" }], "viewB");

    expect(sync.syncDomainsReady.value).toBe(true);
    expect(harnessStub.setDomains).toHaveBeenLastCalledWith([{ name: "shopifyTransferSync" }]);

    // viewA's own teardown, arriving after it was superseded, must still be rejected (owner check).
    harnessStub.setDomains.mockClear();
    await sync.deactivateSyncDomains("viewA");
    expect(harnessStub.setDomains).not.toHaveBeenCalled();
    expect(sync.syncDomainsReady.value).toBe(true);

    // viewB now legitimately tears down.
    await sync.deactivateSyncDomains("viewB");
    expect(sync.syncDomainsReady.value).toBe(false);

    // viewA's activation, started long ago, finally resolves. Its stale continuation must not
    // resurrect readiness now that the worker has been torn down — this is what the
    // `generation !== activationGeneration` guard in `activateSyncDomains` exists to prevent.
    releaseFirst();
    await first;

    expect(sync.syncDomainsReady.value).toBe(false);
  });
});

describe("late teardown", () => {
  beforeEach(async () => {
    __resetErrorState();
    workerStub.onmessage = null;
    harnessStub.setDomains.mockClear();
  });

  const started = async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();
    return sync;
  };

  const VIEW_A = [{ name: "shopifyProductSync", args: { shopId: "1" } }];
  const VIEW_B = [{ name: "shopifyTransferSync", args: { shopId: "1" } }];

  it("ignores a teardown from a screen that no longer owns the worker", async () => {
    const sync = await started();
    await sync.activateSyncDomains(VIEW_A, "productSyncView");
    await sync.activateSyncDomains(VIEW_B, "transferSyncView"); // Ionic: B's willEnter beats A's didLeave
    harnessStub.setDomains.mockClear();

    await sync.deactivateSyncDomains("productSyncView");        // A's didLeave, arriving late

    expect(harnessStub.setDomains).not.toHaveBeenCalled();
    expect(sync.syncDomainsReady.value).toBe(true);
  });

  it("rejects a teardown from a superseded instance of the same screen", async () => {
    const sync = await started();
    // Three routes share the ShopifyInventorySync component and navigate to each other.
    const instanceA = sync.createSyncDomainOwner("shopifyInventorySyncView");
    const instanceB = sync.createSyncDomainOwner("shopifyInventorySyncView");
    expect(instanceA).not.toBe(instanceB);

    await sync.activateSyncDomains(VIEW_A, instanceA);
    await sync.activateSyncDomains(VIEW_B, instanceB);   // B's willEnter
    harnessStub.setDomains.mockClear();

    await sync.deactivateSyncDomains(instanceA);         // A's didLeave, arriving late

    expect(harnessStub.setDomains).not.toHaveBeenCalled();
    expect(sync.syncDomainsReady.value).toBe(true);
  });

  it("retires the domains when the owner still holds the worker", async () => {
    const sync = await started();
    await sync.activateSyncDomains(VIEW_B, "transferSyncView");
    harnessStub.setDomains.mockClear();

    await sync.deactivateSyncDomains("transferSyncView");

    expect(harnessStub.setDomains).toHaveBeenCalledWith([]);
    expect(sync.syncDomainsReady.value).toBe(false);
  });

  it("retires an owner whose domain set changed while it was open", async () => {
    const sync = await started();
    // ShopifyProductSync's real shape: activate, then re-activate as job names resolve.
    await sync.activateSyncDomains([{ name: "serviceJobRun", args: { jobNames: [] } }], "productSyncView");
    await sync.activateSyncDomains([{ name: "serviceJobRun", args: { jobNames: ["a", "b"] } }], "productSyncView");
    harnessStub.setDomains.mockClear();

    await sync.deactivateSyncDomains("productSyncView");

    expect(harnessStub.setDomains).toHaveBeenCalledWith([]);
  });

  it("still clears unconditionally when given no owner", async () => {
    const sync = await started();
    await sync.activateSyncDomains(VIEW_A, "productSyncView");
    harnessStub.setDomains.mockClear();

    await sync.deactivateSyncDomains();

    expect(harnessStub.setDomains).toHaveBeenCalledWith([]);
  });
});

describe("syncDomainsError", () => {
  beforeEach(async () => {
    __resetErrorState();
    workerStub.onmessage = null;
    harnessStub.setDomains.mockClear();
    harnessStub.syncNow.mockClear();
  });

  const started = async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();
    return sync;
  };

  it("is empty when the active domains are clean", async () => {
    const sync = await started();
    await sync.activateSyncDomains([{ name: "shopifyTransferSync" }], "transferView");

    expect(sync.syncDomainsError.value).toBe("");
  });

  it("surfaces a failure in an active domain", async () => {
    const sync = await started();
    await sync.activateSyncDomains([{ name: "shopifyTransferSync" }]);

    post({ type: "sync-error", domain: "shopifyTransferSync", message: "429 from Shopify" });

    expect(sync.syncDomainsError.value).toBe("429 from Shopify");
  });

  it("ignores a failure in a domain this view did not activate", async () => {
    const sync = await started();
    await sync.activateSyncDomains([{ name: "shopifyTransferSync" }]);

    post({ type: "sync-error", domain: "netSuiteRuleGroup", message: "unrelated" });

    expect(sync.syncDomainsError.value).toBe("");
  });

  it("clears when the domain recovers", async () => {
    const sync = await started();
    await sync.activateSyncDomains([{ name: "shopifyTransferSync" }]);
    post({ type: "sync-error", domain: "shopifyTransferSync", message: "boom" });

    post({ type: "sync-end", domain: "shopifyTransferSync", written: 2, at: 9_000 });

    expect(sync.syncDomainsError.value).toBe("");
  });

  it("clears when the failing domain is deactivated", async () => {
    const sync = await started();
    const domains = [{ name: "shopifyTransferSync" }];
    await sync.activateSyncDomains(domains, "transferView");
    post({ type: "sync-error", domain: "shopifyTransferSync", message: "boom" });

    await sync.deactivateSyncDomains("transferView");

    expect(sync.syncDomainsError.value).toBe("");
  });

  it("does not inherit a stale error recorded before this screen activated the domain", async () => {
    const sync = await started();
    // serviceJobRun failed while a different screen (ShopifyInventorySync) held it.
    post({ type: "sync-error", domain: "serviceJobRun", message: "boom from another screen" });

    // ProductStoreOnboarding now activates a set that includes it.
    await sync.activateSyncDomains([{ name: "serviceJobRun" }], "onboardingView");

    expect(sync.syncDomainsError.value).toBe("");
  });

  // The inventory area re-activates its unchanged set on every move between its pages; the worker
  // does not re-run those domains, so their failure still stands and must stay on the badge.
  it("keeps the failure of a domain re-activated with the same args", async () => {
    const sync = await started();
    const domains = [{ name: "inventoryRows", args: { shopId: "1" } }];
    await sync.activateSyncDomains(domains, "areaOwner");
    post({ type: "sync-error", domain: "inventoryRows", message: "boom" });

    await sync.activateSyncDomains([{ name: "inventoryRows", args: { shopId: "1" } }], "areaOwner");

    expect(sync.syncDomainsError.value).toBe("boom");
  });

  it("clears the failure when the domain is re-activated with different args", async () => {
    const sync = await started();
    await sync.activateSyncDomains([{ name: "inventoryRows", args: { shopId: "1" } }], "areaOwner");
    post({ type: "sync-error", domain: "inventoryRows", message: "boom" });

    await sync.activateSyncDomains([{ name: "inventoryRows", args: { shopId: "2" } }], "areaOwner");

    expect(sync.syncDomainsError.value).toBe("");
  });

  it("forwards syncNow to the worker", async () => {
    const sync = await started();

    await sync.syncNow();

    expect(harnessStub.syncNow).toHaveBeenCalled();
  });
});

describe("activation and refresh routing", () => {
  beforeEach(() => {
    __resetErrorState();
    harnessStub.setDomains.mockClear();
    harnessStub.syncAll.mockClear();
    harnessStub.syncNow.mockClear();
  });

  it("hands the worker a screen's activation made before the sync started", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.activateSyncDomains([{ name: "inventoryEvent", args: { shopId: "S" } }], "deepLink:1");
    expect(harnessStub.setDomains).not.toHaveBeenCalled();

    await sync.startAppDbSync();

    expect(harnessStub.setDomains).toHaveBeenCalledWith([{ name: "inventoryEvent", args: { shopId: "S" } }]);
    await sync.stopAppDbSync();
  });

  it("routes Refresh all to every active domain, not just the screen's", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    await sync.startAppDbSync();

    await sync.resyncReferenceData();

    expect(harnessStub.syncAll).toHaveBeenCalledTimes(1);
    expect(harnessStub.syncNow).not.toHaveBeenCalled();
    await sync.stopAppDbSync();
  });
});

/**
 * Embedded login: `updateToken` makes `isAuthenticated` true at once, so App.vue's watcher starts the
 * sync while `postLogin`'s wipe is still clearing. A worker started then reads the previous session's
 * once-per-login markers, skips the seed, and the wipe empties the tables behind it.
 */
describe("start during a database wipe", () => {
  /** A database whose clear stays open until `finishClear` runs. */
  const slowClearDb = () => {
    let finishClear!: () => void;
    const cleared = new Promise<void>((resolve) => { finishClear = resolve; });
    const base = fakeAppDb().raw() as any;
    const db = { raw: () => ({ ...base, transaction: async () => cleared }) } as unknown as AppDb;
    return { db, finishClear };
  };

  beforeEach(() => {
    __resetErrorState();
    workerStub.onmessage = null;
  });

  it("waits for the wipe to finish before starting the worker", async () => {
    const { db, finishClear } = slowClearDb();
    const factory = vi.fn(createSyncService);
    const sync = setupAppDbSync({ db, createSyncService: factory });

    const stopping = sync.stopAppDbSync();
    const starting = sync.startAppDbSync();
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();

    finishClear();
    await stopping;
    await starting;

    expect(factory).toHaveBeenCalledTimes(1);
    expect(sync.syncService()).not.toBeNull();
  });

  it("starts once when a second start joins the one waiting on the wipe", async () => {
    const { db, finishClear } = slowClearDb();
    const factory = vi.fn(createSyncService);
    const sync = setupAppDbSync({ db, createSyncService: factory });

    const stopping = sync.stopAppDbSync();
    const fromWatcher = sync.startAppDbSync();
    const fromPostLogin = sync.startAppDbSync();
    finishClear();
    await Promise.all([stopping, fromWatcher, fromPostLogin]);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("drops a waiting start that a later stop superseded", async () => {
    const { db, finishClear } = slowClearDb();
    const factory = vi.fn(createSyncService);
    const sync = setupAppDbSync({ db, createSyncService: factory });

    const firstStop = sync.stopAppDbSync();
    const starting = sync.startAppDbSync();
    const secondStop = sync.stopAppDbSync();
    finishClear();
    await Promise.all([firstStop, starting, secondStop]);

    expect(factory).not.toHaveBeenCalled();
    expect(sync.syncService()).toBeNull();
  });
});
