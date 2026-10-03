// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("../core/remoteApi", () => ({ default: (...args: any[]) => api(...args) }));
vi.mock("../core/logger", () => ({ default: logger }));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../helpers/cookieHelper", () => ({ cookieHelper: () => ({ get: () => "", set: vi.fn(), remove: vi.fn() }) }));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    isMoqui: () => true,
    getMaargURL: () => "https://maarg.test/rest/s1/",
    getOmsURL: () => "https://oms.test/api/",
    getTokenExpiration: () => undefined,
    isAppEmbedded: () => false,
    showToast: vi.fn()
  }
}));

const { useAuth } = await import("../composables/useAuth");
const { accxuiConfig } = await import("../core/configRegistry");

describe("logout reads the server's logout response", () => {
  const replace = vi.fn();

  beforeEach(() => {
    api.mockReset();
    logger.error.mockReset();
    replace.mockReset();
    accxuiConfig.value = { ...accxuiConfig.value, router: { replace } };
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
