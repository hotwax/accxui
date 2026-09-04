// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Each scenario needs a fresh module instance: the in-flight flag and the "reconciled once" flag are
// module-scoped, standing in for a page load. resetModules() + dynamic import is how we simulate a reload.
const loadUseAuth = async () => {
  vi.resetModules();
  const [{ useAuth }, { accxuiConfig }] = await Promise.all([
    import("./useAuth"),
    import("../core/configRegistry")
  ]);
  return { useAuth, accxuiConfig };
};

const setBuildVersion = (buildVersion: string) =>
  vi.stubEnv("VITE_APP_VERSION_CONFIG", JSON.stringify({ appId: "BOPIS", environmentTypeId: "AppEnvDev", buildVersion }));

const setUrl = (url: string) => window.history.replaceState({}, "", url);

// Simulate one page load: bundle built as `buildVersion`, served at `pathname`, OMS pinning `pinned`.
// Returns whether a redirect was issued and where to, plus the composable for follow-up calls.
const load = async (buildVersion: string, pathname: string, pinned: string) => {
  setBuildVersion(buildVersion);
  setUrl(pathname);
  const { useAuth, accxuiConfig } = await loadUseAuth();
  accxuiConfig.value.appVersion = pinned;

  const replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, pathname, search: "", hash: "", origin: "https://app.test", replace }
  });

  const auth = useAuth();
  const redirected = auth.checkAppVersionRedirect();
  return { redirected, to: replace.mock.calls[0]?.[0] as string | undefined, auth };
};

describe("checkAppVersionRedirect", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("redirects the root build onto the pinned version", async () => {
    const { redirected, to } = await load("", "/", "v5.1.0");

    expect(redirected).toBe(true);
    expect(to).toContain("/v5.1.0/");
  });

  it("reports the in-flight redirect to later callers in the same page load", async () => {
    const { auth } = await load("", "/", "v5.1.0");

    // Login.vue resolves the version from more than one path; the router guard fires per navigation.
    expect(auth.checkAppVersionRedirect()).toBe(true);
    expect(auth.checkAppVersionRedirect()).toBe(true);
  });

  it("does nothing once the pinned version is the one being served", async () => {
    sessionStorage.setItem("appVersionRedirectPending", "v5.1.0");
    const { redirected, to } = await load("v5.1.0", "/v5.1.0/tabs/orders", "v5.1.0");

    expect(redirected).toBe(false);
    expect(to).toBeUndefined();
    // The landed attempt must not be recorded as a failure, or a later rollback here would be refused.
    expect(sessionStorage.getItem("appVersionRedirectFailed")).toBeNull();
  });

  it("moves to a newly pinned version when the backend changes", async () => {
    const { redirected, to } = await load("v5.1.0", "/v5.1.0/tabs/orders", "v5.2.0");

    expect(redirected).toBe(true);
    expect(to).toContain("/v5.2.0/tabs/orders");
  });

  it("converges to root — without oscillating — when the pinned version isn't deployed", async () => {
    // 1. Root build asks for v5.1.0.
    const first = await load("", "/", "v5.1.0");
    expect(first.to).toContain("/v5.1.0/");

    // 2. The host's catch-all served the root bundle at the versioned path, so the attempt didn't land.
    const second = await load("", "/v5.1.0/", "v5.1.0");
    expect(second.redirected).toBe(true);
    expect(second.to).toBe("/");
    expect(sessionStorage.getItem("appVersionRedirectFailed")).toBe("v5.1.0");

    // 3. Back at root: v5.1.0 is known-unreachable, so we stay put instead of bouncing back to it.
    const third = await load("", "/", "v5.1.0");
    expect(third.redirected).toBe(false);
    expect(third.to).toBeUndefined();
  });

  it("still honours a different version after one proved unreachable", async () => {
    sessionStorage.setItem("appVersionRedirectFailed", "v5.1.0");
    const { redirected, to } = await load("", "/", "v5.2.0");

    expect(redirected).toBe(true);
    expect(to).toContain("/v5.2.0/");
  });

  it("no-ops while the version is still unresolved", async () => {
    setBuildVersion("");
    setUrl("/");
    const { useAuth, accxuiConfig } = await loadUseAuth();
    accxuiConfig.value.appVersion = undefined;

    expect(useAuth().checkAppVersionRedirect()).toBe(false);
  });
});
