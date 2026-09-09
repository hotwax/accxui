/**
 * Main-thread sync service (unified).
 *
 * Merges three prior implementations into one:
 *   - `pollingService.ts`'s worker lifecycle (spawn via `WorkerFactory`, token push over
 *     BroadcastChannel, status routing, the auth-error hook);
 *   - `appDbBootstrap.ts`'s row-shape check: `ensureRowShape` now lives on `baseDb.ts` (a database
 *     concern, shared with `clearDatabaseTables`) and this service runs it against the caller's
 *     `BaseDB`, when one is given, before spawning the worker — see `SyncServiceOptions.db`;
 *   - Company's `appCacheBootstrap.ts` idempotent once-per-login `start()`: the in-flight
 *     `starting` promise plus a `startGeneration` counter so a terminated attempt's last queued
 *     worker message can never mutate state after teardown.
 *
 * MAIN-THREAD ONLY. This module may import `vue` (it exports a `reactive` state object) and MUST
 * NEVER be imported by `pollingWorkerHarness.ts` or anything a worker entry reaches — that would
 * pull `vue` into a worker chunk Vite must emit as a single iife.
 */

import { reactive } from "vue";
import type { Remote } from "comlink";
import { commonUtil } from "../../utils/commonUtil";
import { WorkerFactory } from "../../core/workerFactory";
import { createTokenPublisher } from "./pollingTokenChannel";
import type { ActiveDomain } from "./syncRegistry";
import type { CatalogItem, SyncHarness } from "./pollingWorkerHarness";
import { type BaseDB, ensureRowShape } from "../baseDb";

export interface SyncServiceOptions {
  /** The Web Worker URL or instance (e.g. `new URL('./appSync.worker.ts', import.meta.url)`) */
  workerUrl: string | URL;
  /** Domains to activate, with per-activation args. Omit to activate every class A/B domain. */
  domains?: ActiveDomain[];
  /** How often the worker re-evaluates which domains are due (default 5s). */
  baseTickMs?: number;
  /** Status messages the worker posts: sync-start | sync-end | sync-error | auth-error | refetch-end. */
  onStatus?: (status: Record<string, any>) => void;
  /** Called when the worker reports an auth failure; wire to the app's re-auth/logout. */
  onAuthError?: (message: string) => void;
  /**
   * The app's database, for the row-shape check (`ensureRowShape`) run once before the worker
   * spawns. Optional because an app that does not version its stored row shape omits it. Order
   * Manager passes it once it moves onto this service (Task 6).
   */
  db?: BaseDB;
  /** App-local token-change watcher cadence (default 15s). */
  tokenWatchMs?: number;
}

export interface SyncService {
  start: () => Promise<void>;
  /** Change the activated domain set without respawning the worker. */
  setDomains: (domains: ActiveDomain[]) => Promise<void>;
  /** Force every activated domain to run now. */
  syncNow: () => Promise<void>;
  /** Force one domain to re-sync now. */
  syncDomainNow: (domain: string) => Promise<number>;
  /** After a successful mutation: refetch that record by PK and upsert it into the cache. */
  refetchOne: (domain: string, pk: Record<string, unknown>) => Promise<number>;
  /** Status-card data: every registered domain, with its declared label and sync class. */
  catalog: () => Promise<CatalogItem[]>;
  /** Diagnostics: domains this worker build knows about. */
  registeredDomains: () => Promise<string[]>;
  /** Clear one domain's visible error (and every scope behind it) without waiting on a resync. */
  clearDomainError: (domain: string) => void;
  stop: () => void;
}

/**
 * Status of the last/current sync pass.
 *
 * REACTIVE on purpose: consumers read `running` to distinguish "the seed sync has not finished
 * yet" from "this table is genuinely empty".
 */
export const serviceState = reactive({
  running: false,
  lastSyncAt: 0,
  written: {} as Record<string, number>,
  errors: {} as Record<string, string>,
});

/**
 * A domain can have several independently refetched scopes in flight (for example one carrier
 * party per detail screen). Keep their failures separately even though the public status contract
 * intentionally exposes one message per domain.
 */
const domainErrors = new Map<string, string>();
const scopedDomainErrors = new Map<string, Map<string, string>>();

function updateVisibleError(domain: string): void {
  const domainError = domainErrors.get(domain);
  if (domainError !== undefined) {
    serviceState.errors[domain] = domainError;

    return;
  }
  const scoped = scopedDomainErrors.get(domain);
  const messages = scoped ? [...scoped.values()] : [];
  if (messages.length) {
    serviceState.errors[domain] = messages[messages.length - 1];
  } else {
    delete serviceState.errors[domain];
  }
}

function recordSyncError(domain: string, message: string, scope?: string): void {
  if (scope) {
    const scoped = scopedDomainErrors.get(domain) ?? new Map<string, string>();
    // The worker posts the scoped failure before its Comlink promise rejects. The service catch
    // records the same failure as a fallback, but must not move that duplicate behind a newer
    // failure from another PK and change the domain's visible diagnostic.
    if (scoped.get(scope) === message) {
      updateVisibleError(domain);

      return;
    }
    // Move a repeated failure to the end so the public message reflects the newest failure.
    scoped.delete(scope);
    scoped.set(scope, message);
    scopedDomainErrors.set(domain, scoped);
  } else {
    domainErrors.set(domain, message);
  }
  updateVisibleError(domain);
}

function clearDomainErrors(domain: string): void {
  domainErrors.delete(domain);
  scopedDomainErrors.delete(domain);
  updateVisibleError(domain);
}

