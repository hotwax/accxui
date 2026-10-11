// @vitest-environment jsdom
// Test adapters/hooks intentionally model asynchronously rejected and resolved promises.
/* eslint-disable require-await */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.hoisted(() => new Map<string, string>());
vi.mock("../helpers/cookieHelper", () => ({ cookieHelper: () => ({
  get: (name: string) => cookies.get(name) || null,
  set: (name: string, value: string) => cookies.set(name, value),
  remove: (name: string) => cookies.delete(name)
}) }));
vi.mock("../utils/commonUtil", () => ({ commonUtil: {
  getToken: () => cookies.get("token"),
  getTokenExpiration: () => cookies.get("expirationTime"),
  getOmsURL: () => `https://${cookies.get("oms") || "oms"}.test/api/`,
  getMaargURL: () => `https://${cookies.get("maarg") || "maarg"}.test/rest/s1/`,
  isMoqui: () => true,
  isAppEmbedded: () => false,
  hasError: () => false,
  showToast: vi.fn()
} }));
vi.mock("./logger", () => ({ default: { error: vi.fn() } }));
vi.mock("./i18n", () => ({ translate: (value: string) => value }));
vi.mock("./emitter", () => ({ default: { emit: vi.fn() } }));
vi.mock("../store/embeddedApp", () => ({ useEmbeddedAppStore: vi.fn() }));
vi.mock("./sessionScope", () => ({ clearSessionScopedState: vi.fn() }));

let api: typeof import("./remoteApi").default;
let axios: typeof import("./remoteApi").axios;
let useAuth: typeof import("../composables/useAuth").useAuth;
let config: typeof import("./configRegistry").accxuiConfig;
let postLogout: ReturnType<typeof vi.fn>;
let replace: ReturnType<typeof vi.fn>;

function sharedSession(token = "session-a", oms = "oms", userId = "user-a") {
  cookies.set("token", token);
  cookies.set("expirationTime", String(Date.now() + 60_000));
  cookies.set("oms", oms);
  cookies.set("maarg", oms);
  cookies.set("userId", userId);
}

function fail(status: number, request: any) {
  return Object.assign(new Error("request failed"), { config: request, response: {
    status, statusText: "failed", config: request, data: {}, headers: {}
  } });
}

