/**
 * Framework-internal: every module's domains merged into one registry, keyed by domain name and by
 * table. The framework looks domains up here whatever modules an app took (`defineAppDb`'s status
 * catalog, `useSeedData`, `useDbStatus`). Apps never import this; they register the domains of the
 * module they use (`./commonDomains`, and any further module), filtered to the tables they picked. Lint
 * rejects an import of this file from `src/`.
 */

import type { SyncDomain } from "../types";
import { commonDomains } from "./commonDomains";

function mergeDomains(...modules: Array<Record<string, SyncDomain>>): Record<string, SyncDomain> {
  const merged: Record<string, SyncDomain> = {};
  for (const module of modules) {
    for (const [key, domain] of Object.entries(module)) {
      if (key in merged) {
        throw new Error(`[db] domainRegistry: domain "${key}" is declared by more than one module.`);
      }
      merged[key] = domain;
    }
  }
  return merged;
}

export const domainRegistry: Record<string, SyncDomain> = mergeDomains(commonDomains);

/** Each domain under its primary `table`: the status card shows one row per domain. */
export const domainsByTable: Record<string, SyncDomain> = Object.fromEntries(
  Object.values(domainRegistry).map((domain) => [domain.table, domain])
);

/** Every table a framework domain fills. */
export const REGISTRY_TABLE_NAMES = Object.values(domainRegistry)
  .map((domain) => domain.table)
  .filter((table): table is string => Boolean(table));
export const REGISTRY_DOMAIN_NAMES = Object.keys(domainRegistry);
