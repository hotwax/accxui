import { beforeEach, describe, expect, it } from "vitest";
import {
  type ActiveDomain,
  activationKey,
  clearSyncRegistry,
  dueDomains,
  effectiveInterval,
  getAllSyncDomains,
  registerSyncDomain,
} from "../db/sync/syncRegistry";
import type { SyncDomain } from "../db/types";

const domain = (name: string, intervalMs?: number): SyncDomain => ({
  name,
  label: name,
  syncClass: intervalMs ? "A" : "B",
  ...(intervalMs ? { intervalMs } : {}),
  sync: async () => 0,
});

describe("activationKey", () => {
  it("is the bare name when there are no args", () => {
    expect(activationKey({ name: "systemMessage" })).toBe("systemMessage");
  });

  /**
   * The bug this exists to prevent: the connection-details page activates `systemMessage` for
   * product-sync types at the idle cadence and again for order-sync types at the active one.
   * Keyed on name alone they share one clock, the 10s activation restamps it every 10s, the 60s
   * activation never becomes due, and the screen stops updating after its first tick.
   */
  it("separates two activations of one domain that do different work", () => {
    const a = activationKey({ name: "systemMessage", args: { type: "order" } });
    const b = activationKey({ name: "systemMessage", args: { type: "product" } });

    expect(a).not.toBe(b);
  });

  it("gives two genuinely identical activations the same key", () => {
    const a = activationKey({ name: "systemMessage", args: { type: "order", total: 50 } });
    const b = activationKey({ name: "systemMessage", args: { total: 50, type: "order" } });

    expect(a).toBe(b);
  });

  it("ignores undefined-valued args, which are not a difference in work", () => {
    const a = activationKey({ name: "d", args: { type: "order", extra: undefined } });
    const b = activationKey({ name: "d", args: { type: "order" } });

    expect(a).toBe(b);
  });
});

describe("effectiveInterval", () => {
  it("prefers the activation's override over the domain default", () => {
    expect(effectiveInterval({ name: "d", intervalMs: 10_000 }, domain("d", 60_000))).toBe(10_000);
  });

  it("falls back to the domain default", () => {
    expect(effectiveInterval({ name: "d" }, domain("d", 60_000))).toBe(60_000);
  });

  it("is undefined for a domain with no cadence", () => {
    expect(effectiveInterval({ name: "d" }, domain("d"))).toBeUndefined();
  });
});

describe("dueDomains", () => {
  const intervalFor = (active: ActiveDomain) => active.intervalMs;

  it("runs everything on the first pass", () => {
    const active: ActiveDomain[] = [{ name: "a" }, { name: "b", intervalMs: 1000 }];

    expect(dueDomains(active, {}, 5_000, intervalFor)).toEqual(active);
  });

  // Class B bootstraps once on activation and then stays idle until a mutation asks for it.
  it("does not re-run a cadence-less domain that has already run", () => {
    expect(dueDomains([{ name: "a" }], { a: 1_000 }, 9_999_999, intervalFor)).toEqual([]);
  });

  it("re-runs a cadenced domain once its interval has elapsed", () => {
    const active: ActiveDomain[] = [{ name: "a", intervalMs: 1000 }];

    expect(dueDomains(active, { a: 5_000 }, 5_999, intervalFor)).toEqual([]);
    expect(dueDomains(active, { a: 5_000 }, 6_000, intervalFor)).toEqual(active);
  });

  it("gives two activations of one domain independent clocks", () => {
    const fast: ActiveDomain = { name: "m", intervalMs: 10_000, args: { type: "order" } };
    const slow: ActiveDomain = { name: "m", intervalMs: 60_000, args: { type: "product" } };
    // The fast activation ran just now; the slow one ran a full minute ago.
    const lastRunAt = { [activationKey(fast)]: 100_000, [activationKey(slow)]: 40_000 };

    const due = dueDomains([fast, slow], lastRunAt, 100_001, (a) => a.intervalMs);

    expect(due).toEqual([slow]);
  });
});

describe("registry", () => {
  beforeEach(() => clearSyncRegistry());

  it("returns the domain it registered, so a caller can hold on to it", () => {
    const d = domain("a");
    expect(registerSyncDomain(d)).toBe(d);
    expect(getAllSyncDomains()).toEqual([d]);
  });

  it("keeps registration order, which is fan-out parent order", () => {
    registerSyncDomain(domain("parent"));
    registerSyncDomain(domain("child"));

    expect(getAllSyncDomains().map((d) => d.name)).toEqual(["parent", "child"]);
  });
});
