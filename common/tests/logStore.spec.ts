import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logStore } from "../core/logStore";

describe("logStore", () => {
  // Dexie reads IndexedDB from its dependencies, captured when it loads, not from the global
  const dependencies = Dexie.dependencies as { indexedDB?: unknown; IDBKeyRange?: unknown };
  let realIndexedDB: unknown;
  let realKeyRange: unknown;

  /** An IndexedDB whose every open fails, the way a blocked or private-mode browser behaves. */
  function failingIndexedDB() {
    return {
      open: vi.fn(() => {
        const request: any = {};
        setTimeout(() => {
          request.error = new Error("blocked");
          request.onerror?.({ target: request, preventDefault() {}, stopPropagation() {} });
        });

        return request;
      })
    };
  }

  beforeEach(() => {
    realIndexedDB = dependencies.indexedDB;
    realKeyRange = dependencies.IDBKeyRange;
    // Dexie refuses to open anything without a key range implementation
    dependencies.IDBKeyRange = dependencies.IDBKeyRange ?? {};
  });

  afterEach(() => {
    dependencies.indexedDB = realIndexedDB;
    dependencies.IDBKeyRange = realKeyRange;
    vi.unstubAllGlobals();
    logStore.configure();
  });

  it("cuts an oversized message and says how much was dropped", () => {
    const message = logStore.serialise(["x".repeat(10_050)]);

    expect(message.startsWith("x".repeat(10_000))).toBe(true);
    expect(message.endsWith("… [truncated 50 characters]")).toBe(true);
  });

  it("keeps a message at the limit as it is", () => {
    expect(logStore.serialise(["x".repeat(10_000)])).toBe("x".repeat(10_000));
  });

  /** The cookies useAuth keeps, as document.cookie would hand them back. */
  function stubCookies(cookies: Record<string, string>) {
    vi.stubGlobal("document", {
      cookie: Object.entries(cookies).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ")
    });
  }

  it("records the OMS and username from their cookies", () => {
    stubCookies({ oms: "demo-oms", userId: "hotwax.user" });

    expect(logStore.sessionDetails()).toEqual({ oms: "demo-oms", username: "hotwax.user" });
  });

  it("leaves out a field whose cookie is not set", () => {
    stubCookies({ oms: "demo-oms" });

    expect(logStore.sessionDetails()).toEqual({ oms: "demo-oms", username: undefined });
  });

  it("records neither when there are no cookies to read", () => {
    vi.stubGlobal("document", undefined);

    expect(logStore.sessionDetails()).toEqual({});
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
    dependencies.indexedDB = undefined;
    logStore.configure({ dbName: "missing-logs" });

    expect(() => logStore.logStoreHook.run({ level: "error", argumentArray: ["boom"] } as any)).not.toThrow();
    await expect(logStore.readLogs()).resolves.toEqual([]);
    await expect(logStore.readAllLogs()).resolves.toEqual([]);
    await expect(logStore.clearLogs()).resolves.toBeUndefined();
  });

  it("opens the configured database", async () => {
    const indexedDB = failingIndexedDB();
    dependencies.indexedDB = indexedDB;

    logStore.configure({ dbName: "bopis-logs", maxEntries: 100 });
    await logStore.readLogs();

    expect(indexedDB.open).toHaveBeenCalled();
    expect((indexedDB.open.mock.calls[0] as unknown[])[0]).toBe("bopis-logs");
    expect(logStore.maxEntries).toBe(100);
  });

  it("retries the open after a failure instead of disabling logging", async () => {
    const indexedDB = failingIndexedDB();
    dependencies.indexedDB = indexedDB;

    logStore.configure({ dbName: "retry-logs" });
    await logStore.readLogs();
    const opensAfterFirstRead = indexedDB.open.mock.calls.length;
    await logStore.readLogs();

    expect(opensAfterFirstRead).toBeGreaterThan(0);
    expect(indexedDB.open.mock.calls.length).toBeGreaterThan(opensAfterFirstRead);
  });
});
