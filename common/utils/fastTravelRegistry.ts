import {
  appsOutline,
  shuffleOutline,
  bagCheckOutline,
  fileTrayFullOutline,
  swapHorizontalOutline,
  clipboardOutline
} from "ionicons/icons";

/**
 * Fast Travel app registry.
 *
 * The single source of truth for the HotWax app suite — used both by the Fast Travel command
 * palette (Cmd/Ctrl+K launcher) and by any feature that deep-links into another app (e.g. the
 * Inventory history rows linking a movement to its owning order / transfer / cycle count).
 *
 * App metadata (name, icon, colour) is static; base URLs come from env so each deployment points
 * at its own instances. An app with no configured URL stays in the registry but is non-navigable
 * (the palette dims it; buildAppUrl returns null) so the feature degrades gracefully.
 */

export interface FastTravelApp {
  id: string;
  name: string;          // English label; translated at render time
  description: string;
  icon: string;
  color: string;         // Ionic colour name
  baseUrl: string;       // "" when unconfigured for this deployment
}

function cleanUrl(value: any): string {
  return value ? String(value).trim().replace(/\/+$/, "") : "";
}

// Static env reads (Vite inlines import.meta.env.VITE_* only for literal keys, never dynamic).
const URLS = {
  launchpad: cleanUrl(import.meta.env.VITE_LAUNCHPAD_URL),
  orderManager: cleanUrl(import.meta.env.VITE_ORDER_MANAGER_URL),
  preorder: cleanUrl(import.meta.env.VITE_PREORDER_URL),
  transfers: cleanUrl(import.meta.env.VITE_TRANSFERS_URL),
  cycleCount: cleanUrl(import.meta.env.VITE_CYCLE_COUNT_URL),
  orderRouting: cleanUrl(import.meta.env.VITE_ORDER_ROUTING_URL)
};

const APPS: FastTravelApp[] = [
  { id: "launchpad",    name: "Launchpad",     description: "All apps & switch instance", icon: appsOutline,           color: "dark",      baseUrl: URLS.launchpad },
  { id: "order-manager", name: "Order Manager", description: "Orders, returns & fulfillment", icon: bagCheckOutline,      color: "primary",   baseUrl: URLS.orderManager },
  { id: "preorder",     name: "PreOrder",      description: "Purchase orders & inbound",  icon: fileTrayFullOutline,   color: "secondary", baseUrl: URLS.preorder },
  { id: "transfers",    name: "Transfers",     description: "Transfer orders between facilities", icon: swapHorizontalOutline, color: "tertiary", baseUrl: URLS.transfers },
  { id: "cycle-count",  name: "Cycle Count",   description: "Counts & inventory variance", icon: clipboardOutline,      color: "success",   baseUrl: URLS.cycleCount },
  { id: "order-routing", name: "Order Routing", description: "Brokering & sourcing rules",  icon: shuffleOutline,        color: "warning",   baseUrl: URLS.orderRouting }
];

export function getFastTravelApps(): FastTravelApp[] {
  return APPS;
}

export function getFastTravelApp(appId: string): FastTravelApp | undefined {
  return APPS.find((app) => app.id === appId);
}

/**
 * Build a fully-qualified URL into a registered app, or null when that app has no configured base
 * URL for this deployment. `path` is the in-app route; `query` becomes a query string.
 */
export function buildAppUrl(
  appId: string,
  path = "",
  query?: Record<string, string | number | undefined | null>
): string | null {
  const app = getFastTravelApp(appId);
  if (!app || !app.baseUrl) return null;

  let url = app.baseUrl;
  if (path) url += path.startsWith("/") ? path : `/${path}`;

  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  return url;
}
