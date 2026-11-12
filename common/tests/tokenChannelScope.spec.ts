import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("comlink", () => ({ expose: () => {} }));

import { createTokenPublisher, pollingTokenChannel, subscribeToken } from "../db/sync/channels";
import { createSyncHarness } from "../db/sync/pollingWorkerHarness";
import { clearSyncRegistry, registerSyncDomain } from "../db/sync/syncRegistry";
import type { SyncDomain } from "../db/types";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const stubDb = () => ({
  syncMeta: { get: () => Promise.resolve(undefined), put: () => Promise.resolve(), delete: () => Promise.resolve() },
  table: () => ({ count: () => Promise.resolve(0) }),
  isOpen: () => true,
  open: () => Promise.resolve(),
  name: "test-db",
}) as any;

describe("token channel scope", () => {
  it("names the channel by OMS instance", () => {
    expect(pollingTokenChannel("adoc-ni")).not.toBe(pollingTokenChannel("adoc-hn"));
  });

  it("a subscriber hears its own instance and not another one", async () => {
    const heard: string[] = [];
    const stop = subscribeToken((token) => heard.push(token), pollingTokenChannel("adoc-ni"));
    const own = createTokenPublisher(pollingTokenChannel("adoc-ni"));
    const other = createTokenPublisher(pollingTokenChannel("adoc-hn"));

    other.publish("token-of-adoc-hn");
    own.publish("token-of-adoc-ni");
    await settle();

    expect(heard).toEqual(["token-of-adoc-ni"]);
    stop(); own.close(); other.close();
  });
});

describe("sync worker token", () => {
  afterEach(() => clearSyncRegistry());

  it("keeps using its own instance's token when a tab of another instance publishes one", async () => {
    const seen: string[] = [];
    const domain: SyncDomain = {
      name: "d", label: "d", syncClass: "B",
      sync: vi.fn((ctx: any) => {
        seen.push(ctx.token);

        return Promise.resolve(1);
      }),
    } as any;
    registerSyncDomain(domain);
    const harness = createSyncHarness(stubDb);

    await harness.start({ maargUrl: "https://x.test/rest/s1/", token: "own-token", omsInstance: "adoc-ni", domains: [{ name: "d" }] });

    const foreign = createTokenPublisher(pollingTokenChannel("adoc-hn"));
    const own = createTokenPublisher(pollingTokenChannel("adoc-ni"));

    foreign.publish("foreign-token");
    await settle();
    await harness.syncAll();
    expect(seen).toEqual(["own-token", "own-token"]);

    own.publish("rotated-own-token");
    await settle();
    await harness.syncAll();
    expect(seen).toEqual(["own-token", "own-token", "rotated-own-token"]);

    harness.stop(); foreign.close(); own.close();
  });
});
