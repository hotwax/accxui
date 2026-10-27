import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A backend fault (a 5xx, a dropped connection, a 401 Maarg sends when it cannot reach its
// database) must not sign the user out: retry it and say the service is unavailable.

vi.mock("comlink", () => ({ expose: () => {} }));
const logout = vi.hoisted(() => vi.fn(async () => {}));
const isAuthenticated = vi.hoisted(() => ({ value: true }));
vi.mock("../composables/useAuth", () => ({
  useAuth: () => ({ isAuthenticated, logout, clearAuth: vi.fn() }),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("../utils/commonUtil", () => ({
  commonUtil: { getToken: () => "t", getMaargURL: () => "https://x.test/rest/s1/", showToast },
}));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));

import { axios, MAX_RETRIES, retryDelayMs } from "../core/remoteApi";
import { isServiceUnavailable, markServiceAvailable } from "../core/serviceAvailability";
import { classifyError, createSyncHarness, unavailableBackoffMs, UNAVAILABLE_MAX_BACKOFF_MS } from "../db/sync/pollingWorkerHarness";
import { clearSyncRegistry, registerSyncDomain } from "../db/sync/syncRegistry";

type Reply = number | "network";

/** An axios adapter that answers each call with the next reply: a status, or no response at all. */
function adapterFor(replies: Reply[]) {
  const calls: any[] = [];
  const adapter = vi.fn(async (config: any) => {
    calls.push(config);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply === "network") {
      throw Object.assign(new Error("Network Error"), { config, request: {}, isAxiosError: true });
    }
    const response = { status: reply, data: {}, headers: {}, config, request: {} };
    if (reply >= 200 && reply < 300) return response;
    throw Object.assign(new Error(`Request failed with status code ${reply}`), { config, response, request: {}, isAxiosError: true });
  });

  return adapter;
}

/** Stub the bare instance the 401 check uses, answering with `status`. */
function profileCheckAnswers(status: Reply) {
  const request = vi.fn(async () => {
    if (status === 200) return { status: 200, data: {} };
    if (status === "network") throw Object.assign(new Error("Network Error"), { config: {}, request: {} });
    throw Object.assign(new Error("x"), { config: {}, response: { status } });
  });
  vi.spyOn(axios, "create").mockReturnValue({ request } as any);

  return request;
}

const call = async (adapter: any, method = "get", url = "oms/orders") => {
  const result = axios({ url, method, baseURL: "https://x.test/rest/s1/", adapter } as any)
    .then((resp) => resp.status, (err) => err?.response?.status ?? "network");
  await vi.runAllTimersAsync();

  return result;
};

describe("remoteApi on a backend fault", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isAuthenticated.value = true;
  });
  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    logout.mockClear();
    showToast.mockClear();
    markServiceAvailable();
  });

  it("retries a GET that got a 503 and recovers without logging out", async () => {
    const adapter = adapterFor([503, 503, 200]);

    expect(await call(adapter)).toBe(200);
    expect(adapter).toHaveBeenCalledTimes(3);
    expect(logout).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Service temporarily unavailable. Retrying...");
    expect(isServiceUnavailable()).toBe(false);
  });

  it("retries a GET that got no response at all", async () => {
    const adapter = adapterFor(["network", 200]);

    expect(await call(adapter)).toBe(200);
    expect(logout).not.toHaveBeenCalled();
  });

  it("stops after MAX_RETRIES and rejects with the server's error", async () => {
    const adapter = adapterFor([500]);

    expect(await call(adapter)).toBe(500);
    expect(adapter).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    expect(logout).not.toHaveBeenCalled();
    expect(isServiceUnavailable()).toBe(true);
  });

  it("never repeats a write on its own", async () => {
    const adapter = adapterFor([503, 200]);

    expect(await call(adapter, "post")).toBe(503);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
  });

  it("does not retry once the user has signed out meanwhile", async () => {
    const answer = adapterFor([503, 200]);
    const adapter = vi.fn(async (config: any) => {
      // Signed out while the first attempt was in flight.
      isAuthenticated.value = false;
      return answer(config);
    });

    expect(await call(adapter)).toBe(503);
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});

