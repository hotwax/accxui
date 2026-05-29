import { describe, it, expect } from "vitest";
import { resolveOrigin, resolveSyncState } from "@/util/syncState";

describe("resolveOrigin", () => {
  it("is shopify when a SHOPIFY_RTN_ID identification exists", () => {
    expect(resolveOrigin([{ returnIdentificationTypeId: "SHOPIFY_RTN_ID", idValue: "gid://1" }])).toBe("shopify");
  });
  it("is pwa when no shopify identification exists", () => {
    expect(resolveOrigin([])).toBe("pwa");
  });
});

describe("resolveSyncState", () => {
  it("is synced when a shopify GID is present", () => {
    expect(resolveSyncState({ hasShopifyId: true, origin: "pwa", pushAttempted: false, pushFailed: false })).toBe("synced");
  });
  it("is not_synced for a pwa return with no push attempted", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "pwa", pushAttempted: false, pushFailed: false })).toBe("not_synced");
  });
  it("is pending for a pwa return after a push, before the GID lands", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "pwa", pushAttempted: true, pushFailed: false })).toBe("pending");
  });
  it("is failed when a push failed", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "pwa", pushAttempted: true, pushFailed: true })).toBe("failed");
  });
  it("is pending for a shopify-origin return that has not yet recorded its GID", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "shopify", pushAttempted: false, pushFailed: false })).toBe("pending");
  });
});
