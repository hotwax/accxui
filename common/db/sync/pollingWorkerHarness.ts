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
 */

import { expose } from "comlink";
import { type BaseDB, ensureDbReady, hasSyncedThisLogin } from "../storage/baseDb";
import { DB_SYNC_CHANNEL, subscribeToken } from "./channels";
import { cacheScopeKey } from "./reconciliation";
import type { SyncContext, SyncDomain } from "../types";
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
  /** Activated domains. Omit to activate registered class B domains (class A domains are view-scoped, class C are on-demand). */
  domains?: ActiveDomain[];
}

export interface CatalogItem {
  name: string;
  table?: string;
  label: string;
  syncClass: "A" | "B" | "C";
}

export interface SyncHarness {
  start: (payload: HarnessStartPayload) => Promise<void>;
  /** Force the screen-activated domains to run now (a page's manual refresh). */
  syncNow: () => Promise<void>;
  /** Force EVERY active domain — the start set and the screen's — to run now ("Refresh all"). */
  syncAll: () => Promise<void>;
  /** Force one domain to re-sync now, bypassing the once-per-login guard. */
  syncDomainNow: (domain: string) => Promise<number>;
  /** Refetch one record after a mutation. */
  refetchOne: (request: { domain: string; pk: Record<string, unknown> }) => Promise<number>;
  /**
   * Replace the SCREEN-activated domain set without respawning the worker. The start set (class B by
   * default) stays active alongside it. Safe to call before `start()`; the set is held until then.
   */
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
  /** The set `start()` activated — class B by default. Never replaced by a screen. */
  let baseDomains: ActiveDomain[] = [];
  /** The set the open screen activated through `setDomains`. */
  let viewDomains: ActiveDomain[] = [];
  let baseTickMs = DEFAULT_BASE_TICK_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let activeTick: Promise<void> | null = null;
  let activeTickForced = false;
  let activeTickScope: "view" | "all" = "view";
  /** `viewGeneration` at the moment the running tick chose its domains. */
  let activeTickGeneration = 0;
  let queuedForcedTick: Promise<void> | null = null;
  /** Read when the queued pass starts, so a later "all" request can widen a queued "view" pass. */
  let queuedForcedScope: "view" | "all" = "view";
  /** Bumped by `setDomains`, so a forced pass knows whether a running one still covers its set. */
  let viewGeneration = 0;