async function pendingRequest() {
  let reject!: (error: any) => void;
  let resolve!: (response: any) => void;
  let requestConfig: any;
  const adapter = vi.fn((request: any) => {
    requestConfig = request;

    return new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  });
  axios.defaults.adapter = adapter;
  const result = api({ url: "admin/user/profile", method: "GET" }).catch(error => error);
  await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());

  return { result, reject, resolve, requestConfig };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  cookies.clear();
  sharedSession();
  const rawAxios = (await import("axios")).default;
  for(const manager of [rawAxios.interceptors.request, rawAxios.interceptors.response]) {
    const handlers = (manager as any).handlers as unknown[];
    handlers.forEach((_, index) => manager.eject(index));
  }
  ({ default: api, axios } = await import("./remoteApi"));
  ({ useAuth } = await import("../composables/useAuth"));
  ({ accxuiConfig: config } = await import("./configRegistry"));
  replace = vi.fn();
  postLogout = vi.fn(async () => { config.value.current = {}; });
  config.value = {
    current: { userId: "user-a" }, oms: "oms", router: { replace },
    preLogout: vi.fn(async () => undefined), postLogout,
    postLogin: vi.fn(async () => undefined)
  };
  useAuth();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("shared session invalidation", () => {
  it.each([undefined, 500])("preserves a session on transport/server failure (%s)", async status => {
    axios.defaults.adapter = async request => { throw status ? fail(status, request) : new Error("Network Error"); };
    await expect(api({ url: "admin/user/profile" })).rejects.toThrow();
    expect(cookies.get("token")).toBe("session-a");
    expect(postLogout).not.toHaveBeenCalled();
  });

  it("ignores a late 401 from the previous token", async () => {
    const pending = await pendingRequest();
    useAuth().updateToken("session-b", String(Date.now() + 120_000));
    pending.reject(fail(401, pending.requestConfig));
    await pending.result;
    expect(cookies.get("token")).toBe("session-b");
    expect(postLogout).not.toHaveBeenCalled();
  });

  it("does not send a queued request after another app changes the session", async () => {
    const adapter = vi.fn();
    axios.defaults.adapter = adapter;
    const result = api({ url: "admin/user/profile" }).catch(error => error);
    sharedSession("session-b", "another-oms", "user-b");
    expect((await result).message).toBe("STALE_AUTH_REQUEST");
    expect(adapter).not.toHaveBeenCalled();
    expect(cookies.get("token")).toBe("session-b");
    expect(postLogout).not.toHaveBeenCalled();
  });

  it("rejects a stale success instead of letting old profile data update the new session", async () => {
    const pending = await pendingRequest();
    sharedSession("session-b", "another-oms", "user-b");
    pending.resolve({ status: 200, data: { userId: "user-a" }, config: pending.requestConfig });
    expect((await pending.result).message).toBe("STALE_AUTH_REQUEST");
    expect(cookies.get("token")).toBe("session-b");
    expect(cookies.get("userId")).toBe("user-b");
  });

  it("allows parallel bootstrap requests when the profile first fills userId", async () => {
    cookies.delete("userId");
    const pending = await pendingRequest();
    useAuth().updateUserId("user-a");
    pending.resolve({ status: 200, data: {}, config: pending.requestConfig });
    expect((await pending.result).status).toBe(200);
    expect(cookies.get("token")).toBe("session-a");
  });

  it("still clears shared credentials when the current backend rejects the current token", async () => {
    axios.defaults.adapter = async request => { throw fail(401, request); };
    await expect(api({ url: "admin/orders" })).rejects.toThrow();
    expect(cookies.has("token")).toBe(false);
    expect(postLogout).toHaveBeenCalledOnce();
  });

  it.each([
    { url: "admin/login" },
    { url: "orders", baseURL: "https://unrelated.test/" }
  ])("does not clear credentials for an unrelated/login 401 ($url)", async request => {
    axios.defaults.adapter = async request => { throw fail(401, request); };
    await expect(api(request)).rejects.toThrow();
    expect(cookies.get("token")).toBe("session-a");
    expect(postLogout).not.toHaveBeenCalled();
  });

  it("resets a mismatched app locally without sending a request or deleting the newer session", async () => {
    sharedSession("session-b", "another-oms", "user-b");
    const adapter = vi.fn();
    axios.defaults.adapter = adapter;
    await expect(api({ url: "admin/orders" })).rejects.toThrow("INVALID_APP_CONTEXT");
    expect(adapter).not.toHaveBeenCalled();
    expect(postLogout).toHaveBeenCalledOnce();
    expect(cookies.get("token")).toBe("session-b");
    expect(cookies.get("userId")).toBe("user-b");
  });

  it("uses renewed cookie expiry instead of an older tab's expired auth ref", async () => {
    useAuth().updateToken("session-a", String(Date.now() + 100));
    sharedSession("session-b");
    await vi.advanceTimersByTimeAsync(200);
    expect(useAuth().isAuthenticated.value).toBe(true);
    expect(cookies.get("token")).toBe("session-b");
  });

  it.each([new Error("Network Error"), new Error("No product stores"), new Error("Permission lookup failed")])("preserves shared credentials when session restoration/setup fails: %s", async error => {
    config.value.postLogin = async () => { throw error; };
    await expect(useAuth().login(undefined, undefined, "session-a", cookies.get("expirationTime"))).rejects.toThrow();
    expect(cookies.get("token")).toBe("session-a");
    expect(config.value.current).toEqual({});
  });

  it("does not install a delayed login response over another tab's newer session", async () => {
    let resolve!: (response: any) => void;
    const adapter = vi.fn(request => new Promise<any>(yes => { resolve = data => yes({ ...data, config: request }); }));
    axios.defaults.adapter = adapter;
    const result = useAuth().login("test-user", "test-password").catch(error => error);
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());
    sharedSession("session-b", "another-oms", "user-b");
    resolve({ status: 200, data: { token: "late-token", expirationTime: Date.now() + 60_000 } });
    expect((await result).message).toBe("STALE_AUTH_REQUEST");
    expect(cookies.get("token")).toBe("session-b");
  });

  it("manual logout removes shared cookies even if the logout request fails", async () => {
    axios.defaults.adapter = async () => { throw new Error("Network Error"); };
    await useAuth().logout();
    expect(cookies.has("token")).toBe(false);
    expect(cookies.has("userId")).toBe(false);
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("does not let a delayed manual logout erase a newer login", async () => {
    let resolve!: (response: any) => void;
    const adapter = vi.fn(request => new Promise<any>(yes => { resolve = () => yes({ data: {}, config: request }); }));
    axios.defaults.adapter = adapter;
    const result = useAuth().logout();
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());
    useAuth().updateToken("session-b", String(Date.now() + 120_000));
    resolve({});
    await result;
    expect(cookies.get("token")).toBe("session-b");
    expect(postLogout).not.toHaveBeenCalled();
  });

  it("an idle tab observes another app's logout and resets locally", async () => {
    cookies.delete("token");
    cookies.delete("expirationTime");
    cookies.delete("userId");
    await vi.advanceTimersByTimeAsync(1000);
    expect(postLogout).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/login");
    expect(cookies.has("token")).toBe(false);
  });

  it("does not redirect a newer login when old logout cleanup finishes", async () => {
    let finishCleanup!: () => void;
    postLogout.mockImplementation(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
    const result = useAuth().logout({ isUserUnauthorised: true });
    expect(postLogout).toHaveBeenCalledOnce();
    sharedSession("session-b");
    finishCleanup();
    await result;
    expect(cookies.get("token")).toBe("session-b");
    expect(replace).not.toHaveBeenCalled();
  });

  it("an idle stale tenant tab preserves another app's newer login", async () => {
    sharedSession("session-b", "another-oms", "user-b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(postLogout).toHaveBeenCalledOnce();
    expect(cookies.get("token")).toBe("session-b");
    expect(cookies.get("userId")).toBe("user-b");
  });
});
