// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => ({} as Record<string, string>));
vi.mock("../core/remoteApi", () => ({ default: (...args: any[]) => api(...args) }));
vi.mock("../core/logger", () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../helpers/cookieHelper", () => ({ cookieHelper: () => ({
  get: (key: string) => cookies[key] || "",
  set: vi.fn(),
  remove: vi.fn()
}) }));

// A fresh module per test is a fresh page load: its "already fetched" flag starts false again.
const loadPage = async ({ signedIn }: { signedIn: boolean }) => {
  vi.resetModules();
  const { useAuth } = await import("../composables/useAuth");
  const { accxuiConfig } = await import("../core/configRegistry");
  accxuiConfig.value = { ...accxuiConfig.value, oms: "test", current: { userId: "user" }, appVersion: "v5.0.0" };
  if(signedIn) useAuth().updateToken("session", String(Date.now() + 60000));
  return { useAuth, accxuiConfig };
};

describe("checkAppVersionRedirect re-reads the pin once per signed-in page load", () => {
  const replace = vi.fn();
  const location = { pathname: "/v5.0.0/tabs/orders", search: "?q=1", hash: "#top", replace };

  beforeEach(() => {
    api.mockReset();
    replace.mockReset();
    location.pathname = "/v5.0.0/tabs/orders";
    Object.assign(cookies, { oms: "test", userId: "user" });
    vi.stubEnv("VITE_APP_VERSION_CONFIG", JSON.stringify({ appId: "COMPANY", environmentTypeId: "AppEnvUAT", buildVersion: "" }));
    vi.stubGlobal("location", location);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("applies a pin changed in the OMS on the first navigation after a reload", async () => {
    api.mockResolvedValue({ data: [{ currentVersion: "v5.1.0" }] });
    const { useAuth, accxuiConfig } = await loadPage({ signedIn: true });

    // The persisted pin still matches the URL, so this navigation goes ahead while the fetch runs.
    expect(useAuth().checkAppVersionRedirect()).toBe(false);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/v5.1.0/tabs/orders?q=1#top"));

    expect(api).toHaveBeenCalledWith(expect.objectContaining({ url: "admin/apps/COMPANY/appVersions" }));
    expect(accxuiConfig.value.appVersion).toBe("v5.1.0");
  });

  it("fetches only once per page load, however many navigations follow", async () => {
    api.mockResolvedValue({ data: [{ currentVersion: "v5.0.0" }] });
    const { useAuth } = await loadPage({ signedIn: true });

    useAuth().checkAppVersionRedirect();
    useAuth().checkAppVersionRedirect();
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    useAuth().checkAppVersionRedirect();

    expect(api).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not repeat a fetch the Login page already made on this page load", async () => {
    api.mockResolvedValue({ data: [{ currentVersion: "v5.0.0" }] });
    const { useAuth } = await loadPage({ signedIn: true });

    await useAuth().fetchAppVersion();
    useAuth().checkAppVersionRedirect();

    expect(api).toHaveBeenCalledTimes(1);
  });

  it("does not fetch for a signed-out page load", async () => {
    const { useAuth } = await loadPage({ signedIn: false });

    expect(useAuth().checkAppVersionRedirect()).toBe(false);

    expect(api).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
