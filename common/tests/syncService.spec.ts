import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessStub = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  setDomains: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  syncDomainNow: vi.fn(async () => 3),
  refetchOne: vi.fn(async () => 1),
  domains: vi.fn(async () => ["a", "b"]),
  catalog: vi.fn(async () => [{ name: "a", label: "Alpha", syncClass: "B" }]),
  stop: vi.fn(),
}));
const terminate = vi.hoisted(() => vi.fn());
const workerStub = vi.hoisted(() => ({ onmessage: null as any }));

vi.mock("../core/workerFactory", () => ({
  WorkerFactory: { createWorker: () => ({ api: harnessStub, terminate, worker: workerStub }) },
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

import { createSyncService } from "../db/sync/syncService";

describe("createSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerStub.onmessage = null;
  });

  it("starts the worker with the current token, url and instance", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });

    await service.start();

    expect(harnessStub.start).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok", maargUrl: "https://x.test/", omsInstance: "demo" }),
    );
    service.stop();
  });

  // Idempotent: App.vue mounts can race, and a second worker would double every poll.
  it("does not spawn a second worker when start is called twice", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });

    await Promise.all([service.start(), service.start()]);

    expect(harnessStub.start).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("swaps the activated set without respawning", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    await service.setDomains([{ name: "x" }]);

    expect(harnessStub.setDomains).toHaveBeenCalledWith([{ name: "x" }]);
    expect(harnessStub.start).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("routes an auth-error status to the app's hook", async () => {
    const onAuthError = vi.fn();
    const service = createSyncService({ workerUrl: "/w.js", onAuthError });
    await service.start();

    workerStub.onmessage!({ data: { type: "auth-error", message: "401" } } as MessageEvent);

    expect(onAuthError).toHaveBeenCalledWith("401");
    service.stop();
  });

  it("forwards every status message to the app's listener", async () => {
    const onStatus = vi.fn();
    const service = createSyncService({ workerUrl: "/w.js", onStatus });
    await service.start();

    workerStub.onmessage!({ data: { type: "sync-end", domain: "a", written: 4 } } as MessageEvent);

    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ type: "sync-end", domain: "a" }));
    service.stop();
  });

  it("proxies the catalog from the worker", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    await expect(service.catalog()).resolves.toEqual([{ name: "a", label: "Alpha", syncClass: "B" }]);
    service.stop();
  });

  it("terminates the worker on stop, so its timer dies with it", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    service.stop();

    expect(terminate).toHaveBeenCalled();
  });

  it("can be restarted after stop", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();
    service.stop();

    await service.start();

    expect(harnessStub.start).toHaveBeenCalledTimes(2);
    service.stop();
  });
});
