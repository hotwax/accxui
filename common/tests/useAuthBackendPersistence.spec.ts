// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, cookies, buildMode } = vi.hoisted(() => ({ api: vi.fn(), cookies: new Map<string, string>(), buildMode: { moqui: false } }));
vi.mock("../core/remoteApi", () => ({ default: (...args: any[]) => api(...args) }));
vi.mock("../core/logger", () => ({ default: { error: vi.fn() } }));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../helpers/cookieHelper", () => ({ cookieHelper: () => ({
  get: (key: string) => cookies.get(key) || "",
  set: (key: string, value: string) => cookies.set(key, value),
  remove: (key: string) => cookies.delete(key)
}) }));
vi.mock("../utils/commonUtil", () => ({ commonUtil: {
  isMoqui: () => buildMode.moqui,
  getOmsURL: (moqui: boolean) => `https://${cookies.get("oms")}.example/${moqui ? "rest/s1/" : "api/"}`,
  getTokenExpiration: () => undefined,
  hasError: (response: any) => Boolean(response.data?.error),
  isAppEmbedded: () => false
} }));

const probeMoqui = async () => {
  api.mockRejectedValueOnce(new Error("OFBiz unavailable"));
  api.mockResolvedValueOnce({ data: { loginAuthType: "BASIC" } });
  const auth = await import("../composables/useAuth");
  expect(await auth.useAuth().fetchLoginOptions()).toBe(true);
  expect(auth.isMoquiOmsRef.value).toBe(true);

  return auth;
};

describe("verified OMS backend survives a tab reload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    api.mockReset();
    cookies.clear();
    cookies.set("oms", "moqui-test");
    sessionStorage.clear();
    buildMode.moqui = false;
  });

  it("restores the successful Moqui probe instead of the build default", async () => {
    await probeMoqui();
    vi.resetModules();
    expect((await import("../composables/useAuth")).isMoquiOmsRef.value).toBe(true);
  });

  it("restores an OFBiz result even if the next build defaults to Moqui", async () => {
    api.mockResolvedValueOnce({ data: { loginAuthType: "BASIC", maargInstanceUrl: "paired-maarg" } });
    const auth = await import("../composables/useAuth");
    await auth.useAuth().fetchLoginOptions();
    buildMode.moqui = true;
    vi.resetModules();
    expect((await import("../composables/useAuth")).isMoquiOmsRef.value).toBe(false);
  });

  it("does not restore another instance's backend", async () => {
    await probeMoqui();
    cookies.set("oms", "different-instance");
    vi.resetModules();
    expect((await import("../composables/useAuth")).isMoquiOmsRef.value).toBe(false);
  });

  it("clears the old mode when switching the entered instance", async () => {
    const auth = await probeMoqui();
    auth.useAuth().updateOMS("different-instance");
    expect(auth.isMoquiOmsRef.value).toBe(false);
    expect(sessionStorage.getItem("accxui.omsBackend")).toBeNull();
  });

  it("clears the persisted mode with authentication", async () => {
    const auth = await probeMoqui();
    auth.useAuth().clearAuth();
    vi.resetModules();
    expect((await import("../composables/useAuth")).isMoquiOmsRef.value).toBe(false);
  });

  it("does not retain an old verified mode after a failed probe", async () => {
    const auth = await probeMoqui();
    api.mockRejectedValue(new Error("Unavailable"));
    expect(await auth.useAuth().fetchLoginOptions()).toBe(false);
    vi.resetModules();
    expect((await import("../composables/useAuth")).isMoquiOmsRef.value).toBe(false);
  });

  it("does not persist an error response returned with HTTP 200", async () => {
    api.mockResolvedValueOnce({ data: { error: "Not available" } });
    api.mockResolvedValueOnce({ data: { error: "Not available" } });
    const auth = await import("../composables/useAuth");
    expect(await auth.useAuth().fetchLoginOptions()).toBe(false);
    expect(sessionStorage.getItem("accxui.omsBackend")).toBeNull();
    expect(auth.isMoquiOmsRef.value).toBe(false);
  });

  it("falls back safely for malformed storage", async () => {
    sessionStorage.setItem("accxui.omsBackend", "invalid json");
    expect((await import("../composables/useAuth")).isMoquiOmsRef.value).toBe(false);
  });

  it("keeps login working when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    await probeMoqui();
  });
});
