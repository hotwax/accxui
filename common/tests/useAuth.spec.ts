// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("../core/remoteApi", () => ({ default: (...args: any[]) => api(...args) }));
vi.mock("../core/logger", () => ({ default: logger }));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../helpers/cookieHelper", () => ({ cookieHelper: () => ({ get: () => "", set: vi.fn(), remove: vi.fn() }) }));
vi.mock("../utils/commonUtil", async (importOriginal) => {
  const actual: any = await importOriginal();

  return {
    commonUtil: {
      ...actual.commonUtil,
      isMoqui: () => true,
      getMaargURL: () => "https://maarg.test/rest/s1/",
      getOmsURL: () => "https://oms.test/api/",
      getTokenExpiration: () => undefined,
      isAppEmbedded: () => false,
      getToken: vi.fn(() => ""),
      showToast: vi.fn()
    }
  };
});

const { useAuth } = await import("../composables/useAuth");
const { accxuiConfig } = await import("../core/configRegistry");
const { commonUtil } = await import("../utils/commonUtil");

describe("logout reads the server's logout response", () => {
  const replace = vi.fn();

  beforeEach(() => {
    api.mockReset();
    logger.error.mockReset();
    replace.mockReset();
    vi.mocked(commonUtil.showToast).mockClear();
    vi.mocked(commonUtil.getToken).mockReturnValue("");
    useAuth().clearAuth();
    accxuiConfig.value = { ...accxuiConfig.value, postLogout: undefined, router: { replace } };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes a Maarg response, which axios has already parsed, and goes to the login page", async () => {
    // Maarg's admin/logout answers 200 with an empty JSON object.
    api.mockResolvedValue({ status: 200, data: {} });

    await useAuth().logout();

    expect(logger.error).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("does not repeat logout or announce expiry for a late request after normal logout clears the token", async () => {
    api.mockResolvedValue({ status: 200, data: {} });
    const postLogout = vi.fn(async () => {
      // A Settings loader resumes during reset; remoteApi rejects its unauthenticated
      // protected request and reports INVALID_APP_CONTEXT through this same call.
      accxuiConfig.value.postLogout = undefined;
      await useAuth().logout({ isUserUnauthorised: true, invalidAppContext: true });
    });
    accxuiConfig.value.postLogout = postLogout;
    useAuth().updateToken("active-session", "");

    await useAuth().logout({ isUserUnauthorised: false });

    expect(commonUtil.showToast).not.toHaveBeenCalled();
    expect(postLogout).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("still reports genuine invalidation of an active session", async () => {
    useAuth().updateToken("active-session", "");
    await useAuth().logout({ isUserUnauthorised: true, invalidAppContext: true });
    expect(commonUtil.showToast).toHaveBeenCalledWith("Session expired. Refreshing...");
    expect(replace).toHaveBeenCalledWith("/login");
    expect(api).not.toHaveBeenCalled();
  });

  it("still handles invalidation when the embedded token exists outside the standalone token ref", async () => {
    vi.mocked(commonUtil.getToken).mockReturnValue("embedded-session");
    await useAuth().logout({ isUserUnauthorised: true, invalidAppContext: true });
    expect(commonUtil.showToast).toHaveBeenCalledWith("Session expired. Refreshing...");
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("still handles a missing token when it was not cleared by normal logout", async () => {
    useAuth().updateToken("active-session", "");
    useAuth().clearAuth();
    await useAuth().logout({ isUserUnauthorised: true, invalidAppContext: true });
    expect(commonUtil.showToast).toHaveBeenCalledWith("Session expired. Refreshing...");
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("still follows an OFBiz SAML logout, whose JSON arrives as text behind a \"//\" prefix", async () => {
    api.mockResolvedValue({ status: 200, data: "//{\"logoutAuthType\":\"SAML2SSO\",\"logoutUrl\":\"https://idp.test/logout\"}" });
    // jsdom reports the identity provider redirect as an unimplemented navigation.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await useAuth().logout();

    expect(logger.error).not.toHaveBeenCalled();
    // Redirected to the identity provider instead.
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("login displays and logs extracted server error", () => {
  beforeEach(() => {
    api.mockReset();
    logger.error.mockReset();
    vi.mocked(commonUtil.showToast).mockClear();
    useAuth().clearAuth();
  });

  it("extracts OFBiz error message, displays toast, and logs error", async () => {
    api.mockResolvedValue({
      status: 200,
      data: { _ERROR_MESSAGE_: "User does not exist" }
    });

    await expect(useAuth().login("user", "pass")).rejects.toThrow("User does not exist");
    expect(commonUtil.showToast).toHaveBeenCalledWith("Failed to login. User does not exist");
    expect(logger.error).toHaveBeenCalledWith("Failed to login", "User does not exist");
  });

  it("extracts Moqui rejected error message, displays toast, and logs error", async () => {
    api.mockRejectedValue({
      response: {
        data: { errors: "Invalid password" }
      }
    });

    await expect(useAuth().login("user", "pass")).rejects.toThrow("Invalid password");
    expect(commonUtil.showToast).toHaveBeenCalledWith("Failed to login. Invalid password");
    expect(logger.error).toHaveBeenCalledWith("Failed to login", "Invalid password");
  });

  it("uses error.message on a network error", async () => {
    api.mockRejectedValue(new Error("Network Error"));

    await expect(useAuth().login("user", "pass")).rejects.toThrow("Network Error");
    expect(commonUtil.showToast).toHaveBeenCalledWith("Failed to login. Network Error");
    expect(logger.error).toHaveBeenCalledWith("Failed to login", "Network Error");
  });

  it("shows only the static prefix when the server returns no extractable error", async () => {
    api.mockRejectedValue({
      response: {
        data: {}
      }
    });

    await expect(useAuth().login("user", "pass")).rejects.toBeInstanceOf(Error);
    expect(commonUtil.showToast).toHaveBeenCalledWith(expect.stringContaining("Failed to login."));
    expect(logger.error).toHaveBeenCalledWith("Failed to login", "");
  });
});

describe("fetchAppVersion re-resolves the pinned version", () => {
  const replace = vi.fn();
  const location = { pathname: "/v5.0.0/tabs/orders", search: "?q=1", hash: "#top", replace };

  beforeEach(() => {
    api.mockReset();
    replace.mockReset();
    location.pathname = "/v5.0.0/tabs/orders";
    vi.stubEnv("VITE_APP_VERSION_CONFIG", JSON.stringify({ appId: "COMPANY", environmentTypeId: "AppEnvUAT", buildVersion: "" }));
    vi.stubGlobal("location", location);
    accxuiConfig.value = { ...accxuiConfig.value, appVersion: "v5.0.0" };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("moves a session onto a version changed in the OMS, keeping path, query and hash", async () => {
    api.mockResolvedValue({ data: [{ currentVersion: "v5.1.0" }] });

    await useAuth().fetchAppVersion();

    expect(api).toHaveBeenCalledWith(expect.objectContaining({ url: "admin/apps/COMPANY/appVersions" }));
    expect(accxuiConfig.value.appVersion).toBe("v5.1.0");
    expect(replace).toHaveBeenCalledWith("/v5.1.0/tabs/orders?q=1#top");
  });

  it("stays put when the OMS still pins the same version", async () => {
    api.mockResolvedValue({ data: [{ currentVersion: "v5.0.0" }] });

    await useAuth().fetchAppVersion();

    expect(accxuiConfig.value.appVersion).toBe("v5.0.0");
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps an already resolved version when the call fails", async () => {
    api.mockRejectedValue(new Error("Network Error"));

    await useAuth().fetchAppVersion();

    expect(accxuiConfig.value.appVersion).toBe("v5.0.0");
    expect(replace).not.toHaveBeenCalled();
  });

  it("treats an error body as a failure, not as no version configured", async () => {
    api.mockResolvedValue({ data: { _ERROR_MESSAGE_: "Service unavailable" } });

    await useAuth().fetchAppVersion();

    expect(accxuiConfig.value.appVersion).toBe("v5.0.0");
    expect(replace).not.toHaveBeenCalled();
  });

  it("strips the version when the OMS no longer pins one", async () => {
    api.mockResolvedValue({ data: [] });

    await useAuth().fetchAppVersion();

    expect(accxuiConfig.value.appVersion).toBe("");
    expect(replace).toHaveBeenCalledWith("/tabs/orders?q=1#top");
  });

  it("falls back to root when the call fails before any version was resolved", async () => {
    accxuiConfig.value.appVersion = undefined;
    api.mockRejectedValue(new Error("Network Error"));

    await useAuth().fetchAppVersion();

    expect(accxuiConfig.value.appVersion).toBe("");
    expect(replace).toHaveBeenCalledWith("/tabs/orders?q=1#top");
  });
});
