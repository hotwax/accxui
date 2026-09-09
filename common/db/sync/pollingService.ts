import type { Remote } from "comlink";
import { commonUtil } from "../../utils/commonUtil";
import { WorkerFactory } from "../../core/workerFactory";
import { createTokenPublisher } from "./pollingTokenChannel";
import type { ActiveDomain } from "./syncRegistry";
import type { SyncHarness } from "./pollingWorkerHarness";

export interface SyncServiceOptions {
  /** The Web Worker URL or instance (e.g. `new URL('./appSync.worker.ts', import.meta.url)`) */
  workerUrl: string | URL;
  /** Domains to activate, with per-activation args. */
  domains: ActiveDomain[];
  /** How often the worker re-evaluates which domains are due (default 5s). */
  baseTickMs?: number;
  /** Status messages the worker posts: sync-start | sync-end | sync-error | auth-error | refetch-end. */
  onStatus?: (status: Record<string, any>) => void;
  /** Called when the worker reports an auth failure; wire to the app's re-auth/logout. */
  onAuthError?: (message: string) => void;
  /** App-local token-change watcher cadence. */
  tokenWatchMs?: number;
}

export interface SyncService {
  start: () => Promise<void>;
  /** Force every activated domain to run now. */
  syncNow: () => Promise<void>;
  /** Change the activated domain set without respawning the worker. */
  setDomains: (domains: ActiveDomain[]) => Promise<void>;
  /** Force one domain to re-sync now. */
  syncDomainNow: (domain: string) => Promise<number>;
  /** After a successful mutation: refetch that record by PK and upsert it into the cache. */
  refetchOne: (domain: string, pk: Record<string, unknown>) => Promise<number>;
  /** Diagnostics: domains this worker build knows about. */
  registeredDomains: () => Promise<string[]>;
  stop: () => void;
}

/**
 * Main-thread half of the sync service (framework-wide).
 *
 * Framework-owned so no single app dev can break the dangerous parts:
 *   - spawns + terminates the single sync worker (via `WorkerFactory`);
 *   - hands the worker the current token at start, then keeps it fresh by PUSH over BroadcastChannel;
 *   - routes the worker's `auth-error` to the app's re-auth hook.
 */
export function createSyncService(opts: SyncServiceOptions): SyncService {
  let harness: Remote<SyncHarness> | null = null;
  let terminate: (() => void) | null = null;
  let publisher: ReturnType<typeof createTokenPublisher> | null = null;
  let tokenWatch: ReturnType<typeof setInterval> | null = null;
  let lastToken = "";

  function pushTokenIfChanged() {
    const current = commonUtil.getToken() || "";
    if (current && current !== lastToken) {
      lastToken = current;
      publisher?.publish(current);
    }
  }

  function handleMessage(event: MessageEvent) {
    const data = event.data || {};
    if (data.type === "auth-error") {
      pushTokenIfChanged(); // token may have just rotated — push the latest at once
      opts.onAuthError?.(String(data.message ?? "auth error"));
    }
    opts.onStatus?.(data);
  }

  async function start() {
    const targetUrl = typeof opts.workerUrl === "string" ? new URL(opts.workerUrl, import.meta.url) : opts.workerUrl;
    const { api, terminate: term, worker } = WorkerFactory.createWorker<SyncHarness>(targetUrl);
    harness = api;
    terminate = term;
    worker.onmessage = handleMessage;

    publisher = createTokenPublisher();
    lastToken = commonUtil.getToken() || "";

    await api.start({
      maargUrl: commonUtil.getMaargURL(),
      token: lastToken,
      omsInstance: commonUtil.getOMSInstanceName(),
      baseTickMs: opts.baseTickMs,
      domains: opts.domains,
    });

    tokenWatch = setInterval(pushTokenIfChanged, opts.tokenWatchMs ?? 15_000);
  }

  return {
    start,
    syncNow: async () => { if (harness) await harness.syncNow(); },
    syncDomainNow: async (domain) => (harness ? harness.syncDomainNow(domain) : 0),
    setDomains: async (domains) => { if (harness) await harness.setDomains(domains); },
    refetchOne: async (domain, pk) => (harness ? harness.refetchOne({ domain, pk }) : 0),
    registeredDomains: async () => (harness ? harness.domains() : []),
    stop: () => {
      if (tokenWatch) { clearInterval(tokenWatch); tokenWatch = null; }
      if (publisher) { publisher.close(); publisher = null; }
      if (terminate) { terminate(); terminate = null; } // kills the worker + its timer
      harness = null;
    },
  };
}
