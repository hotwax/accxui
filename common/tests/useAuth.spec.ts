// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("../core/remoteApi", () => ({ default: (...args: any[]) => api(...args) }));
vi.mock("../core/logger", () => ({ default: logger }));
vi.mock("../core/i18n", () => ({ translate: (key: string, params?: any) => key.replace(/\{(\w+)\}/g, (_, k) => params?.[k] ?? `{${k}}`) }));
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

  it("falls back gracefully on network error", async () => {
    api.mockRejectedValue(new Error("Network Error"));

    await expect(useAuth().login("user", "pass")).rejects.toThrow("Network Error");
    expect(commonUtil.showToast).toHaveBeenCalledWith("Failed to login. Network Error");
    expect(logger.error).toHaveBeenCalledWith("Failed to login", "Network Error");
  });

  it("falls back to default message when server returns no extractable error", async () => {
    api.mockRejectedValue({
      response: {
        data: {}
      }
    });

    await expect(useAuth().login("user", "pass")).rejects.toThrow("Please contact administrator.");
    expect(commonUtil.showToast).toHaveBeenCalledWith("Failed to login. Please contact administrator.");
    expect(logger.error).toHaveBeenCalledWith("Failed to login", "Please contact administrator.");
  });
});
