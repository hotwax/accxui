// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";

const alertStub = vi.hoisted(() => ({ present: vi.fn(async () => {}) }));
const create = vi.hoisted(() => vi.fn(async (_options: any) => alertStub));
const embedded = vi.hoisted(() => ({ value: false }));

vi.mock("@ionic/vue", () => ({ alertController: { create } }));
vi.mock("../core/i18n", () => ({
  translate: (key: string, params?: Record<string, string>) =>
    params ? key.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "") : key,
}));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    isAppEmbedded: () => embedded.value,
    getOMSInstanceName: () => document.cookie.match(/(?:^|; )oms=([^;]*)/)?.[1] ?? "",
  },
}));

import emitter from "../core/emitter";
import { accxuiConfig } from "../core/configRegistry";
import { SESSION_CHANGED } from "../core/sessionChange";
import { useSessionChangeAlert } from "../composables/useSessionChangeAlert";

const setCookie = (name: string, value: string) => { document.cookie = `${name}=${encodeURIComponent(value)}; path=/`; };
const setSession = (oms: string, userId: string, maarg: string) => {
  setCookie("oms", oms);
  setCookie("userId", userId);
  setCookie("maarg", maarg);
};
const route = ref<{ name: string }>({ name: "Funnel" });
/** A router double: the current route plus afterEach hooks, run by navigate() as vue-router would. */
const routeHooks: Array<() => void> = [];
const router = {
  currentRoute: route,
  afterEach: (hook: () => void) => {
    routeHooks.push(hook);
    return () => { routeHooks.splice(routeHooks.indexOf(hook), 1); };
  },
};
const navigate = (name: string) => {
  route.value = { name };
  [...routeHooks].forEach((hook) => hook());
};
const mountWatcher = () => mount(defineComponent({
  setup() {
    useSessionChangeAlert();
    return () => h("div");
  },
}));
const tick = () => vi.advanceTimersByTime(5_000);

