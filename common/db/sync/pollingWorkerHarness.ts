/**
 * Worker-side sync harness.
 *
 * OWNS the parts an app dev must not get wrong:
 *   - the poll cadence, running on the worker's own event loop so main-thread jank can never
 *     delay or skip a sync;
 *   - the held bearer token, kept fresh by push over BroadcastChannel — never snapshotted;
 *   - teardown (one timer, cleared on stop()).
 *
 * Domains supply only their own `sync` / `refetchOne` work via the registry. One base tick runs
 * whichever activated domains are due, so N domains share one thread and one token subscription.
 *
 * Ported from the Company app's fork (`apps/company/src/workers/pollingWorkerHarness.ts`), which
 * remains the more evolved version until the rest of it lands. NOT YET PORTED — still lives only
 * in that fork until a later task promotes it: the exclusive/shared per-domain operation queues
 * that order a full snapshot against a targeted refetch, the ordered `refetchOne`, and 401 →
 * `auth-error` classification. This harness's `refetchOne` is the older, unordered version.
 */

import { expose } from "comlink";
import { type BaseDB, ensureDbReady, hasSyncedThisLogin } from "../baseDb";
import { DB_SYNC_CHANNEL } from "../syncChannel";
import type { SyncContext, SyncDomain } from "../types";
import { subscribeToken } from "./pollingTokenChannel";
import {
  type ActiveDomain,
  activationKey,
  dueDomains,
  effectiveInterval,
  getAllSyncDomains,
  getSyncDomain,
  registeredDomainNames,
} from "./syncRegistry";

export interface HarnessStartPayload {
  maargUrl: string;
  token: string;
  /** Required — the worker has no cookies, so the main thread must name the OMS to sync into. */
  omsInstance: string;
  /** How often the harness re-evaluates which domains are due. */
  baseTickMs?: number;
  /** Activated domains. Omit to activate every registered class A/B domain (class C never ticks). */
  domains?: ActiveDomain[];
}

export interface CatalogItem {
  name: string;
  label: string;
  syncClass: "A" | "B" | "C";
}

export interface SyncHarness {
  start: (payload: HarnessStartPayload) => Promise<void>;
  /** Force every activated domain to run now (manual refresh, routed from the main thread). */
  syncNow: () => Promise<void>;
  /** Force one domain to re-sync now, bypassing the once-per-login guard. */
  syncDomainNow: (domain: string) => Promise<number>;
  /** Refetch one record after a mutation: `{ domain, pk }`. */
  refetchOne: (request: { domain: string; pk: Record<string, unknown> }) => Promise<number>;
  /** Replace the activated domain set without respawning the worker. */
  setDomains: (domains: ActiveDomain[]) => void;
  stop: () => void;
  /** Diagnostics: which domains this worker build knows about. */
  domains: () => string[];
  /** Status-card data: every registered domain, with its declared label and sync class. */
  catalog: () => CatalogItem[];
}

const DEFAULT_BASE_TICK_MS = 5_000;

