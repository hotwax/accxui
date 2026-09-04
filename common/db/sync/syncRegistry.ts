/**
 * Pure domain scheduler and sync domain registration.
 */

import type { SyncContext, SyncDomain } from "../types";

export interface SyncRegistrationEntry {
  domain: SyncDomain;
  lastRanAt?: number;
  running?: boolean;
}

const registry = new Map<string, SyncRegistrationEntry>();

export function registerSyncDomain(domain: SyncDomain): void {
  registry.set(domain.name, { domain });
}

export function unregisterSyncDomain(name: string): void {
  registry.delete(name);
}

export function getSyncDomain(name: string): SyncDomain | undefined {
  return registry.get(name)?.domain;
}

export function getAllSyncDomains(): SyncDomain[] {
  return Array.from(registry.values()).map((e) => e.domain);
}

export function clearSyncRegistry(): void {
  registry.clear();
}

/**
 * Pure scheduling rule: which registered domains are due to run at `now`?
 */
export function dueDomains(
  entries: SyncRegistrationEntry[],
  now: number,
): SyncDomain[] {
  const due: SyncDomain[] = [];
  for (const entry of entries) {
    if (entry.running) continue;
    if (!entry.lastRanAt) {
      due.push(entry.domain);
      continue;
    }
    const cadence = entry.domain.cadenceMs ?? 0;
    if (cadence > 0 && now - entry.lastRanAt >= cadence) {
      due.push(entry.domain);
    }
  }
  return due;
}
