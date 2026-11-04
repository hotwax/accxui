import { beforeEach, describe, expect, it, vi } from "vitest";

const initializeFaro = vi.fn();
const metasAdd = vi.fn();
const pushLog = vi.fn();
const webInstrumentations = vi.fn();

vi.mock("@grafana/faro-web-sdk", () => ({
  initializeFaro: (...args: any[]) => initializeFaro(...args),
  getWebInstrumentations: (...args: any[]) => {
    webInstrumentations(...args);

    return [];
  },
  faro: {
    metas: { add: (...args: any[]) => metasAdd(...args) },
    api: { pushLog: (...args: any[]) => pushLog(...args) }
  },
  LogLevel: { DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error", LOG: "log" }
}));

// commonUtil drags in Ionic, papaparse and friends; the only thing faroUtil asks it for is the
// Maarg instance, so stand that in rather than loading the whole helper.
vi.mock("../utils/commonUtil", () => ({
  commonUtil: { getMaargBaseURL: () => "https://demo-maarg.hotwax.io" }
}));

/**
 * faroUtil lives in the framework, so the user state on every signal has to come from the accxui
 * context the app passes to initialiseConfig — never from an app store.
 */
describe("faroUtil", () => {
  beforeEach(() => {
    initializeFaro.mockClear();
    metasAdd.mockClear();
    pushLog.mockClear();
    webInstrumentations.mockClear();
  });

  it("stays off when no collector is configured", async () => {
    const { faroUtil } = await load();

    await faroUtil.initialiseFaro();

    expect(initializeFaro).not.toHaveBeenCalled();
  });

  it("starts Faro with the app name it is given", async () => {
    const { faroUtil } = await load();

    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR, appName: "COMPANY" });

    expect(initializeFaro).toHaveBeenCalledTimes(1);
    expect(initializeFaro.mock.calls[0][0].url).toBe(COLLECTOR);
    expect(initializeFaro.mock.calls[0][0].app.name).toBe("COMPANY");
  });

  it("starts only once", async () => {
    const { faroUtil } = await load();

    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    expect(initializeFaro).toHaveBeenCalledTimes(1);
  });

  it("takes the user from the accxui context, not from an app store", async () => {
    const { faroUtil, accxuiConfig } = await load();
    accxuiConfig.value.current = { userId: "10000", userLoginId: "hotwax.user", userFullName: "Hotwax User" };
    accxuiConfig.value.oms = "https://demo-oms.hotwax.io";

    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const { user } = meta();
    expect(user.id).toBe("10000");
    expect(user.username).toBe("hotwax.user");
    expect(user.fullName).toBe("Hotwax User");
    expect(user.attributes.oms).toBe("https://demo-oms.hotwax.io");
    expect(user.attributes.maargInstance).toBe("https://demo-maarg.hotwax.io");
  });

  it("re-reads the context on every capture, so logout and instance switches are picked up", async () => {
    const { faroUtil, accxuiConfig } = await load();
    accxuiConfig.value.current = { userId: "10000" };

    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });
    expect(meta().user.id).toBe("10000");

    // What useAuth does on logout
    accxuiConfig.value.current = {};

    expect(meta().user.id).toBeUndefined();
  });

  it("merges the extra context an app supplies into user.attributes", async () => {
    const { faroUtil } = await load();

    await faroUtil.initialiseFaro({
      collectorUrl: COLLECTOR,
      getContext: () => ({ maargInstanceName: "Demo", maargInstancePurpose: "UAT", missing: "" })
    });

    const { attributes } = meta().user;
    expect(attributes.maargInstanceName).toBe("Demo");
    expect(attributes.maargInstancePurpose).toBe("UAT");
    // Empty values are dropped rather than shipped as ""
    expect(attributes.missing).toBeUndefined();
  });

  it("survives an app context getter that throws", async () => {
    const { faroUtil, accxuiConfig } = await load();
    accxuiConfig.value.current = { userId: "10000" };

    await faroUtil.initialiseFaro({
      collectorUrl: COLLECTOR,
      getContext: () => { throw new Error("store not ready") }
    });

    expect(meta().user.id).toBe("10000");
  });

  it("pushes a logged line to Faro at the matching level", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    faroUtil.faroLoggerHook.run({ level: "warn", argumentArray: ["Order sync slow"] } as any);

    expect(pushLog).toHaveBeenCalledWith(["Order sync slow"], expect.objectContaining({ level: "warn" }));
  });

  it("does not push anything before Faro is started", async () => {
    const { faroUtil } = await load();

    faroUtil.faroLoggerHook.run({ level: "error", argumentArray: ["too early"] } as any);

    expect(pushLog).not.toHaveBeenCalled();
  });

  it("collects neither console output nor navigation and resource timing", async () => {
    const { faroUtil } = await load();

    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    expect(webInstrumentations).toHaveBeenCalledWith({
      captureConsole: false,
      enablePerformanceInstrumentation: false
    });
  });

  it("removes the named params from page_url and keeps the rest", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const item = scrub({
      meta: { page: { url: "https://company.hotwax.io/orders?orderId=8831f2&shop=demo.myshopify.com&hmac=def" } }
    });

    expect(item.meta.page.url).toBe("https://company.hotwax.io/orders?orderId=8831f2");
  });

  it("keeps params that carry debugging value", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const url = "https://company.hotwax.io/orders?facilityId=STORE_1&status=open&page=2";
    const item = scrub({ meta: { page: { url } } });

    // No secrets present, so the URL comes back exactly as it went in.
    expect(item.meta.page.url).toBe(url);
  });

  it("catches token variants that are not in the list by name", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const item = scrub({
      meta: { page: { url: "https://company.hotwax.io/?id_token=a&access_token=b&clientSecret=c&apiKey=d&orderId=1" } }
    });

    expect(item.meta.page.url).toBe("https://company.hotwax.io/?orderId=1");
  });

  it("filters the fragment without discarding what else is in it", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const item = scrub({
      meta: { page: { url: "https://company.hotwax.io/orders#access_token=xyz&view=list" } }
    });

    expect(item.meta.page.url).toBe("https://company.hotwax.io/orders#view=list");
  });

  it("strips secrets from every relative URL shape, leaving the path exactly as it was", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const attributes = {
      rootRelative: "/settings?token=abc&tab=general",
      dotRelative: "./orders?code=1&status=open",
      bare: "orders?hmac=x&orderId=9",
      queryOnly: "?jwtToken=zz&page=2",
      parent: "../admin?api_key=k&q=1",
      onlySecret: "/x?token=only"
    };

    const item = scrub({ payload: { attributes } });

    // No origin invented, no path normalised: "./" and "../" survive as written.
    expect(item.payload.attributes.rootRelative).toBe("/settings?tab=general");
    expect(item.payload.attributes.dotRelative).toBe("./orders?status=open");
    expect(item.payload.attributes.bare).toBe("orders?orderId=9");
    expect(item.payload.attributes.queryOnly).toBe("?page=2");
    expect(item.payload.attributes.parent).toBe("../admin?q=1");
    // Nothing left to keep, so the "?" goes with it.
    expect(item.payload.attributes.onlySecret).toBe("/x");
  });

  it("passes surviving params through byte for byte rather than re-encoding them", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const item = scrub({ payload: { attributes: { to: "/orders?filter=a%2Fb&token=x" } } });

    expect(item.payload.attributes.to).toBe("/orders?filter=a%2Fb");
  });

  it("leaves text that is not a URL alone, even when it contains a question mark", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const item = scrub({ payload: { attributes: { reason: "Request failed? check the proxy" } } });

    expect(item.payload.attributes.reason).toBe("Request failed? check the proxy");
  });

  it("redacts a JWT that reached a message", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
    const item = scrub({ payload: { message: "Auth failed for " + token } });

    expect(item.payload.message).toBe("Auth failed for [redacted-jwt]");
  });

  it("passes a malformed item through rather than throwing into the caller", async () => {
    const { faroUtil } = await load();
    await faroUtil.initialiseFaro({ collectorUrl: COLLECTOR });

    expect(() => scrub({})).not.toThrow();
    expect(() => scrub({ meta: { page: {} } })).not.toThrow();
  });

  const COLLECTOR = "https://faro-uat.hotwax.io/collect";

  /**
   * A fresh copy of both modules: faroUtil only starts once per module instance, and its context
   * getter has to read the same configRegistry the test writes to.
   */
  async function load() {
    vi.resetModules();
    const { accxuiConfig } = await import("../core/configRegistry");
    const { faroUtil } = await import("../utils/faroUtil");

    return { accxuiConfig, faroUtil };
  }

  /** The meta Faro would attach to the next signal. */
  function meta() {
    return metasAdd.mock.calls[0][0]() as { user: Record<string, any> };
  }

  /** Runs a transport item through the beforeSend hook Faro was started with. */
  function scrub(item: any) {
    return initializeFaro.mock.calls[0][0].beforeSend(item);
  }
});