  /** Every active domain, base first, one entry per activation. */
  function activeDomains(): ActiveDomain[] {
    const seen = new Set<string>();
    return [...baseDomains, ...viewDomains].filter((entry) => {
      const key = activationKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  /** Whether an activation, by key, is still active: a screen may leave or re-scope mid-run. */
  function isActive(key: string): boolean {
    return activeDomains().some((entry) => activationKey(entry) === key);
  }
  const lastRunAt: Record<string, number> = {};
  /**
   * Screen activations `setDomains` started at once, by activation key, while they run.
   *
   * A pass that comes due meanwhile skips them, and a forced pass waits on them instead of fetching
   * the same rows again: a screen typically asks for a refresh right after activating.
   */
  const activationRuns = new Map<string, Promise<number>>();
  const refetchQueues = new Map<string, Promise<void>>();
  const domainExclusiveQueues = new Map<string, Promise<void>>();
  const domainSharedOperations = new Map<string, Set<Promise<void>>>();

  const syncChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(DB_SYNC_CHANNEL) : null;

  // Token stays fresh via push from the main thread — held, never frozen at start(). Called here
  // (not at module scope) so each harness instance owns its own subscription.
  subscribeToken((next) => { ctx = { ...ctx, token: next }; });

  const post = (msg: Record<string, unknown>) => {
    if (typeof self !== "undefined") self.postMessage(msg);
  };

  function classifyError(err: any): { isAuth: boolean; message: string } {
    const message = err?.message ?? (typeof err === "string" ? err : JSON.stringify(err ?? ""));
    const status = err?.status ?? err?.statusCode ?? err?.response?.status;
    const isAuth = status === 401 || /unauthor|not authorized|invalid.*token|\b401\b/i.test(message);

    return { isAuth, message };
  }

  function runExclusiveDomainOperation<T>(
    domain: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previousExclusive = domainExclusiveQueues.get(domain) ?? Promise.resolve();
    const previousShared = [...(domainSharedOperations.get(domain) ?? [])];
    const operation = Promise.all([previousExclusive, ...previousShared]).then(() => action());
    const tail = operation.then(() => undefined, () => undefined);
    domainExclusiveQueues.set(domain, tail);

    return operation.finally(() => {
      if (domainExclusiveQueues.get(domain) === tail) domainExclusiveQueues.delete(domain);
    });
  }

  function runSharedDomainOperation<T>(
    domain: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previousExclusive = domainExclusiveQueues.get(domain) ?? Promise.resolve();
    const operation = previousExclusive.then(() => action());
    const tail = operation.then(() => undefined, () => undefined);
    const activeOps = domainSharedOperations.get(domain) ?? new Set<Promise<void>>();
    activeOps.add(tail);
    domainSharedOperations.set(domain, activeOps);

    return operation.finally(() => {
      activeOps.delete(tail);
      if (!activeOps.size && domainSharedOperations.get(domain) === activeOps) {
        domainSharedOperations.delete(domain);
      }
    });
  }

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
    const clockKey = activationKey(entry);
    try {
      const written = await domain.sync(ctx, entry.args, { force });
      const interval = effectiveInterval(entry, domain);
      const completed = force || interval !== undefined || await hasSyncedThisLogin(getDb(ctx.omsInstance), entry.name);
      const at = Date.now();
      if (completed) lastRunAt[clockKey] = at;
      // `current` is false when the screen that activated this pass has since left or re-scoped,
      // so the main thread does not count it as a pass for whatever holds the domain now.
      post({
        type: "sync-end", domain: entry.name, written, at, retryPending: !completed,
        key: clockKey, current: isActive(clockKey),
      });
      syncChannel?.postMessage({ type: "domain-synced", domain: entry.name });

      return written as number;
    } catch (err) {
      if (effectiveInterval(entry, domain) !== undefined) lastRunAt[clockKey] = Date.now();
      const { isAuth, message } = classifyError(err);
      post({ type: isAuth ? "auth-error" : "sync-error", domain: entry.name, message });
      if (propagateError) throw err;

      return 0;
    }
  }

  function runDomain(
    entry: ActiveDomain,
    force = false,
    propagateError = false,
  ): Promise<number> {
    return runExclusiveDomainOperation(
      entry.name,
      () => executeDomain(entry, force, propagateError),
    );
  }

  async function executeTick(force: boolean, scope: "view" | "all", propagateErrors: boolean): Promise<void> {
    const now = Date.now();
    activeTickGeneration = viewGeneration;
    const due = force
      ? (scope === "all" ? activeDomains() : viewDomains)
      : dueDomains(activeDomains(), lastRunAt, now, (entry) => effectiveInterval(entry, getSyncDomain(entry.name)))
        .filter((entry) => !activationRuns.has(activationKey(entry)));
    if (!due.length) return;
    post({ type: "sync-cycle-start", domains: due.map(({ name }) => name), force });
    try {
      // Sequential: these share one thread and one backend; parallel bursts buy nothing here.
      const failures: Array<{ domain: string; error: unknown }> = [];
      for (const entry of due) {
        try {
          const inFlight = activationRuns.get(activationKey(entry));
          if (inFlight) {
            await inFlight.catch((error) => { if (propagateErrors) throw error; });
            continue;
          }
          await runDomain(entry, force, propagateErrors);
        } catch (error) {
          failures.push({ domain: entry.name, error });
        }
      }
      if (failures.length) {
        throw new Error(
          `Failed to sync domains: ${failures.map(({ domain }) => domain).join(", ")}.`,
          { cause: failures[0].error },
        );
      }
    } finally {
      syncChannel?.postMessage({ type: "sync-complete" });
      post({ type: "sync-cycle-end", at: Date.now(), force });
    }
  }

  function beginTick(force: boolean, scope: "view" | "all", propagateErrors: boolean): Promise<void> {
    activeTickForced = force;
    activeTickScope = scope;
    activeTickGeneration = viewGeneration;
    // Deferred one microtask so `tracked` is assigned before its cleanup can run, even for a tick
    // with nothing due that completes at once.
    const operation = Promise.resolve().then(() => executeTick(force, scope, propagateErrors));
    const tracked = operation.finally(() => {
      if (activeTick === tracked) {
        activeTick = null;
        activeTickForced = false;
      }
    });
    activeTick = tracked;

    return tracked;
  }

  /**
   * A scheduled tick shares whatever tick is running. A FORCED pass never does unless the running
   * one is forced too: it queues behind it, so a manual refresh issued mid-tick still gets a pass
   * over the domains it asked for instead of resolving against a pass that skipped them. It shares
   * a running forced pass only when that pass covers its scope and chose its domains after the last
   * `setDomains`. One queued pass serves every later forced request; an "all" request widens it.
   */
  function tick(force = false, propagateErrors = false, scope: "view" | "all" = "view"): Promise<void> {
    if (!ctx.token) return Promise.resolve(); // wait until start() supplies a token
    if (!activeTick) return beginTick(force, scope, propagateErrors);
    if (!force) return activeTick;
    const runningCovers = activeTickForced
      && (activeTickScope === "all" || scope === "view")
      && activeTickGeneration === viewGeneration;
    if (runningCovers) return activeTick;
    if (queuedForcedTick) {
      if (scope === "all") queuedForcedScope = "all";
      return queuedForcedTick;
    }

    const predecessor = activeTick;
    queuedForcedScope = scope;
    const queued = predecessor
      .catch(() => undefined)
      .then(() => beginTick(true, queuedForcedScope, propagateErrors))
      .finally(() => {
        if (queuedForcedTick === queued) queuedForcedTick = null;
      });
    queuedForcedTick = queued;

    return queued;
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function start(payload: HarnessStartPayload): Promise<void> {
    stop();
    ctx = { maargUrl: payload.maargUrl, token: payload.token, omsInstance: payload.omsInstance, now: Date.now() };
    baseDomains = payload.domains ?? getAllSyncDomains()
      .filter((d) => d.syncClass === "B")
      .map((d) => ({ name: d.name }));
    baseTickMs = payload.baseTickMs ?? DEFAULT_BASE_TICK_MS;
    try {
      await ensureDbReady(getDb(payload.omsInstance));
    } catch (err) {
      const error = new Error(`cache open failed: ${(err as any)?.message ?? err}`, { cause: err });
      post({ type: "sync-error", domain: "__start", message: error.message });
      throw error;
    }
    for (const key of Object.keys(lastRunAt)) delete lastRunAt[key];
    await tick();
    timer = setInterval(() => void tick(), baseTickMs);
  }

  function setDomains(domains: ActiveDomain[]): void {
    const before = activeDomains();
    viewDomains = domains ?? [];
    viewGeneration += 1;
    // Drop run history only for activations no longer active, so a re-activation bootstraps again
    // while the start set keeps its once-per-login clock.
    const keys = new Set(activeDomains().map(activationKey));
    for (const key of Object.keys(lastRunAt)) {
      if (!keys.has(key)) delete lastRunAt[key];
    }
    // A dropped activation's passes no longer answer "has this screen's data been fetched". Reset a
    // domain unless an activation of it that was already active survives (the start set, say).
    const kept = before.filter((entry) => keys.has(activationKey(entry)));
    const reset = [...new Set(before
      .filter((entry) => !keys.has(activationKey(entry)))
      .map((entry) => entry.name)
      .filter((name) => !kept.some((entry) => entry.name === name)))];
    if (reset.length) post({ type: "activations-reset", domains: reset });
    runNewActivations();
  }

  /**
   * Start the screen's newly due activations now, rather than on the next tick or behind a pass
   * already running (after login that is every seed domain). Before `start()` there is no timer and
   * the first tick covers them. They run alongside any running pass: work on one domain is still
   * serialised by `runDomain`.
   */
  function runNewActivations(): void {
    if (!timer || !ctx.token) return;
    const due = dueDomains(viewDomains, lastRunAt, Date.now(), (entry) => effectiveInterval(entry, getSyncDomain(entry.name)))
      .filter((entry) => !activationRuns.has(activationKey(entry)));
    let previous: Promise<unknown> = Promise.resolve();
    for (const entry of due) {
      const key = activationKey(entry);
      // Sequential among themselves, like a tick. Skipped if the screen moved on before its turn.
      const run = previous
        .catch(() => undefined)
        .then(() => (isActive(key) ? runDomain(entry, false, true) : 0));
      previous = run;
      activationRuns.set(key, run);
      // Removed once settled; the catch only marks the rejection handled, `sync-error` reported it.
      run.catch(() => undefined).finally(() => {
        if (activationRuns.get(key) === run) activationRuns.delete(key);
      });
    }
  }

  function syncDomainNow(domain: string): Promise<number> {
    const entry = activeDomains().find((candidate) => candidate.name === domain) ?? { name: domain };

    return runDomain(entry, true, true);
  }

  async function runTargetedRefetch(
    request: { domain: string; pk: Record<string, unknown> },
    scope: string,
  ): Promise<number> {
    const domain = getSyncDomain(request.domain);
    if (!domain?.refetchOne) {
      const error = new Error("domain has no refetchOne");
      post({ type: "sync-error", domain: request.domain, scope, message: error.message });
      throw error;
    }
    const entry = activeDomains().find((candidate) => candidate.name === request.domain);
    ctx.now = Date.now();
    try {
      const written = (entry?.args !== undefined
        ? await domain.refetchOne(ctx, request.pk, entry.args)
        : await domain.refetchOne(ctx, request.pk)) ?? 0;
      post({ type: "refetch-end", domain: request.domain, scope, written });

      return written as number;
    } catch (err) {
      const { isAuth, message } = classifyError(err);
      post({
        type: isAuth ? "auth-error" : "sync-error",
        domain: request.domain,
        scope,
        message,
      });
      throw err;
    }
  }

  async function refetchOne(request: { domain: string; pk: Record<string, unknown> }): Promise<number> {
    // The main thread records a failed refetch under cacheScopeKey(pk) too, so both sides must
    // key the same PK identically or one failure is filed twice and only one copy ever clears.
    const scope = cacheScopeKey(request.pk);
    const queueKey = `${request.domain}:${scope}`;
    const previous = refetchQueues.get(queueKey) ?? Promise.resolve();
    const operation = runSharedDomainOperation(
      request.domain,
      () => previous.then(() => runTargetedRefetch(request, scope)),
    );
    const tail = operation.then(() => undefined, () => undefined);
    refetchQueues.set(queueKey, tail);

    return operation.finally(() => {
      if (refetchQueues.get(queueKey) === tail) refetchQueues.delete(queueKey);
    });
  }

  function catalog(): CatalogItem[] {
    return getAllSyncDomains().map((d) => ({
      name: d.name,
      ...(d.table ? { table: d.table } : {}),
      label: d.label,
      syncClass: d.syncClass,
    }));
  }

  return {
    start,
    syncNow: () => tick(true, true, "view"),
    syncAll: () => tick(true, true, "all"),
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
