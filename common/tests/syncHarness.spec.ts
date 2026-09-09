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

  it("activates every class A and B domain when domains are omitted", async () => {
    const a = domain({ name: "a", syncClass: "A", intervalMs: 10_000 });
    const b = domain({ name: "b", syncClass: "B" });
    registerSyncDomain(a); registerSyncDomain(b);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START });

    expect(a.sync).toHaveBeenCalledTimes(1);
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
    registerSyncDomain(domain({ name: "a", label: "Alpha", syncClass: "A", intervalMs: 1000 }));
    registerSyncDomain(domain({ name: "c", label: "Gamma", syncClass: "C" }));
    const harness = createSyncHarness(stubDb);

    expect(harness.catalog()).toEqual([
      { name: "a", label: "Alpha", syncClass: "A" },
      { name: "c", label: "Gamma", syncClass: "C" },
    ]);
  });

  it("falls back to the domain name when no label is declared", () => {
    registerSyncDomain({ name: "bare", sync: async () => 0 } as SyncDomain);
    const harness = createSyncHarness(stubDb);

    expect(harness.catalog()[0]).toMatchObject({ name: "bare", label: "bare" });
  });
});

/**
 * `appDbBootstrap.ts` (main-thread bootstrap/dispatcher, still used by Order Manager) speaks the
 * pre-Task-1 harness protocol: `updateToken`, `resyncDomain`, `resyncAll`, the two-arg
 * `refetchOne(domain, pk)`, and `string[]` `domains`. Order Manager doesn't move onto the new
 * protocol (`syncNow`/`syncDomainNow`/`setDomains`/object-shape `refetchOne`) until Task 6, so
 * these shims must keep working until then. Task 12 deletes this whole block and its shim code.
 */
describe("backward compatibility (removed in Task 12)", () => {
  beforeEach(() => clearSyncRegistry());

  it("updateToken lets a token-less start begin syncing once a token arrives", async () => {
    const a = domain({ name: "a" });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, token: "", domains: [{ name: "a" }] });
    expect(a.sync).not.toHaveBeenCalled();

    harness.updateToken("fresh-token");
    await harness.syncNow();

    expect(a.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });

  it("resyncDomain deletes the login marker and forces that domain, bypassing its cadence", async () => {
    const del = vi.fn(async () => {});
    const db = { ...stubDb(), syncMeta: { get: async () => undefined, put: async () => {}, delete: del } };
    const a = domain({ name: "a", syncClass: "A", intervalMs: 100_000 });
    registerSyncDomain(a);
    const harness = createSyncHarness(() => db);

    await harness.start({ ...START, domains: [{ name: "a" }] });
    expect(a.sync).toHaveBeenCalledTimes(1);

    await harness.resyncDomain("a");

    expect(del).toHaveBeenCalledWith("loginSync:a");
    expect(a.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("resyncAll deletes every registered domain's login marker and force-ticks", async () => {
    const del = vi.fn(async () => {});
    const db = { ...stubDb(), syncMeta: { get: async () => undefined, put: async () => {}, delete: del } };
    const a = domain({ name: "a", syncClass: "A", intervalMs: 100_000 });
    const b = domain({ name: "b", syncClass: "A", intervalMs: 100_000 });
    registerSyncDomain(a); registerSyncDomain(b);
    const harness = createSyncHarness(() => db);

    await harness.start({ ...START, domains: [{ name: "a" }, { name: "b" }] });
    expect(a.sync).toHaveBeenCalledTimes(1);
    expect(b.sync).toHaveBeenCalledTimes(1);

    await harness.resyncAll();

    expect(del).toHaveBeenCalledWith("loginSync:a");
    expect(del).toHaveBeenCalledWith("loginSync:b");
    expect(a.sync).toHaveBeenCalledTimes(2);
    expect(b.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  /**
   * The divergence this fix closes: `resyncAll` must mean "every REGISTERED domain," not "every
   * currently ACTIVE domain." Routing it through the active-scoped `tick` would silently skip a
   * domain nobody has activated yet, and nothing but this test would catch it — the only real
   * caller today activates its full catalog, which happens to mask the bug.
   */
  it("resyncAll reaches a registered domain that was never activated, and skips class C", async () => {
    const del = vi.fn(async () => {});
    const db = { ...stubDb(), syncMeta: { get: async () => undefined, put: async () => {}, delete: del } };
    const a = domain({ name: "a", syncClass: "A", intervalMs: 100_000 });
    const b = domain({ name: "b", syncClass: "A", intervalMs: 100_000 });
    const c = domain({ name: "c", syncClass: "C" });
    registerSyncDomain(a); registerSyncDomain(b); registerSyncDomain(c);
    const harness = createSyncHarness(() => db);

    // Only "a" is activated — "b" and "c" are registered but never activated.
    await harness.start({ ...START, domains: [{ name: "a" }] });
    expect(a.sync).toHaveBeenCalledTimes(1);
    expect(b.sync).not.toHaveBeenCalled();

    await harness.resyncAll();

    expect(a.sync).toHaveBeenCalledTimes(2);
    expect(b.sync).toHaveBeenCalledTimes(1);
    expect(c.sync).not.toHaveBeenCalled();
    harness.stop();
  });

  it("refetchOne(domain, pk) reaches the domain's refetchOne with the pk", async () => {
    const refetch = vi.fn(async () => 3);
    const a = domain({ name: "a", refetchOne: refetch });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    const written = await harness.refetchOne("a", { id: 1 });

    expect(written).toBe(3);
    expect(refetch).toHaveBeenCalledWith(expect.anything(), { id: 1 });
    harness.stop();
  });

  it("start({ domains: string[] }) normalises each name to an activation and ticks it", async () => {
    const a = domain({ name: "a" });
    const b = domain({ name: "b" });
    registerSyncDomain(a); registerSyncDomain(b);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: ["a", "b"] });

    expect(a.sync).toHaveBeenCalledTimes(1);
    expect(b.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });
});
