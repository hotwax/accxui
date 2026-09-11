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
  /** Force every activated domain to run now (manual refresh, routed from the main thread). */
  syncNow: () => Promise<void>;
  /** Force one domain to re-sync now, bypassing the once-per-login guard. */
  syncDomainNow: (domain: string) => Promise<number>;
  /** Refetch one record after a mutation. */
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

/** A stable string for one PK, so two refetches of the same record share a queue. */
function scopeKeyOf(pk: Record<string, unknown>): string {
  return Object.keys(pk).sort().map((k) => `${k}=${String(pk[k])}`).join("|");
}

export function createSyncHarness(getDb: (omsInstance: string) => BaseDB): SyncHarness {
  let ctx: SyncContext = { maargUrl: "", token: "", omsInstance: "", now: Date.now() };
  let active: ActiveDomain[] = [];
  let baseTickMs = DEFAULT_BASE_TICK_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  const lastRunAt: Record<string, number> = {};
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
      post({ type: "sync-end", domain: entry.name, written, at, retryPending: !completed });
      syncChannel?.postMessage({ type: "domain-synced", domain: entry.name });

      return written as number;
    } catch (err) {
      if (effectiveInterval(entry, domain) !== undefined) lastRunAt[clockKey] = Date.now();
      const message = (err as any)?.message ?? (typeof err === "string" ? err : JSON.stringify(err ?? ""));
      post({ type: "sync-error", domain: entry.name, message });
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

  async function tick(force = false, propagateErrors = false): Promise<void> {
    if (running || !ctx.token) return;
    running = true;
    try {
      const now = Date.now();
      const due = force
        ? active
        : dueDomains(active, lastRunAt, now, (entry) => effectiveInterval(entry, getSyncDomain(entry.name)));
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
    stop();
    ctx = { maargUrl: payload.maargUrl, token: payload.token, omsInstance: payload.omsInstance, now: Date.now() };
    active = payload.domains ?? getAllSyncDomains()
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
    active = domains ?? [];
    const keys = new Set(active.map(activationKey));
    for (const key of Object.keys(lastRunAt)) {
      if (!keys.has(key)) delete lastRunAt[key];
    }
  }

  function syncDomainNow(domain: string): Promise<number> {
    const entry = active.find((candidate) => candidate.name === domain) ?? { name: domain };

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
    const entry = active.find((candidate) => candidate.name === request.domain);
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
    const scope = scopeKeyOf(request.pk);
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
