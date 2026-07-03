import { reactive, computed } from "vue";
import {
  getFastTravelApps,
  getFastTravelApp,
  buildAppUrl,
  FastTravelApp
} from "../utils/fastTravelRegistry";

/**
 * Fast Travel — the cross-app router for the HotWax suite.
 *
 * Two entry points share one registry:
 *  - the command palette (Cmd/Ctrl+K) for keyboard-driven app switching, and
 *  - programmatic deep-links via openApp(appId, { path, query }).
 *
 * State is module-level so the single mounted <FastTravel> palette reacts to open()/toggle() calls
 * made from anywhere in the app.
 */

interface NavOptions {
  path?: string;
  query?: Record<string, string | number | undefined | null>;
  newTab?: boolean;
}

const state = reactive({
  isOpen: false,
  query: "",
  selectedIndex: 0,
  currentAppId: "" // the app currently running; never a navigation target
});

export function useFastTravel() {
  const apps = getFastTravelApps();

  const filteredApps = computed<FastTravelApp[]>(() => {
    const q = state.query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => `${a.name} ${a.description} ${a.id}`.toLowerCase().includes(q));
  });

  function setCurrentApp(appId: string) {
    state.currentAppId = appId || "";
  }

  function isNavigable(app?: FastTravelApp | null): boolean {
    return !!app && !!app.baseUrl && app.id !== state.currentAppId;
  }

  function open() {
    state.query = "";
    // Land the highlight on the first navigable app rather than the current/disabled one.
    state.selectedIndex = Math.max(apps.findIndex((a) => isNavigable(a)), 0);
    state.isOpen = true;
  }

  function close() {
    state.isOpen = false;
  }

  function toggle() {
    state.isOpen ? close() : open();
  }

  function setQuery(value: string) {
    state.query = value || "";
    state.selectedIndex = 0;
  }

  function moveSelection(delta: number) {
    const count = filteredApps.value.length;
    if (!count) return;
    state.selectedIndex = (state.selectedIndex + delta + count) % count;
  }

  function navigate(app: FastTravelApp, opts: NavOptions = {}): boolean {
    const url = buildAppUrl(app.id, opts.path, opts.query);
    if (!url) return false;
    if (opts.newTab) window.open(url, "_blank", "noopener");
    else window.location.assign(url);
    return true;
  }

  // Programmatic deep-link from anywhere (e.g. an Inventory history "Open in Order Manager" button).
  function openApp(appId: string, opts: NavOptions = {}): boolean {
    const app = getFastTravelApp(appId);
    if (!app) return false;
    return navigate(app, opts);
  }

  // Activate the currently highlighted palette row.
  function selectCurrent(opts: NavOptions = {}) {
    const app = filteredApps.value[state.selectedIndex];
    if (!isNavigable(app)) return;
    if (navigate(app, opts)) close();
  }

  return {
    state,
    apps,
    filteredApps,
    setCurrentApp,
    isNavigable,
    open,
    close,
    toggle,
    setQuery,
    moveSelection,
    selectCurrent,
    openApp,
    buildAppUrl
  };
}