export function createSyncHarness(getDb: (omsInstance: string) => BaseDB): SyncHarness {
  let ctx: SyncContext = { maargUrl: "", token: "", omsInstance: "", now: Date.now() };
  let active: ActiveDomain[] = [];
  let baseTickMs = DEFAULT_BASE_TICK_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  const lastRunAt: Record<string, number> = {};

  const syncChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(DB_SYNC_CHANNEL) : null;

  // Token stays fresh via push from the main thread — held, never frozen at start(). Called here
  // (not at module scope) so each harness instance owns its own subscription.
  subscribeToken((next) => { ctx = { ...ctx, token: next }; });

  const post = (msg: Record<string, unknown>) => {
    if (typeof self !== "undefined") self.postMessage(msg);
  };

  async function executeDomain(
    entry: ActiveDomain,
    force = false,
    propagateError = false,
  ): Promise<number> {
    const domain: SyncDomain | undefined = getSyncDomain(entry.name);
    if (!domain) {
      const error = new Error(`unregistered domain "${entry.name}"`);
      post({ type: "sync-error", domain: entry.name, message: error.message });
      if (propagateError) throw error;

      return 0;
    }
    post({ type: "sync-start", domain: entry.name });
    // Per-ACTIVATION clock, not per-domain: one page can activate the same domain twice with different
    // args and cadences, and a shared clock lets the faster one starve the slower. See `activationKey`.
    const clockKey = activationKey(entry);
    try {
      const written = await domain.sync(ctx, entry.args, { force });
      const interval = effectiveInterval(entry, domain);
      // A class-B sync can deliberately refuse a destructive snapshot and return 0 without throwing.
      // Its durable login marker is the completion signal: until that marker exists, leave the
      // activation unclocked so the next base tick retries it. Cadenced domains and forced runs use
      // the in-memory clock as before.
      const completed = force || interval !== undefined || await hasSyncedThisLogin(getDb(ctx.omsInstance), entry.name);
      const at = Date.now();
      if (completed) lastRunAt[clockKey] = at;
      post({ type: "sync-end", domain: entry.name, written, at, retryPending: !completed });
      syncChannel?.postMessage({ type: "domain-synced", domain: entry.name });

      return written as number;
    } catch (err) {
      // Cadenced domains record failed attempts so one bad endpoint cannot spin faster than its
      // declared interval. A no-cadence/class-B domain must remain due until one pass succeeds.
      if (effectiveInterval(entry, domain) !== undefined) lastRunAt[clockKey] = Date.now();
      const message = (err as any)?.message ?? (typeof err === "string" ? err : JSON.stringify(err ?? ""));
      post({ type: "sync-error", domain: entry.name, message });
      if (propagateError) throw err;

      return 0;
    }
  }

  // Thin seam today; Task 2 wraps this with the exclusive/shared per-domain operation queues.
  function runDomain(
    entry: ActiveDomain,
    force = false,
    propagateError = false,
  ): Promise<number> {
    return executeDomain(entry, force, propagateError);
  }

  async function tick(force = false, propagateErrors = false): Promise<void> {
    if (running || !ctx.token) return; // don't overlap; wait until start() supplies a token
    running = true;
    try {
      const now = Date.now();
      const due = force
        ? active
        : dueDomains(active, lastRunAt, now, (entry) => effectiveInterval(entry, getSyncDomain(entry.name)));
      // Sequential: these share one thread and one backend; parallel bursts buy nothing here.
      const failures: Array<{ domain: string; error: unknown }> = [];
      for (const entry of due) {
        try {
          await runDomain(entry, force, propagateErrors);
        } catch (error) {
          failures.push({ domain: entry.name, error });
        }
      }
      syncChannel?.postMessage({ type: "sync-complete" });
      if (failures.length) {
        throw new Error(
          `Failed to sync domains: ${failures.map(({ domain }) => domain).join(", ")}.`,
          { cause: failures[0].error },
        );
      }
    } finally {
      running = false;
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function start(payload: HarnessStartPayload): Promise<void> {
    stop(); // restart cleanly if called again
    ctx = { maargUrl: payload.maargUrl, token: payload.token, omsInstance: payload.omsInstance, now: Date.now() };
    // "Activate everything" means "everything of class A or B" — a class-C domain exists only to
    // answer a targeted refetch and must never be polled.
    active = payload.domains ?? getAllSyncDomains()
      .filter((d) => d.syncClass !== "C")
      .map((d) => ({ name: d.name }));
    baseTickMs = payload.baseTickMs ?? DEFAULT_BASE_TICK_MS;
    // Recreate the cache if its stored schema is stale — otherwise every write below no-ops.
    try {
      await ensureDbReady(getDb(payload.omsInstance));
    } catch (err) {
      const error = new Error(`cache open failed: ${(err as any)?.message ?? err}`, { cause: err });
      post({ type: "sync-error", domain: "__start", message: error.message });
      throw error;
    }
    for (const key of Object.keys(lastRunAt)) delete lastRunAt[key];
    await tick(); // immediate first pass (seeds the cache for every activated domain)
    timer = setInterval(() => void tick(), baseTickMs);
  }

  function setDomains(domains: ActiveDomain[]): void {
    active = domains ?? [];
    /**
     * Drop run history for activations no longer active so re-activation bootstraps again.
     *
     * Keyed per activation, so swapping cadence (order sync escalating to 10s) keeps each
     * activation's own clock instead of resetting or sharing one.
     */
    const keys = new Set(active.map(activationKey));
    for (const key of Object.keys(lastRunAt)) {
      if (!keys.has(key)) delete lastRunAt[key];
    }
  }

  function syncDomainNow(domain: string): Promise<number> {
    const entry = active.find((candidate) => candidate.name === domain) ?? { name: domain };

    // Forced/manual work must propagate failure. A timestamp records an attempt for throttling; it
    // is never evidence that the snapshot succeeded.
    return runDomain(entry, true, true);
  }

  async function refetchOne({ domain: domainName, pk }: { domain: string; pk: Record<string, unknown> }): Promise<number> {
    const domain = getSyncDomain(domainName);
    if (!domain?.refetchOne) return 0;
    ctx.now = Date.now();

    return (await domain.refetchOne(ctx, pk)) ?? 0;
  }

  function catalog(): CatalogItem[] {
    return getAllSyncDomains().map((d) => ({
      name: d.name,
      label: d.label ?? d.name,
      syncClass: d.syncClass ?? "B",
    }));
  }

  return {
    start,
    syncNow: () => tick(true, true),
    syncDomainNow,
    refetchOne,
    setDomains,
    stop,
    domains: () => registeredDomainNames(),
    catalog,
  };
}

export function exposeWorkerHarness(getDb: (omsInstance: string) => BaseDB): void {
  expose(createSyncHarness(getDb));
}
