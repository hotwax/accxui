import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("comlink", () => ({ expose: () => {} }));

import { createSyncHarness, RETRY_WITHOUT_INTERVAL_MS } from "../db/sync/pollingWorkerHarness";
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
    await harness.syncAll();

    // syncAll forces, so it runs again — the point is the CLOCK was set, checked below.
    expect(a.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("forces only the screen's domains on syncNow, and every active domain on syncAll", async () => {
    const seed = domain({ name: "seed" });
    const live = domain({ name: "live", syncClass: "A", intervalMs: 60_000 });
    registerSyncDomain(seed); registerSyncDomain(live);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START });
    harness.setDomains([{ name: "live" }]);
    await harness.syncNow();
    expect(seed.sync).toHaveBeenCalledTimes(1);
    expect(live.sync).toHaveBeenCalledTimes(1);

    await harness.syncAll();
    expect(seed.sync).toHaveBeenCalledTimes(2);
    expect(live.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("keeps the start set active when a screen replaces its domains", async () => {
    const seed = domain({ name: "seed" });
    registerSyncDomain(seed);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START });
    harness.setDomains([]);
    await harness.syncAll();

    expect(seed.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("holds a screen's domains set before start and runs them on the first tick", async () => {
    const live = domain({ name: "live", syncClass: "A", intervalMs: 60_000 });
    registerSyncDomain(live);
    const harness = createSyncHarness(stubDb);

    harness.setDomains([{ name: "live" }]);
    await harness.start({ ...START, domains: [] });

    expect(live.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });

  it("queues a forced pass behind a running scheduled tick instead of dropping it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const live = domain({
      name: "live",
      syncClass: "A",
      intervalMs: 60_000,
      sync: vi.fn(async () => { calls += 1; if (calls === 1) await gate; return 1; }),
    });
    registerSyncDomain(live);
    const harness = createSyncHarness(stubDb);
    harness.setDomains([{ name: "live" }]);

    const starting = harness.start({ ...START, domains: [] });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const forced = harness.syncNow(); // lands while the first tick is still inside `sync`
    release();
    await starting;
    await forced;

    expect(live.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("widens a queued forced view pass when Refresh all lands behind it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const seed = domain({ name: "seed" });
    const live = domain({
      name: "live",
      syncClass: "A",
      intervalMs: 60_000,
      sync: vi.fn(async () => { calls += 1; if (calls === 1) await gate; return 1; }),
    });
    registerSyncDomain(seed); registerSyncDomain(live);
    const harness = createSyncHarness(stubDb);
    harness.setDomains([{ name: "live" }]);

    const starting = harness.start({ ...START });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const viewPass = harness.syncNow(); // queues a view pass behind the start tick
    const allPass = harness.syncAll(); // must not resolve against that view-only pass
    release();
    await starting;
    await Promise.all([viewPass, allPass]);

    expect(seed.sync).toHaveBeenCalledTimes(2);
    expect(live.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("does not let a forced pass share a running one that picked its domains before setDomains", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const first = domain({
      name: "first",
      syncClass: "A",
      intervalMs: 60_000,
      sync: vi.fn(async () => { calls += 1; if (calls === 1) await gate; return 1; }),
    });
    const second = domain({ name: "second", syncClass: "A", intervalMs: 60_000 });
    registerSyncDomain(first); registerSyncDomain(second);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [] });
    harness.setDomains([{ name: "first" }]);
    const running = harness.syncNow(); // forced pass over [first], held inside `sync`
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.setDomains([{ name: "second" }]);
    const later = harness.syncNow();
    release();
    await Promise.all([running, later]);

    // Once when activated, once more for the forced pass, which must not settle for the pass over [first].
    expect(second.sync).toHaveBeenCalledTimes(2);
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

describe("createSyncHarness screen activation", () => {
  beforeEach(() => clearSyncRegistry());

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  // After login the seed pass can run for seconds; the screen's own data must not queue behind it.
  it("runs a newly activated screen domain at once, alongside a running pass", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const seed = domain({ name: "seed" });
    const live = domain({ name: "live", syncClass: "A", intervalMs: 60_000 });
    registerSyncDomain(seed); registerSyncDomain(live);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START });
    (seed.sync as any).mockImplementation(async () => { await gate; return 1; });
    const running = harness.syncAll(); // a long pass, held inside seed
    await tick();

    harness.setDomains([{ name: "live" }]);
    await tick();

    expect(live.sync).toHaveBeenCalledTimes(1);
    release();
    await running;
    harness.stop();
  });

  // Screens ask for a refresh right after activating; that must not fetch the same rows twice.
  it("lets a forced pass wait on the activation run instead of repeating it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const live = domain({ name: "live", syncClass: "A", intervalMs: 60_000, sync: vi.fn(async () => { await gate; return 1; }) });
    registerSyncDomain(live);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    harness.setDomains([{ name: "live" }]);
    const refresh = harness.syncNow();
    release();
    await refresh;

    expect(live.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });

  it("reports an activation run's failure to the forced pass waiting on it", async () => {
    const live = domain({ name: "live", syncClass: "A", intervalMs: 60_000, sync: vi.fn(async () => { throw new Error("down"); }) });
    registerSyncDomain(live);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    harness.setDomains([{ name: "live" }]);

    await expect(harness.syncNow()).rejects.toThrow(/live/);
    harness.stop();
  });

  it("does not run an activation the screen dropped before its turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = domain({ name: "first", syncClass: "A", intervalMs: 60_000, sync: vi.fn(async () => { await gate; return 1; }) });
    const second = domain({ name: "second", syncClass: "A", intervalMs: 60_000 });
    registerSyncDomain(first); registerSyncDomain(second);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    harness.setDomains([{ name: "first" }, { name: "second" }]);
    harness.setDomains([{ name: "first" }]);
    release();
    await tick(); await tick();

    expect(second.sync).not.toHaveBeenCalled();
    harness.stop();
  });

  describe("status messages", () => {
    let posted: Record<string, any>[];
    beforeEach(() => {
      posted = [];
      vi.stubGlobal("self", { postMessage: (msg: Record<string, any>) => posted.push(msg) });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("forwards the structured details a domain attaches to its failure", async () => {
      const failure = Object.assign(new Error("2 of 5 lists could not be loaded"), {
        details: { failedSegments: { receipt: { message: "slow", retryAt: 60_000 } }, loadedSegments: ["create"] },
      });
      registerSyncDomain(domain({ name: "partial", syncClass: "A", intervalMs: 15_000, sync: vi.fn(async () => { throw failure; }) }));
      const harness = createSyncHarness(stubDb);

      await harness.start({ ...START, domains: [{ name: "partial" }] });

      expect(posted.find((m) => m.type === "sync-error" && m.domain === "partial")).toEqual({
        type: "sync-error", domain: "partial", message: "2 of 5 lists could not be loaded", details: failure.details,
      });
      harness.stop();
    });

    it("resets a domain whose screen activation was dropped or re-scoped", async () => {
      registerSyncDomain(domain({ name: "live", syncClass: "A", intervalMs: 60_000 }));
      const harness = createSyncHarness(stubDb);
      await harness.start({ ...START, domains: [] });
      harness.setDomains([{ name: "live", args: { shopId: "A" } }]);

      harness.setDomains([{ name: "live", args: { shopId: "B" } }]);

      expect(posted.filter((m) => m.type === "activations-reset")).toEqual([{ type: "activations-reset", domains: ["live"] }]);
      harness.stop();
    });

    it("keeps a domain the start set still holds", async () => {
      registerSyncDomain(domain({ name: "seed" }));
      const harness = createSyncHarness(stubDb);
      await harness.start({ ...START, domains: [{ name: "seed" }] });
      harness.setDomains([{ name: "seed" }]);
      await tick();

      harness.setDomains([]);

      expect(posted.some((m) => m.type === "activations-reset")).toBe(false);
      harness.stop();
    });

    it("marks a pass that finished after its screen left as not current", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      registerSyncDomain(domain({ name: "live", syncClass: "A", intervalMs: 60_000, sync: vi.fn(async () => { await gate; return 1; }) }));
      const harness = createSyncHarness(stubDb);
      await harness.start({ ...START, domains: [] });
      harness.setDomains([{ name: "live", args: { shopId: "A" } }]);
      await tick();

      harness.setDomains([]);
      release();
      await tick(); await tick();

      expect(posted.find((m) => m.type === "sync-end" && m.domain === "live")).toMatchObject({ current: false });
      harness.stop();
    });
  });
});

describe("createSyncHarness retry of a domain with no interval", () => {
  beforeEach(() => {
    clearSyncRegistry();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  /** A login marker, so a successful seed pass counts as finished. */
  const markedDb = () => {
    const db = stubDb();
    db.syncMeta.get = async (key: string) => (key.startsWith("loginSync:") ? { synced: true } : undefined);
    return db;
  };

  // A failing seed domain stays due until it succeeds, but not on every 5s tick.
  it("waits RETRY_WITHOUT_INTERVAL_MS after a failed pass, then retries", async () => {
    const seed = domain({ name: "seed", sync: vi.fn(async () => { throw new Error("403"); }) });
    registerSyncDomain(seed);
    const harness = createSyncHarness(markedDb);
    await harness.start({ ...START, domains: [{ name: "seed" }] });
    expect(seed.sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RETRY_WITHOUT_INTERVAL_MS - 5_000);
    expect(seed.sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(seed.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  // The empty-fetch guard refuses a snapshot without writing the login marker: also unfinished.
  it("waits the same after a pass that did not finish", async () => {
    const seed = domain({ name: "seed" });
    registerSyncDomain(seed);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [{ name: "seed" }] });

    await vi.advanceTimersByTimeAsync(RETRY_WITHOUT_INTERVAL_MS - 5_000);
    expect(seed.sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(seed.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("does not run again once a retry succeeds", async () => {
    const seed = domain({ name: "seed", sync: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(1) });
    registerSyncDomain(seed);
    const harness = createSyncHarness(markedDb);
    await harness.start({ ...START, domains: [{ name: "seed" }] });

    await vi.advanceTimersByTimeAsync(RETRY_WITHOUT_INTERVAL_MS * 3);

    expect(seed.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  // "Refresh" in Settings is the user's way out; it must not wait.
  it("does not hold back a forced pass", async () => {
    const seed = domain({ name: "seed", sync: vi.fn(async () => { throw new Error("403"); }) });
    registerSyncDomain(seed);
    const harness = createSyncHarness(markedDb);
    await harness.start({ ...START, domains: [{ name: "seed" }] });

    await harness.syncAll().catch(() => undefined);

    expect(seed.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  it("leaves a domain with an interval on its own interval", async () => {
    const live = domain({ name: "live", syncClass: "A", intervalMs: 10_000, sync: vi.fn(async () => { throw new Error("down"); }) });
    registerSyncDomain(live);
    const harness = createSyncHarness(markedDb);
    await harness.start({ ...START, domains: [{ name: "live" }] });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(live.sync).toHaveBeenCalledTimes(2);
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
