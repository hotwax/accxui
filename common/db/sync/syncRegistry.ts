/**
 * Sync domain registry and the pure scheduling rule.
 *
 * One worker serves every domain rather than one worker per domain. Each domain declares its own
 * cadence; a single base tick runs whichever activations are due.
 */

import type { SyncDomain } from "../types";

const registry = new Map<string, SyncDomain>();

export function registerSyncDomain(domain: SyncDomain): SyncDomain {
  registry.set(domain.name, domain);
  return domain;
}

export function unregisterSyncDomain(name: string): void {
  registry.delete(name);
}

export function getSyncDomain(name: string): SyncDomain | undefined {
  return registry.get(name);
}

export function getAllSyncDomains(): SyncDomain[] {
  return Array.from(registry.values());
}

export function registeredDomainNames(): string[] {
  return Array.from(registry.keys());
}

export function clearSyncRegistry(): void {
  registry.clear();
}

/** A domain the caller has switched on, with its per-activation arguments. */
export interface ActiveDomain {
  name: string;
  /** Overrides the domain's default cadence when present. */
  intervalMs?: number;
  /** Domain-specific arguments (filters, configId, watched job names, …). */
  args?: any;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * The key a domain's last-run clock is stored under.
 *
 * NOT the domain name. One page can activate the SAME domain several times with different args and
 * different cadences. Keyed on name alone those share one clock: the fastest activation restamps it
 * every tick, so a slower one's interval never elapses and it runs exactly once per page entry and
 * then never again. Silent, because the first tick does run it.
 *
 * Key order is stabilised so an equivalent activation built in a different order maps to one clock.
 */
export function activationKey(active: ActiveDomain): string {
  const args = active.args;
  if (args === undefined || args === null) return active.name;
  return `${active.name}:${stableStringify(args)}`;
}

/** The effective cadence for an activation: explicit override, else the domain default. */
export function effectiveInterval(
  active: ActiveDomain,
  domain: SyncDomain | undefined,
): number | undefined {
  return active.intervalMs ?? domain?.intervalMs;
}

/**
 * Which activated domains are due to run now.
 *
 * - No cadence (class B): due only if it has never run — activation bootstrap.
 * - A cadence: due when the interval has elapsed since that ACTIVATION last ran.
 *
 * Pure, so the scheduling rule is testable without a worker or a timer.
 */
export function dueDomains(
  active: readonly ActiveDomain[],
  lastRunAt: Readonly<Record<string, number>>,
  now: number,
  intervalFor: (active: ActiveDomain) => number | undefined,
): ActiveDomain[] {
  return active.filter((entry) => {
    const last = lastRunAt[activationKey(entry)];
    const interval = intervalFor(entry);
    if (interval === undefined) return last === undefined;
    if (last === undefined) return true;
    return now - last >= interval;
  });
}
