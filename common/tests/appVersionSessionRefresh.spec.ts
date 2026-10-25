// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cookies: {} as Record<string, string>, base: "https://test.example/rest/s1/" }));
const api = vi.hoisted(() => vi.fn());
vi.mock("../core/remoteApi", () => ({ default: api }));
vi.mock("../core/logger", () => ({ default: { error: vi.fn() } }));
vi.mock("../core/i18n", () => ({ translate: (s: string) => s }));
vi.mock("../store/embeddedApp", () => ({ useEmbeddedAppStore: () => ({}) }));
vi.mock("../helpers/cookieHelper", () => ({ cookieHelper: () => ({
  get: (k: string) => state.cookies[k],
  set: (k: string, v: string) => { state.cookies[k] = v; },
  remove: (k: string) => { delete state.cookies[k]; }
}) }));
vi.mock("../utils/commonUtil", () => ({ commonUtil: {
  isMoqui: () => true, isAppEmbedded: () => false,
  getToken: () => state.cookies.token || "", getTokenExpiration: () => undefined,
  getMaargURL: () => state.base, hasError: (r: any) => Boolean(r.data?.errors)
} }));
import { useAuth } from "../composables/useAuth";
import { accxuiConfig } from "../core/configRegistry";
const replace = vi.fn();
function pending() {
  let resolve!: (r: any) => void;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  api.mockReset(); replace.mockReset(); useAuth().clearAuth();
  state.base = "https://test.example/rest/s1/";
  state.cookies.oms = "test"; state.cookies.userId = "user";
  useAuth().updateToken("session-a", String(Date.now() + 60000));
  accxuiConfig.value = { oms: "test", current: { userId: "user" }, appVersion: "v1.0.0",
    postLogin: async () => {}, postLogout: async () => {}, preLogout: async () => {}, router: {} };
  vi.stubEnv("VITE_APP_VERSION_CONFIG", JSON.stringify({ appId: "COMPANY", environmentTypeId: "AppEnvUAT", buildVersion: "" }));
  vi.stubGlobal("window", { location: { pathname: "/orders", search: "?status=open", hash: "#details", replace } });
});
afterEach(() => { useAuth().clearAuth(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("authenticated app version startup refresh", () => {
  it("replaces a persisted old pin using the active session, deduplicating navigation lookups", async () => {
    const request = pending(); api.mockReturnValue(request.promise);
    expect(useAuth().checkAppVersionRedirect()).toBe(false);
    expect(useAuth().checkAppVersionRedirect()).toBe(false);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith({ url: "admin/apps/COMPANY/appVersions", method: "GET", timeout: 5000,
      params: { appId: "COMPANY", environmentTypeId: "AppEnvUAT" } });
    expect(replace).not.toHaveBeenCalled();
    const completion = useAuth().fetchAppVersion();
    request.resolve({ data: { docs: [{ currentVersion: "v2.0.0" }] } });
    await completion;
    expect(accxuiConfig.value.appVersion).toBe("v2.0.0");
    expect(replace).toHaveBeenCalledWith("/v2.0.0/orders?status=open#details");
  });
  it("does not request again for navigation after the current document has resolved its pin", async () => {
    window.location.pathname = "/v2.0.0/orders";
    api.mockResolvedValue({ data: [{ currentVersion: "v2.0.0" }] });
    await useAuth().fetchAppVersion();
    expect(useAuth().checkAppVersionRedirect()).toBe(false);
    expect(api).toHaveBeenCalledTimes(1); expect(replace).not.toHaveBeenCalled();
  });
  it("honors an empty successful result as Default and preserves the route", async () => {
    window.location.pathname = "/v1.0.0/orders";
    api.mockResolvedValue({ data: [] });
    await useAuth().fetchAppVersion();
    expect(accxuiConfig.value.appVersion).toBe("");
    expect(replace).toHaveBeenCalledWith("/orders?status=open#details");
  });
  it("keeps the pin and page on a failed lookup", async () => {
    api.mockRejectedValue(new Error("timeout"));
    await useAuth().fetchAppVersion();
    expect(accxuiConfig.value.appVersion).toBe("v1.0.0");
    expect(useAuth().checkAppVersionRedirect()).toBe(false);
    expect(api).toHaveBeenCalledTimes(1); expect(replace).not.toHaveBeenCalled();
  });
  it.each([{}, { docs: null }, { errors: "denied", docs: [] }, { docs: [null] }, { docs: ["invalid"] },
    { docs: [{ currentVersion: "../../login" }] }, { docs: [{ currentVersion: 4 }] },
    { docs: [{ environmentTypeId: "AppEnvProd", currentVersion: "v2.0.0" }] }])("rejects invalid results without treating them as Default: %j", async data => {
    api.mockResolvedValue({ data }); await useAuth().fetchAppVersion();
    expect(accxuiConfig.value.appVersion).toBe("v1.0.0"); expect(replace).not.toHaveBeenCalled();
  });
  it("does not fetch from the router before authentication", () => {
    useAuth().clearAuth(); expect(useAuth().checkAppVersionRedirect()).toBe(false);
    expect(api).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  });
  it("ignores a response that arrives after logout", async () => {
    const request = pending(); api.mockReturnValue(request.promise);
    const completion = useAuth().fetchAppVersion(); useAuth().clearAuth();
    request.resolve({ data: [{ currentVersion: "v2.0.0" }] }); await completion;
    expect(accxuiConfig.value.appVersion).toBe("v1.0.0"); expect(replace).not.toHaveBeenCalled();
  });
  it("does not let the old instance overwrite a newer instance's selection", async () => {
    const request = pending(); api.mockReturnValueOnce(request.promise);
    const oldCompletion = useAuth().fetchAppVersion();
    state.base = "https://other.example/rest/s1/"; state.cookies.oms = "other";
    accxuiConfig.value.oms = "other"; useAuth().updateToken("session-b", String(Date.now()+60000));
    api.mockResolvedValue({ data: [{ currentVersion: "v3.0.0" }] });
    await useAuth().fetchAppVersion();
    request.resolve({ data: [{ currentVersion: "v2.0.0" }] }); await oldCompletion;
    expect(accxuiConfig.value.appVersion).toBe("v3.0.0");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/v3.0.0/orders?status=open#details");
  });
});
