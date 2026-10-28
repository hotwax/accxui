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
});
