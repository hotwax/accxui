// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { commonUtil } from "./commonUtil";
import { useEmbeddedAppStore } from "../store/embeddedApp";

// jsdom is always top-level; embedded detection is gated on being framed, so tests opt in explicitly.
const setFramed = (framed: boolean) => {
  Object.defineProperty(window, "top", {
    configurable: true,
    get: () => (framed ? ({} as Window) : window)
  });
};

const setUrl = (url: string) => window.history.replaceState({}, "", url);

describe("commonUtil.isAppEmbedded", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setUrl("/");
  });

  afterEach(() => {
    setFramed(false);
    vi.unstubAllEnvs();
  });

  it("is false at top level even when a previous embedded session left shop/host persisted", () => {
    setFramed(false);
    const store = useEmbeddedAppStore();
    store.shop = "demo.myshopify.com";
    store.host = "aG9zdA==";

    expect(commonUtil.isAppEmbedded()).toBe(false);
  });

  it("is true when framed with Shopify launch params in the URL, before any login", () => {
    setFramed(true);
    setUrl("/shopify-login?shop=demo.myshopify.com&host=aG9zdA==&embedded=1");

    expect(commonUtil.isAppEmbedded()).toBe(true);
  });

  it("stays true after client-side navigation has dropped the launch params", () => {
    setFramed(true);
    const store = useEmbeddedAppStore();
    store.shop = "demo.myshopify.com";
    store.host = "aG9zdA==";
    setUrl("/tabs/orders");

    expect(commonUtil.isAppEmbedded()).toBe(true);
  });

  it("is false when framed by something that is not Shopify", () => {
    setFramed(true);
    setUrl("/tabs/orders");

    expect(commonUtil.isAppEmbedded()).toBe(false);
  });

  it("does not depend on the App Bridge instance, which no longer survives a reload", () => {
    setFramed(true);
    setUrl("/shopify-login?shop=demo.myshopify.com&host=aG9zdA==");
    const store = useEmbeddedAppStore();
    store.shopifyAppBridge = null;

    expect(commonUtil.isAppEmbedded()).toBe(true);
  });
});

describe("commonUtil.getUndeployedVersion", () => {
  const stubBuildVersion = (buildVersion: string) =>
    vi.stubEnv("VITE_APP_VERSION_CONFIG", JSON.stringify({ appId: "BOPIS", environmentTypeId: "AppEnvDev", buildVersion }));

  afterEach(() => vi.unstubAllEnvs());

  it("detects the catch-all fall-through: URL names a version the loaded bundle isn't", () => {
    stubBuildVersion("");
    setUrl("/v5.1.0/shopify-login?shop=demo.myshopify.com");

    expect(commonUtil.getUndeployedVersion()).toBe("v5.1.0");
  });

  it("is null when the served bundle matches the version in the URL", () => {
    stubBuildVersion("v5.1.0");
    setUrl("/v5.1.0/shopify-login");

    expect(commonUtil.getUndeployedVersion()).toBeNull();
  });

  it("is null on an unversioned path", () => {
    stubBuildVersion("");
    setUrl("/shopify-login");

    expect(commonUtil.getUndeployedVersion()).toBeNull();
  });

  it("is null when the version config is missing or unparseable", () => {
    vi.stubEnv("VITE_APP_VERSION_CONFIG", "not-json");
    setUrl("/shopify-login");

    expect(commonUtil.getUndeployedVersion()).toBeNull();
  });
});

describe("commonUtil.getEmbeddedAppEntryUrl", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("uses the launch params when they are still on the URL (pre-login)", () => {
    setUrl("/shopify-login?shop=demo.myshopify.com&host=aG9zdA==&embedded=1");

    const url = new URL(commonUtil.getEmbeddedAppEntryUrl("v5.1.0"));
    expect(url.pathname).toBe("/v5.1.0/shopify-login");
    expect(url.searchParams.get("shop")).toBe("demo.myshopify.com");
    expect(url.searchParams.get("host")).toBe("aG9zdA==");
    expect(url.searchParams.get("embedded")).toBe("1");
  });

  it("falls back to the store mid-session, once the params are gone", () => {
    const store = useEmbeddedAppStore();
    store.shop = "demo.myshopify.com";
    store.host = "aG9zdA==";
    setUrl("/tabs/orders");

    const url = new URL(commonUtil.getEmbeddedAppEntryUrl(""));
    expect(url.pathname).toBe("/shopify-login");
    expect(url.searchParams.get("shop")).toBe("demo.myshopify.com");
  });

  it("keeps the version segment currently being served when none is passed", () => {
    const store = useEmbeddedAppStore();
    store.shop = "demo.myshopify.com";
    store.host = "aG9zdA==";
    setUrl("/v5.1.0/tabs/orders");

    expect(new URL(commonUtil.getEmbeddedAppEntryUrl()).pathname).toBe("/v5.1.0/shopify-login");
  });
});
