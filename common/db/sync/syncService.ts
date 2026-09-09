/**
 * Main-thread sync service (unified).
 *
 * Merges three prior implementations into one:
 *   - `pollingService.ts`'s worker lifecycle (spawn via `WorkerFactory`, token push over
 *     BroadcastChannel, status routing, the auth-error hook);
 *   - `appDbBootstrap.ts`'s row-shape marker is NOT ported here (it lives on `BaseDB`/
 *     `clearLocalDb` and stays with that module until Task 12 — this service does not own a
 *     `BaseDB` instance);
 *   - Company's `appCacheBootstrap.ts` idempotent once-per-login `start()`: the in-flight
 *     `starting` promise plus a `startGeneration` counter so a terminated attempt's last queued
 *     worker message can never mutate state after teardown.
 *
 * MAIN-THREAD ONLY. This module may import `vue` (it exports a `reactive` state object) and MUST
 * NEVER be imported by `pollingWorkerHarness.ts` or anything a worker entry reaches — that would
 * pull `vue` into a worker chunk Vite must emit as a single iife.
 *
 * The per-domain/per-scope error map (`serviceState.errors`, `clearDomainError`) is deferred to
 * Task 4, which ports it from Company's `appCacheBootstrap.ts`.
 */

import { reactive } from "vue";
import type { Remote } from "comlink";
import { commonUtil } from "../../utils/commonUtil";
import { WorkerFactory } from "../../core/workerFactory";
import { createTokenPublisher } from "./pollingTokenChannel";
import type { ActiveDomain } from "./syncRegistry";
import type { CatalogItem, SyncHarness } from "./pollingWorkerHarness";

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
});

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
    }
    opts.onStatus?.(data);
  }

  async function start(): Promise<void> {
    if (starting) return starting;
    const generation = ++startGeneration;
    serviceState.running = true;

    const attempt = (async () => {
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
    stop,
  };
}