describe("remoteApi on a 401", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isAuthenticated.value = true;
  });
  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    logout.mockClear();
    markServiceAvailable();
  });

  it("logs out when the session check confirms the token is invalid", async () => {
    profileCheckAnswers(401);

    expect(await call(adapterFor([401]))).toBe(401);
    expect(logout).toHaveBeenCalledWith({ isUserUnauthorised: true });
  });

  it("keeps the session and retries once when the check says the token is fine", async () => {
    profileCheckAnswers(200);
    const adapter = adapterFor([401, 200]);

    expect(await call(adapter)).toBe(200);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(logout).not.toHaveBeenCalled();
  });

  it("keeps the session when the check itself cannot reach the server", async () => {
    profileCheckAnswers(503);

    await call(adapterFor([401]));
    expect(logout).not.toHaveBeenCalled();
  });

  it("checks the session once for a burst of 401s", async () => {
    const check = profileCheckAnswers(200);
    const adapter = adapterFor([401]);
    const results = Promise.all([1, 2, 3].map(() =>
      axios({ url: "oms/orders", method: "post", baseURL: "https://x.test/rest/s1/", adapter } as any).catch(() => {})));
    await vi.runAllTimersAsync();
    await results;

    expect(check).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
  });

  it("logs out straight away on a 401 from login (bad credentials)", async () => {
    const check = profileCheckAnswers(200);

    await call(adapterFor([401]), "post", "admin/login");
    expect(check).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalledWith({ isUserUnauthorised: true });
  });
});

describe("retry delays", () => {
  it("grows exponentially with jitter and is capped", () => {
    expect(retryDelayMs(1, undefined, () => 1)).toBe(1000);
    expect(retryDelayMs(3, undefined, () => 1)).toBe(4000);
    expect(retryDelayMs(3, undefined, () => 0)).toBe(2000);
    expect(retryDelayMs(20, undefined, () => 1)).toBe(30000);
  });

  it("honours a longer Retry-After, up to the cap", () => {
    expect(retryDelayMs(1, 7000, () => 1)).toBe(7000);
    expect(retryDelayMs(1, 600000, () => 1)).toBe(30000);
  });

  it("backs a sync domain off further on each unavailable pass", () => {
    expect(unavailableBackoffMs(1, undefined, () => 1)).toBe(1000);
    expect(unavailableBackoffMs(4, undefined, () => 1)).toBe(8000);
    expect(unavailableBackoffMs(30, undefined, () => 1)).toBe(UNAVAILABLE_MAX_BACKOFF_MS);
    expect(unavailableBackoffMs(1, 20000, () => 1)).toBe(20000);
  });
});

describe("sync harness classifies by status, not message", () => {
  it.each([
    [{ status: 401, errors: "Login key not valid" }, "auth"],
    [{ status: 503, errors: "User not authorized to open a DB connection" }, "unavailable"],
    [{ status: 500, message: "401 something" }, "unavailable"],
    [{ status: 429 }, "unavailable"],
    [Object.assign(new TypeError("Failed to fetch"), { networkError: true }), "unavailable"],
    [new TypeError("Cannot read properties of undefined"), "error"],
    [{ status: 403, errors: "User is not authorized for View" }, "error"],
    [{ errorCode: 401, errors: "Unauthorized" }, "auth"],
  ])("%o is %s", (err, kind) => {
    expect(classifyError(err).kind).toBe(kind);
  });

  afterEach(() => { vi.unstubAllGlobals(); clearSyncRegistry(); });

  it("posts a 5xx as an unavailable sync-error and backs the domain off", async () => {
    const posted: any[] = [];
    vi.stubGlobal("self", { postMessage: (message: any) => posted.push(message) });
    const sync = vi.fn(async () => { throw { status: 503, errors: "Error finding UserAccount: not authorized" }; });
    registerSyncDomain({ name: "d", label: "d", syncClass: "B", intervalMs: 1, sync } as any);
    const stubDb = () => ({
      syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
      table: () => ({ count: async () => 0 }), isOpen: () => true, open: async () => {}, name: "t",
    }) as any;
    const harness = createSyncHarness(stubDb);
    await harness.start({ maargUrl: "https://x.test/rest/s1/", token: "t", omsInstance: "demo", baseTickMs: 60_000, domains: [{ name: "d" }] });
    harness.stop();

    const failure = posted.find((message) => message.domain === "d" && /error/.test(message.type));
    expect(failure).toMatchObject({ type: "sync-error", unavailable: true });
  });
});
