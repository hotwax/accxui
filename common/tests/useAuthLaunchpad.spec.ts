// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://order-manager.hotwax.io"}
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../composables/useAuth";
import { cookieHelper } from "../helpers/cookieHelper";
import api from "../core/remoteApi";

vi.mock("../core/remoteApi", () => ({ default: vi.fn() }));
vi.mock("../core/logger", () => ({ default: { error: vi.fn() } }));
vi.mock("../core/i18n", () => ({ translate: (key: string) => key }));

const oms = "https://demo-east-oms.hotwax.io";
const maarg = "https://demo-east-maarg.hotwax.io";
const otherMaarg = "https://demo-west-maarg.hotwax.io";
const native = "https://native-demo.hotwax.io";
const basic = { loginAuthType: "BASIC" };
const hybridResponse = { data: { ...basic, maargInstanceUrl: maarg } };

describe("legacy Launchpad login", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VITE_OMS_TYPE", "");
    setActivePinia(createPinia());
    cookieHelper().set("maarg", otherMaarg);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("discovers the paired Maarg from the only OMS in an older link", async () => {
    vi.mocked(api).mockResolvedValue(hybridResponse);
    expect(await useAuth().verifyLaunchpadOms(oms + "/api/", undefined, true)).toBe(true);
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ url: "checkLoginOptions", baseURL: oms + "/api/" }));
    expect(cookieHelper().get("maarg")).toBe(maarg);
  });

  it("accepts a pair from the selected OMS and rejects a different country", async () => {
    vi.mocked(api).mockResolvedValue(hybridResponse);
    expect(await useAuth().verifyLaunchpadOms("demo-east-maarg", oms + ":443", true)).toBe(true);
    expect(await useAuth().verifyLaunchpadOms(otherMaarg, oms, true)).toBe(false);
  });

  it("accepts a single-host Moqui OMS in both link formats", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("OFBiz endpoint unavailable"))
      .mockResolvedValueOnce({ data: basic })
      .mockRejectedValueOnce(new Error("OFBiz endpoint unavailable"))
      .mockResolvedValueOnce({ data: { ...basic, omsInstanceUrl: oms } });
    expect(await useAuth().verifyLaunchpadOms(native + "/rest/s1/", undefined, true)).toBe(true);
    expect(await useAuth().verifyLaunchpadOms(native + ":443/rest/s1", "native-demo", true)).toBe(true);
  });

  it("checks the reverse pairing on a Moqui-only app build", async () => {
    vi.stubEnv("VITE_OMS_TYPE", "MOQUI");
    vi.mocked(api).mockResolvedValue({ data: { ...basic, omsInstanceUrl: oms } });
    expect(await useAuth().verifyLaunchpadOms(maarg, oms + "/api/", true)).toBe(true);
    expect(await useAuth().verifyLaunchpadOms(maarg, "demo-west-oms", true)).toBe(false);
  });

  it("requires a fresh Maarg for a Maarg app, while an OFBiz-only app can use its OMS", async () => {
    vi.mocked(api).mockResolvedValue({ data: basic });
    expect(await useAuth().verifyLaunchpadOms(oms, undefined, true)).toBe(false);
    expect(await useAuth().verifyLaunchpadOms(oms, undefined, false)).toBe(true);
  });

  it("rejects an unavailable OMS and an unrelated HTTP 200 response", async () => {
    vi.mocked(api).mockRejectedValue(new Error("unavailable"));
    expect(await useAuth().verifyLaunchpadOms(oms, undefined, true)).toBe(false);
    vi.mocked(api).mockResolvedValue({ data: "<html>App shell</html>" });
    expect(await useAuth().verifyLaunchpadOms(oms, undefined, true)).toBe(false);
  });

  it("clears the shared-domain session before discovery even when the pair is rejected", async () => {
    document.cookie = "token=previous-session; path=/; domain=hotwax.io";
    expect(document.cookie).toContain("previous-session");
    vi.mocked(api).mockImplementation(async () => {
      expect(document.cookie).not.toContain("previous-session");
      expect(cookieHelper().get("token")).toBeFalsy();
      return hybridResponse;
    });
    expect(await useAuth().verifyLaunchpadOms(otherMaarg, oms, true)).toBe(false);
    expect(api).toHaveBeenCalledTimes(1);
    expect(document.cookie).not.toContain("previous-session");
  });

  it("supports a local backend with a port and deployment path", async () => {
    const localMaarg = "http://localhost:8081/tenant";
    vi.mocked(api).mockResolvedValue({ data: { ...basic, maargInstanceUrl: localMaarg } });
    expect(await useAuth().verifyLaunchpadOms(new URL(localMaarg), "localhost:8080/tenant/api/", true)).toBe(true);
    expect(api).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "http://localhost:8080/tenant/api/" }));
  });

  it.each([
    ["ambiguous query", [oms, maarg]],
    ["credentials", "https://unwanted@demo-east-oms.hotwax.io"],
    ["query", oms + "?parameter=value"],
    ["fragment", oms + "#fragment"],
    ["undefined handle", "undefined"],
    ["null hostname", "https://null.hotwax.io"],
    ["empty OMS", null],
  ])("rejects %s before discovery", async (_label, invalid) => {
    expect(await useAuth().verifyLaunchpadOms(invalid, undefined, true)).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });
});
