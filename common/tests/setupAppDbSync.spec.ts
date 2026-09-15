import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessStub = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  setDomains: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
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
vi.mock("../db/sync/pollingTokenChannel", () => ({
  createTokenPublisher: () => ({ publish: vi.fn(), close: vi.fn() }),
}));

import { setupAppDbSync } from "../db/sync/setupAppDbSync";
import { createSyncService, __resetErrorState, serviceState } from "../db/sync/syncService";
import type { AppDb } from "../db/defineAppDb";

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
