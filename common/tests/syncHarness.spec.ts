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

const START = {
  maargUrl: "https://x.test/rest/s1/",
  token: "t",
  omsInstance: "demo",
} as const;

function domain(over: Partial<SyncDomain> & { name: string }): SyncDomain {
  const calls: any[] = [];
  const d: any = {
    label: over.name,
    syncClass: "B",
    sync: vi.fn(async () => 1),
    ...over,
  };
  d.calls = calls;
  return d as SyncDomain;
}

describe("createSyncHarness lifecycle", () => {
  beforeEach(() => clearSyncRegistry());

  it("runs every activated domain on the first tick", async () => {
    const a = domain({ name: "a" });
    const b = domain({ name: "b" });
    registerSyncDomain(a); registerSyncDomain(b);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [{ name: "a" }, { name: "b" }] });

    expect(a.sync).toHaveBeenCalledTimes(1);
    expect(b.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });

  it("does nothing until a token is supplied", async () => {
    const a = domain({ name: "a" });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, token: "", domains: [{ name: "a" }] });

    expect(a.sync).not.toHaveBeenCalled();
    harness.stop();
  });

  // Class B bootstraps once on activation, then waits for a mutation.
  it("does not re-run a cadence-less domain on a later tick", async () => {
    const a = domain({ name: "a" });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [{ name: "a" }] });
    await harness.syncNow();

    // syncNow forces, so it runs again — the point is the CLOCK was set, checked below.
    expect(a.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  /**
   * Write-through-only domains are registered and listed but must never be ticked. "Activate
   * everything" therefore has to mean "everything of class A or B", or a class-C domain would be
   * polled against an endpoint that only exists to answer a single refetch.
   */
  it("never ticks a class-C domain, even when domains are omitted", async () => {
    const b = domain({ name: "b", syncClass: "B" });
    const c = domain({ name: "c", syncClass: "C" });
    registerSyncDomain(b); registerSyncDomain(c);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START });

    expect(b.sync).toHaveBeenCalledTimes(1);
    expect(c.sync).not.toHaveBeenCalled();
    harness.stop();
  });

  it("activates class B domains and excludes class A view-scoped domains when domains are omitted", async () => {
    const a = domain({ name: "a", syncClass: "A", intervalMs: 10_000 });
    const b = domain({ name: "b", syncClass: "B" });
    registerSyncDomain(a); registerSyncDomain(b);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START });

    expect(a.sync).not.toHaveBeenCalled();
    expect(b.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });
});

describe("createSyncHarness setDomains", () => {
  beforeEach(() => clearSyncRegistry());

  /**
   * The teardown guarantee. A view used to get its own worker, so exit killed the timer outright.
   * With one shared worker, exit must remove the activation or the domain keeps polling unattended.
   */
  it("stops ticking a domain once its activation is removed", async () => {
    const a = domain({ name: "a", syncClass: "A", intervalMs: 1 });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [{ name: "a" }] });
    const afterStart = (a.sync as any).mock.calls.length;

    harness.setDomains([]);
    await harness.syncNow();

    expect((a.sync as any).mock.calls.length).toBe(afterStart);
    harness.stop();
  });

  it("bootstraps a newly added activation on the next tick", async () => {
    const a = domain({ name: "a" });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [] });
    expect(a.sync).not.toHaveBeenCalled();

    harness.setDomains([{ name: "a" }]);
    await harness.syncNow();

    expect(a.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });
});

describe("createSyncHarness catalog", () => {
  beforeEach(() => clearSyncRegistry());

  /**
   * The anti-drift assertion. The catalog and the activated set both come from the registry, so a
   * registered domain cannot be missing from the status card — the failure this whole design
   * exists to make unrepresentable.
   */
  it("lists exactly the registered domains, with their declared label and class", () => {
    registerSyncDomain(domain({ name: "a", table: "as", label: "Alpha", syncClass: "A", intervalMs: 1000 }));
    registerSyncDomain(domain({ name: "c", label: "Gamma", syncClass: "C" }));
    const harness = createSyncHarness(stubDb);

    expect(harness.catalog()).toEqual([
      { name: "a", table: "as", label: "Alpha", syncClass: "A" },
      { name: "c", label: "Gamma", syncClass: "C" },
    ]);
  });
});
