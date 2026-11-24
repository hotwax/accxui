// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  isAuthenticated: { value: false },
  logout: vi.fn(async () => {}),
  clearAuth: vi.fn(),
}));
const embedded = vi.hoisted(() => ({ value: false }));

vi.mock("../composables/useAuth", () => ({ useAuth: () => auth }));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    getToken: () => document.cookie.match(/(?:^|; )token=([^;]*)/)?.[1] ?? "",
    getOMSInstanceName: () => document.cookie.match(/(?:^|; )oms=([^;]*)/)?.[1] ?? "",
    isAppEmbedded: () => embedded.value,
  },
}));

import { requestInterceptor } from "../core/remoteApi";
import emitter from "../core/emitter";
import { accxuiConfig } from "../core/configRegistry";
import { SESSION_CHANGED } from "../core/sessionChange";

const setCookie = (name: string, value: string) => { document.cookie = `${name}=${encodeURIComponent(value)}; path=/`; };
const later = String(Date.now() + 60 * 60 * 1000);
const setSession = (oms: string, userId: string, token = "tok", expirationTime = later) => {
  setCookie("oms", oms);
  setCookie("userId", userId);
  setCookie("token", token);
  setCookie("expirationTime", expirationTime);
};

describe("request guard when this tab's session no longer matches the cookies", () => {
  const heard = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    auth.isAuthenticated.value = false;
    embedded.value = false;
    accxuiConfig.value = { ...accxuiConfig.value, oms: "adoc-ni", current: { userId: "u1" } };
    emitter.on(SESSION_CHANGED, heard);
  });

  afterEach(() => { emitter.off(SESSION_CHANGED, heard); });

  // A login to another instance in another tab or app: the cookies hold its live session.
  it("refuses the call without logging out or clearing the other session's cookies", async () => {
    setSession("adoc-hn", "u1", "new-token");

    await expect(requestInterceptor({ url: "oms/orders", headers: {} })).rejects.toThrow("INVALID_APP_CONTEXT");

    expect(auth.logout).not.toHaveBeenCalled();
    expect(auth.clearAuth).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledWith({ field: "oms", from: "adoc-ni", to: "adoc-hn" });
  });

  it("reports another user on the same instance as a user change", async () => {
    setSession("adoc-ni", "u2", "new-token");

    await expect(requestInterceptor({ url: "oms/orders", headers: {} })).rejects.toThrow("INVALID_APP_CONTEXT");

    expect(auth.clearAuth).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledWith({ field: "userId", from: "u1", to: "u2" });
  });

  // A logout in another tab cleared the token: the session is gone, so this tab's ends as before.
  it("logs out as before when the cookie session is gone", async () => {
    setSession("adoc-ni", "", "");

    await expect(requestInterceptor({ url: "oms/orders", headers: {} })).rejects.toThrow("INVALID_APP_CONTEXT");

    expect(auth.logout).toHaveBeenCalledWith({ isUserUnauthorised: true, invalidAppContext: true });
    expect(auth.clearAuth).toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  it("logs out as before when the cookie session has expired", async () => {
    setSession("adoc-hn", "u2", "old-token", String(Date.now() - 1000));

    await expect(requestInterceptor({ url: "oms/orders", headers: {} })).rejects.toThrow("INVALID_APP_CONTEXT");

    expect(auth.logout).toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  it("refuses without an alert when this tab held no session", async () => {
    accxuiConfig.value = { ...accxuiConfig.value, oms: "", current: {} };
    setSession("adoc-hn", "u2", "new-token");

    await expect(requestInterceptor({ url: "oms/orders", headers: {} })).rejects.toThrow("INVALID_APP_CONTEXT");

    expect(auth.clearAuth).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  it("keeps the logout path for embedded apps, whose session isn't in the cookies", async () => {
    embedded.value = true;
    setSession("adoc-hn", "u2", "new-token");

    await expect(requestInterceptor({ url: "oms/orders", headers: {} })).rejects.toThrow("INVALID_APP_CONTEXT");

    expect(auth.logout).toHaveBeenCalled();
  });

  it("lets an authenticated call through with the token", async () => {
    auth.isAuthenticated.value = true;
    setSession("adoc-ni", "u1", "tok");

    const config = await requestInterceptor({ url: "oms/orders", headers: {} });

    expect(config.headers.Authorization).toBe("Bearer tok");
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
