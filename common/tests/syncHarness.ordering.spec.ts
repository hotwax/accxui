import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("comlink", () => ({ expose: () => {} }));

import { createSyncHarness } from "../db/sync/pollingWorkerHarness";
import { clearSyncRegistry, registerSyncDomain } from "../db/sync/syncRegistry";
import type { SyncDomain } from "../db/types";

const stubDb = () => ({
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
  table: () => ({ count: async () => 0 }),
  isOpen: () => true,
  open: async () => {},
  name: "test-db",
}) as any;

const START = { maargUrl: "https://x.test/", token: "t", omsInstance: "demo" } as const;

/** A deferred promise, so a test can hold an operation open and observe what overtakes it. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("harness operation ordering", () => {
  beforeEach(() => clearSyncRegistry());

  /**
   * A snapshot replaces the whole scope; a refetch replaces one record. Interleaved, the snapshot's
   * prune can delete a row the refetch just wrote, or the refetch can write a row the snapshot is
   * about to prune. They must serialize per domain.
   */
  it("does not start a refetch while a snapshot of the same domain is in flight", async () => {
    const order: string[] = [];
    const gate = deferred();
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => { order.push("sync:start"); await gate.promise; order.push("sync:end"); return 1; },
      refetchOne: async () => { order.push("refetch"); return 1; },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    const syncing = harness.syncDomainNow("d");
    const refetching = harness.refetchOne({ domain: "d", pk: { id: "1" } });
    gate.resolve();
    await Promise.all([syncing, refetching]);

    expect(order).toEqual(["sync:start", "sync:end", "refetch"]);
    harness.stop();
  });

  it("keeps same-scope refetches in call order", async () => {
    const order: string[] = [];
    const first = deferred();
    let call = 0;
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => 0,
      refetchOne: async (_ctx, pk) => {
        const n = ++call;
        order.push(`start:${n}`);
        if (n === 1) await first.promise;
        order.push(`end:${n}`);
        return 1;
      },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    const a = harness.refetchOne({ domain: "d", pk: { id: "same" } });
    const b = harness.refetchOne({ domain: "d", pk: { id: "same" } });
    first.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
    harness.stop();
  });

  it("runs refetches of different scopes concurrently", async () => {
    const started: string[] = [];
    const gate = deferred();
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => 0,
      refetchOne: async (_ctx, pk) => { started.push(String(pk.id)); await gate.promise; return 1; },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    const a = harness.refetchOne({ domain: "d", pk: { id: "A" } });
    const b = harness.refetchOne({ domain: "d", pk: { id: "B" } });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    gate.resolve();
    await Promise.all([a, b]);

    harness.stop();
  });

  /**
   * The HTTP write has already succeeded when a refetch fails. Resolving 0 would let the mutation
   * UI report success while its cache stays stale, so the rejection has to propagate.
   */
  it("rejects rather than resolving zero when a refetch fails", async () => {
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => 0,
      refetchOne: async () => { throw new Error("refetch failed"); },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    await expect(harness.refetchOne({ domain: "d", pk: { id: "1" } })).rejects.toThrow("refetch failed");
    harness.stop();
  });

  it("rejects a refetch for a domain that has none", async () => {
    registerSyncDomain({ name: "d", label: "d", syncClass: "B", sync: async () => 0 } as SyncDomain);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    await expect(harness.refetchOne({ domain: "d", pk: {} })).rejects.toThrow(/refetchOne/);
    harness.stop();
  });

  it("propagates failure from a forced domain sync", async () => {
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => { throw new Error("sync failed"); },
    } as SyncDomain);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    await expect(harness.syncDomainNow("d")).rejects.toThrow("sync failed");
    harness.stop();
  });
});