describe("useSessionChangeAlert", () => {
  let wrapper: ReturnType<typeof mountWatcher> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    embedded.value = false;
    route.value = { name: "Funnel" };
    setSession("adoc-ni", "u1", "https://adoc-ni-maarg.test");
    accxuiConfig.value = { ...accxuiConfig.value, oms: "adoc-ni", current: { userId: "u1" }, router };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    delete (globalThis as any).cookieStore;
  });

  it("asks to reload once a login elsewhere moves the oms cookie to another instance", async () => {
    const heard = vi.fn();
    emitter.on(SESSION_CHANGED, heard);
    wrapper = mountWatcher();

    setSession("adoc-hn", "u1", "https://adoc-hn-maarg.test");
    tick();
    await vi.waitFor(() => expect(alertStub.present).toHaveBeenCalled());

    expect(heard).toHaveBeenCalledWith({ field: "oms", from: "adoc-ni", to: "adoc-hn" });
    const options = create.mock.calls[0][0];
    expect(options.header).toBe("Signed in to another instance");
    expect(options.message).toContain("adoc-hn");
    expect(options.backdropDismiss).toBe(false);
    expect(options.buttons.map((button: any) => button.text)).toEqual(["Reload"]);
    emitter.off(SESSION_CHANGED, heard);
  });

  it("asks to reload when another user signs in on the same instance", async () => {
    const heard = vi.fn();
    emitter.on(SESSION_CHANGED, heard);
    wrapper = mountWatcher();

    setCookie("userId", "u2");
    tick();
    await vi.waitFor(() => expect(alertStub.present).toHaveBeenCalled());

    expect(heard).toHaveBeenCalledWith({ field: "userId", from: "u1", to: "u2" });
    expect(create.mock.calls[0][0].header).toBe("Session changed");
    emitter.off(SESSION_CHANGED, heard);
  });

  it("asks to reload when the maarg cookie changes under the same instance and user", async () => {
    const heard = vi.fn();
    emitter.on(SESSION_CHANGED, heard);
    wrapper = mountWatcher();

    setCookie("maarg", "https://other-maarg.test");
    tick();
    await vi.waitFor(() => expect(alertStub.present).toHaveBeenCalled());

    expect(heard).toHaveBeenCalledWith({ field: "maarg", from: "https://adoc-ni-maarg.test", to: "https://other-maarg.test" });
    emitter.off(SESSION_CHANGED, heard);
  });

  it("checks at once when the tab comes back into focus", async () => {
    wrapper = mountWatcher();

    setCookie("oms", "adoc-hn");
    window.dispatchEvent(new Event("focus"));

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("checks at once on a cookieStore change of any session cookie", async () => {
    const store = new EventTarget();
    (globalThis as any).cookieStore = store;
    wrapper = mountWatcher();

    setCookie("userId", "u2");
    store.dispatchEvent(Object.assign(new Event("change"), { changed: [{ name: "userId" }], deleted: [] }));

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("stays quiet on the same session, a signed-out tab, a cleared cookie or an embedded app", () => {
    wrapper = mountWatcher();
    tick(); // same session

    setCookie("userId", "");
    setCookie("oms", "adoc-hn");
    tick(); // userId cleared: a logout elsewhere, not a new session

    accxuiConfig.value = { ...accxuiConfig.value, current: {} };
    setCookie("userId", "u2");
    tick(); // this tab has no signed-in user

    embedded.value = true;
    accxuiConfig.value = { ...accxuiConfig.value, current: { userId: "u1" } };
    tick(); // embedded apps keep a session per tab

    expect(create).not.toHaveBeenCalled();
  });

  it("does not alert for this tab's own login on the Login page", () => {
    wrapper = mountWatcher();

    route.value = { name: "Login" };
    setSession("adoc-hn", "u2", "https://adoc-hn-maarg.test");
    tick();
    accxuiConfig.value = { ...accxuiConfig.value, oms: "adoc-hn", current: { userId: "u2" } };
    route.value = { name: "Funnel" };
    tick(); // the new session is this tab's: taken as the new baseline

    setCookie("maarg", "https://adoc-hn-maarg.test");
    tick();

    expect(create).not.toHaveBeenCalled();
  });

  // Codex review: the baseline used to wait for the next 5-second check after the Login page, and a
  // session replaced inside that window was never reported.
  it("takes the new baseline on leaving the Login page, so a change right after is caught", async () => {
    route.value = { name: "Login" };
    wrapper = mountWatcher();

    setSession("adoc-hn", "u2", "https://adoc-hn-maarg.test"); // this tab's own login
    accxuiConfig.value = { ...accxuiConfig.value, oms: "adoc-hn", current: { userId: "u2" } };
    navigate("Funnel");
    setCookie("oms", "adoc-xx"); // replaced elsewhere before the next periodic check
    tick();

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("removes its route hook once unmounted", () => {
    mountWatcher().unmount();

    expect(routeHooks).toHaveLength(0);
  });

  // isAuthenticated is false for such a page and it goes to Login; an alert would come back after every Reload.
  it("does not alert on a page that loads with another session's cookies", () => {
    setSession("adoc-hn", "u2", "https://adoc-hn-maarg.test");
    wrapper = mountWatcher();
    tick();
    tick();

    expect(create).not.toHaveBeenCalled();
  });

  it("shows the alert once, also when the sync service reports the same switch", async () => {
    wrapper = mountWatcher();

    emitter.emit(SESSION_CHANGED, { from: "adoc-ni", to: "adoc-hn" });
    setCookie("oms", "adoc-hn");
    vi.advanceTimersByTime(10_000);
    await vi.waitFor(() => expect(alertStub.present).toHaveBeenCalled());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].header).toBe("Signed in to another instance");
  });

  it("stops watching once unmounted", () => {
    mountWatcher().unmount();

    setCookie("oms", "adoc-hn");
    tick();
    emitter.emit(SESSION_CHANGED, { from: "adoc-ni", to: "adoc-hn" });

    expect(create).not.toHaveBeenCalled();
  });
});
