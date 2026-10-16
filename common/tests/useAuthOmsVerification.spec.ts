// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => new Map<string, string>());
vi.mock("../core/remoteApi", () => ({ default: (...args: any[]) => api(...args) }));
vi.mock("../core/logger", () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../helpers/cookieHelper", () => ({
  cookieHelper: () => ({
    get: (key: string) => cookies.get(key) || "",
    set: (key: string, value: string) => { cookies.set(key, value); },
    remove: (key: string) => { cookies.delete(key); }
  })
}));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    isMoqui: () => true,
    // Mirrors the real helper: no maarg cookie means no URL to call.
    getMaargURL: () => (cookies.get("maarg") ? `https://${cookies.get("maarg")}.hotwax.io/rest/s1/` : ""),
    getOmsURL: () => `https://${cookies.get("oms")}.hotwax.io/rest/s1/`,
    getTokenExpiration: () => undefined,
    isAppEmbedded: () => false,
    getToken: () => "",
    hasError: (resp: any) => !resp || resp.status >= 400,
    showToast: vi.fn()
  }
}));

const { useAuth } = await import("../composables/useAuth");

describe("signing in only reaches the OMS that was verified", () => {
  beforeEach(() => {
    api.mockReset();
    cookies.clear();
    // A session on another instance left its maarg cookie behind.
    cookies.set("maarg", "test-maarg");
  });

  it("drops the previous instance's maarg and reports failure when the entered OMS does not answer", async () => {
    cookies.set("oms", "rails oms");
    api.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    const isReachable = await useAuth().fetchLoginOptions();

    expect(isReachable).toBe(false);
    expect(cookies.has("maarg")).toBe(false);
    expect(useAuth().loginOption.value).toEqual({});
  });

  it("points maarg at the entered Moqui OMS when it answers", async () => {
    cookies.set("oms", "rails-oms");
    api.mockResolvedValue({ status: 200, data: { loginAuthType: "BASIC" } });

    const isReachable = await useAuth().fetchLoginOptions();

    expect(isReachable).toBe(true);
    expect(cookies.get("maarg")).toBe("rails-oms");
  });

  it("refuses a username and password sign-in when no instance was verified", async () => {
    cookies.set("oms", "rails oms");
    api.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    await useAuth().fetchLoginOptions();
    api.mockReset();

    await expect(useAuth().login("dev.user", "secret")).rejects.toThrow("OMS is not verified");
    expect(api).not.toHaveBeenCalled();
  });
});
