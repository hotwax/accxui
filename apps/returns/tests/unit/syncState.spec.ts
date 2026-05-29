import { describe, it, expect } from "vitest";
import { resolveOrigin, resolveShopifySyncState } from "@/util/syncState";

describe("resolveOrigin", () => {
  it("is shopify when a SHOPIFY_RTN_ID identification exists", () => {
    expect(resolveOrigin([{ returnIdentificationTypeId: "SHOPIFY_RTN_ID", idValue: "gid://1" }])).toBe("shopify");
  });
  it("is pwa when no shopify identification exists", () => {
    expect(resolveOrigin([])).toBe("pwa");
  });
});

describe("resolveShopifySyncState", () => {
  it("is not_synced when shopifySync is null", () => {
    expect(resolveShopifySyncState(null)).toBe("not_synced");
  });
  it("is synced on PUSH_OK", () => {
    expect(resolveShopifySyncState({ pushStatusId: "PUSH_OK", shopifyReturnId: "gid://1" })).toBe("synced");
  });
  it("is pending on PUSH_PENDING", () => {
    expect(resolveShopifySyncState({ pushStatusId: "PUSH_PENDING", shopifyReturnId: null })).toBe("pending");
  });
  it("is failed on PUSH_FAILED", () => {
    expect(resolveShopifySyncState({ pushStatusId: "PUSH_FAILED", shopifyReturnId: null })).toBe("failed");
  });
  it("is synced for an inbound return with a Shopify id but no push status", () => {
    expect(resolveShopifySyncState({ pushStatusId: null, shopifyReturnId: "gid://shopify/Return/123" })).toBe("synced");
  });
  it("is not_synced when present but empty (no push status, no id)", () => {
    expect(resolveShopifySyncState({ pushStatusId: null, shopifyReturnId: null })).toBe("not_synced");
  });
});