function clearScopeError(domain: string, scope: string): void {
  const scoped = scopedDomainErrors.get(domain);
  scoped?.delete(scope);
  if (scoped?.size === 0) { scopedDomainErrors.delete(domain); }
  updateVisibleError(domain);
}

/**
 * Main-thread half of the sync service (framework-wide).
 *
 * Framework-owned so no single app dev can break the dangerous parts:
 *   - idempotent start — a second overlapping `start()` call awaits the same in-flight attempt
 *     rather than spawning a second worker (App.vue mounts can race);
 *   - spawns + terminates the single sync worker (via `WorkerFactory`);
 *   - hands the worker the current token at start, then keeps it fresh by PUSH over BroadcastChannel;
 *   - routes the worker's `auth-error` to the app's re-auth hook;
 *   - routes every status message to `serviceState` and the app's `onStatus` listener.
 */
export function createSyncService(opts: SyncServiceOptions): SyncService {
  let harness: Remote<SyncHarness> | null = null;
  let terminate: (() => void) | null = null;
  let publisher: ReturnType<typeof createTokenPublisher> | null = null;
  let tokenWatch: ReturnType<typeof setInterval> | null = null;
  let lastToken = "";
  let starting: Promise<void> | null = null;
  // Bumped on every start()/stop() so a terminated attempt's late worker message (queued before
  // teardown, delivered after) is ignored rather than mutating state past that teardown.
  let startGeneration = 0;

  function pushTokenIfChanged() {
    const current = commonUtil.getToken() || "";
    if (current && current !== lastToken) {
      lastToken = current;
      publisher?.publish(current);
    }
  }

  function handleMessage(generation: number, event: MessageEvent) {
    if (generation !== startGeneration) return; // a terminated attempt's last queued message
    const data = event.data || {};
    if (data.type === "auth-error") {
      pushTokenIfChanged(); // token may have just rotated — push the latest at once
      opts.onAuthError?.(String(data.message ?? "auth error"));
    }
    if (data.type === "sync-end" && data.domain) {
      serviceState.written[String(data.domain)] = data.written ?? 0;
      serviceState.lastSyncAt = Date.now();
      // A successful full snapshot verifies the whole domain and therefore every scoped row.
      clearDomainErrors(String(data.domain));
    } else if (data.type === "refetch-end" && data.domain) {
      serviceState.written[String(data.domain)] = data.written ?? 0;
      // A targeted read verifies only its own PK scope. A legacy message without scope cannot
      // safely prove that some other failed scope recovered, so it clears nothing.
      if (typeof data.scope === "string" && data.scope) {
        clearScopeError(String(data.domain), data.scope);
      }
    } else if (data.type === "sync-error" && data.domain) {
      const scope = typeof data.scope === "string" && data.scope ? data.scope : undefined;
      recordSyncError(String(data.domain), String(data.message ?? "failed"), scope);
    }
    opts.onStatus?.(data);
  }

  async function start(): Promise<void> {
    if (starting) return starting;
    const generation = ++startGeneration;
    serviceState.running = true;

    const attempt = (async () => {
      // Row-shape check runs first, before the worker exists to race it. `ensureRowShape` never
      // throws (it swallows and warns) — a shape-check failure must never block boot.
      if (opts.db) await ensureRowShape(opts.db);
      if (generation !== startGeneration) return; // terminated (stop()) while the shape check ran

      const targetUrl = typeof opts.workerUrl === "string"
        ? new URL(opts.workerUrl, import.meta.url)
        : opts.workerUrl;
      const { api, terminate: term, worker } = WorkerFactory.createWorker<SyncHarness>(targetUrl);
      harness = api;
      terminate = term;
      worker.onmessage = (event: MessageEvent) => handleMessage(generation, event);

      publisher = createTokenPublisher();
      lastToken = commonUtil.getToken() || "";

      await api.start({
        maargUrl: commonUtil.getMaargURL(),
        token: lastToken,
        omsInstance: commonUtil.getOMSInstanceName(),
        baseTickMs: opts.baseTickMs,
        domains: opts.domains,
      });

      if (generation !== startGeneration) return; // terminated (stop()) while starting

      tokenWatch = setInterval(pushTokenIfChanged, opts.tokenWatchMs ?? 15_000);
      serviceState.lastSyncAt = Date.now();
    })().finally(() => {
      if (generation === startGeneration) {
        serviceState.running = false;
        starting = null;
      }
    });

    starting = attempt;

    return attempt;
  }

  function stop(): void {
    startGeneration += 1; // invalidate any in-flight start()/late worker message
    starting = null;
    if (tokenWatch) { clearInterval(tokenWatch); tokenWatch = null; }
    if (publisher) { publisher.close(); publisher = null; }
    if (terminate) { terminate(); terminate = null; } // kills the worker + its timer
    harness = null;
    serviceState.running = false;
  }

  return {
    start,
    setDomains: async (domains) => { if (harness) await harness.setDomains(domains); },
    syncNow: async () => { if (harness) await harness.syncNow(); },
    syncDomainNow: async (domain) => (harness ? harness.syncDomainNow(domain) : 0),
    refetchOne: async (domain, pk) => (harness ? harness.refetchOne({ domain, pk }) : 0),
    catalog: async () => (harness ? harness.catalog() : []),
    registeredDomains: async () => (harness ? harness.domains() : []),
    clearDomainError: clearDomainErrors,
    stop,
  };
}
