// @vitest-environment jsdom
import { createApp, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuildUpdate } from "../composables/useBuildUpdate";
import { buildUpdatePlugin } from "../vite/buildUpdatePlugin";

let app: ReturnType<typeof createApp>;
let state: ReturnType<typeof useBuildUpdate>;
const fetchMock = vi.fn();
const reply = (buildId = "next", base = "/") => ({ ok: true,
  headers: new Headers({ "content-type": "application/json" }),
  json: async () => ({ schemaVersion: 1, buildId, base }) });
async function mount(base = "/", enabled = true) {
  const el = document.createElement("div"); document.body.appendChild(el);
  app = createApp({ setup() { state = useBuildUpdate({ currentBuildId: "running", base, enabled }); return () => h("div"); } });
  app.mount(el);
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset().mockResolvedValue(reply());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("opt-in build updates", () => {
  it("detects a new build without reloading or persisting anything", async () => {
    await mount(); expect(state.updateAvailable.value).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(new URL("/app-build.json", location.origin),
      expect.objectContaining({ cache: "no-store", credentials: "omit", redirect: "error" }));
  });
  it("does not opt in development or re-notify the running build", async () => {
    await mount("/", false); expect(fetchMock).not.toHaveBeenCalled(); app.unmount();
    fetchMock.mockResolvedValue(reply("running")); await mount(); expect(state.updateAvailable.value).toBe(false);
  });
  it("compares only the tenant-pinned base and ignores another base", async () => {
    await mount("/v2.5.0/"); expect(state.updateAvailable.value).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toBe(new URL("/v2.5.0/app-build.json", location.origin).href);
    fetchMock.mockResolvedValue(reply("next", "/v2.5.0/")); await state.checkForUpdate();
    expect(state.updateAvailable.value).toBe(true);
  });
  it("ignores missing, malformed and offline responses and can recover", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline")); await mount();
    expect(state.updateAvailable.value).toBe(false);
    fetchMock.mockResolvedValue({ ...reply(), ok: false }); await state.checkForUpdate();
    fetchMock.mockResolvedValue({ ...reply(), headers: new Headers({ "content-type": "text/html" }) }); await state.checkForUpdate();
    fetchMock.mockResolvedValue(reply("")); await state.checkForUpdate();
    expect(state.updateAvailable.value).toBe(false);
    fetchMock.mockResolvedValue(reply()); await state.checkForUpdate(); expect(state.updateAvailable.value).toBe(true);
    fetchMock.mockResolvedValue(reply("running")); await state.checkForUpdate(); expect(state.updateAvailable.value).toBe(false);
  });
  it("checks a visible tab each minute and throttles return events", async () => {
    await mount(); window.dispatchEvent(new Event("focus")); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000); window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0); expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(60000); expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("deduplicates requests and aborts a request on unmount", async () => {
    let resolve: (value: any) => void = () => {};
    fetchMock.mockImplementation(() => new Promise(r => { resolve = r; }));
    await mount(); void state.checkForUpdate(); expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1].signal;
    app.unmount(); expect(signal.aborted).toBe(true);
    resolve(reply()); await vi.advanceTimersByTimeAsync(0); expect(state.updateAvailable.value).toBe(false);
    await vi.advanceTimersByTimeAsync(120000); window.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("times out a stalled request", async () => {
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted")))));
    await mount(); await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    fetchMock.mockResolvedValue(reply()); await state.checkForUpdate(); expect(state.updateAvailable.value).toBe(true);
  });
  it("gives same-revision rebuilds distinct bundled and emitted identities", () => {
    const first: any = buildUpdatePlugin(); const second: any = buildUpdatePlugin();
    const firstId = JSON.parse(first.config().define["import.meta.env.VITE_APP_BUILD_ID"]);
    expect(firstId).not.toBe(JSON.parse(second.config().define["import.meta.env.VITE_APP_BUILD_ID"]));
    first.configResolved({ base: "/v2.5.0/" }); const emitFile = vi.fn();
    first.generateBundle.call({ emitFile });
    expect(JSON.parse(emitFile.mock.calls[0][0].source)).toEqual({ schemaVersion: 1, buildId: firstId, base: "/v2.5.0/" });
  });
});
