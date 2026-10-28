import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import logger from "../core/logger";
import { logStore } from "../core/logStore";

/**
 * Every app's logger keeps its lines in the log store, and errors that never reach Vue's errorHandler
 * (an unhandled promise rejection, an error thrown outside a component) go through it too.
 */
describe("logger", () => {
  const listeners: Record<string, (event: any) => void> = {};
  // Nothing is written: this only checks what reaches the store
  const storeRun = vi.spyOn(logStore.logStoreHook, "run").mockImplementation(() => undefined);

  beforeAll(() => {
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = listener; }
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    // No option turns the store on: it is part of every install
    logger.install({ config: { globalProperties: {} }, provide: () => undefined }, { level: "error" });
  });

  it("stores a line logged through the logger", async () => {
    logger.error("Order sync failed");

    expect((await storedLine()).text).toBe("Order sync failed");
  });

  beforeEach(() => {
    storeRun.mockClear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The line the store was handed, as one string. */
  async function storedLine() {
    await vi.waitFor(() => expect(storeRun).toHaveBeenCalledTimes(1));
    const event = storeRun.mock.calls[0][0] as { level: string; argumentArray: unknown[] };

    return { level: event.level, text: event.argumentArray.join(" ") };
  }

  it("stores an unhandled promise rejection with the error's message", async () => {
    listeners.unhandledrejection({ reason: new Error("order sync failed") });

    const { level, text } = await storedLine();
    expect(level).toBe("error");
    expect(text).toContain("Unhandled promise rejection:");
    expect(text).toContain("order sync failed");
  });

  it("stores a rejection whose reason is not an Error", async () => {
    listeners.unhandledrejection({ reason: "timeout" });

    expect((await storedLine()).text).toContain("timeout");
  });

  it("stores a window error with where it was thrown", async () => {
    listeners.error({ error: new Error("cannot read id"), message: "cannot read id", filename: "app.js", lineno: 10, colno: 4 });

    const { text } = await storedLine();
    expect(text).toContain("Unhandled error: (app.js:10:4)");
    expect(text).toContain("cannot read id");
  });

  it("stores a cross-origin script error, which carries only a message", async () => {
    listeners.error({ error: null, message: "Script error.", filename: "", lineno: 0, colno: 0 });

    expect((await storedLine()).text).toBe("Unhandled error: Script error.");
  });
});
