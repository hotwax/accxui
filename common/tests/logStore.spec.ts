import { afterEach, describe, expect, it, vi } from "vitest";
import { logStore } from "../core/logStore";

describe("logStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    logStore.configure();
  });

  it("reports itself enabled once the logger configures it", () => {
    logStore.configure({ dbName: "enabled-logs" });

    expect(logStore.isEnabled).toBe(true);
  });

  it("serialises every argument into one line", () => {
    expect(logStore.serialise(["Failed", { status: 400 }, 3])).toBe("Failed {\"status\":400} 3");
  });

  it("falls back to String() for a value JSON cannot hold", () => {
    const circular: any = {};
    circular.self = circular;

    expect(logStore.serialise(["x", circular])).toBe("x [object Object]");
  });

  it("never throws into the caller when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);

    expect(() => logStore.logStoreHook.run({ level: "error", argumentArray: ["boom"] } as any)).not.toThrow();
    await expect(logStore.readLogs()).resolves.toEqual([]);
    await expect(logStore.clearLogs()).resolves.toBeUndefined();
  });

  it("opens the configured database", async () => {
    const open = vi.fn(() => {
      const request: any = {};
      queueMicrotask(() => { request.error = new Error("blocked"); request.onerror?.(); });

      return request;
    });
    vi.stubGlobal("indexedDB", { open });

    logStore.configure({ dbName: "bopis-logs", maxEntries: 100 });
    await logStore.readLogs();

    expect(open).toHaveBeenCalledWith("bopis-logs", 1);
    expect(logStore.maxEntries).toBe(100);
  });

  it("retries the open after a failure instead of disabling logging", async () => {
    const open = vi.fn(() => {
      const request: any = {};
      queueMicrotask(() => { request.error = new Error("blocked"); request.onerror?.(); });

      return request;
    });
    vi.stubGlobal("indexedDB", { open });

    logStore.configure({ dbName: "retry-logs" });
    await logStore.readLogs();
    await logStore.readLogs();

    expect(open).toHaveBeenCalledTimes(2);
  });
});
