import { computed, reactive, ref, type ComputedRef, type Ref } from "vue";
import type { AppDb } from "../schema/defineAppDb";
import { clearDatabaseTables } from "../storage/baseDb";
import { clearSeedTables } from "../composables/useSeedData";
import {
  clearDomainErrors,
  clearScopeError,
  createSyncService as defaultCreateSyncService,
  recordSyncError,
  serviceState,
  type SyncService,
} from "./syncService";
import type { ActiveDomain } from "./syncRegistry";
import { CacheReconciliationError, cacheScopeKey } from "./reconciliation";

export interface AppDbSyncConfig {
  db: AppDb;
  getWorkerUrl?: () => URL;
  createSyncService?: typeof defaultCreateSyncService;
  onStatus?: (status: Record<string, any>) => void;
}

export interface AppDbSync {
  syncService: () => SyncService | null;
  startAppDbSync: (onSynced?: () => void) => Promise<void>;
  stopAppDbSync: () => Promise<void>;
  refreshAfterMutation: (domain: string, pk: Record<string, unknown>) => Promise<number>;
  resyncDomain: (domain: string) => Promise<void>;
  resyncReferenceData: () => Promise<void>;
  bootstrapState: typeof bootstrapState;
  activateSyncDomains: (domains: ActiveDomain[], owner: string) => Promise<void>;
  deactivateSyncDomains: (owner?: string) => Promise<void>;
  createSyncDomainOwner: (label: string) => string;
  syncDomainsReady: Ref<boolean>;
  syncDomainsError: ComputedRef<string>;
  syncNow: () => Promise<void>;
}

export const bootstrapState = reactive<{
  running: boolean;
  written: Record<string, number>;
  errors: Record<string, string>;
}>({
  get running() {
    return serviceState.running;
  },
  set running(v) {
    serviceState.running = v;
  },
  written: serviceState.written,
  errors: serviceState.errors,
});

export function setupAppDbSync(config: AppDbSyncConfig): AppDbSync {
  let service: SyncService | null = null;
  let starting: Promise<void> | null = null;
  let startGeneration = 0;

  function syncService(): SyncService | null {
    return service;
  }

  /**
   * The domain set the open view activated.
   *
   * Module-scoped, not per-caller: there is ONE worker, so there is one active set. Deliberately
   * not exported — nothing outside needs to read it, and three views already define their own local
   * `activeSyncDomains()` builders that an export of this name would shadow.
   */
  const activeSyncDomains = ref<ActiveDomain[]>([]);
  const syncDomainsReady = ref(false);
  /** The screen that currently holds the worker. Task 3 uses this to reject a late teardown. */
  let activeOwner: string | null = null;
  /**
   * Bumped on every `activateSyncDomains` call and every accepted `deactivateSyncDomains`.
   * `setDomains` is an RPC to the worker with no ordering guarantee, so an activation's
   * post-await continuation checks this before flipping readiness back on — otherwise a
   * teardown that lands while an activation is still in flight gets resurrected by that
   * stale continuation. Same pattern as `startGeneration` above.
   */
  let activationGeneration = 0;
  /** Counter backing `createSyncDomainOwner` — see that function for why owners must be per instance. */
  let ownerSequence = 0;

  /**
   * A distinct owner id for one screen INSTANCE.
   *
   * Per instance, not per component: three routes share the ShopifyInventorySync component and
   * navigate to each other, and both order-sync sessions share one feature id. Two live instances
   * holding the same owner string would defeat the teardown guard entirely — the departing one's
   * `didLeave` would match, and wipe the arriving one's domains.
   */
  function createSyncDomainOwner(label: string): string {
    return `${label}:${++ownerSequence}`;
  }

  /** Scope the worker to the domains the open view needs. Safe to call again to re-scope. */
  async function activateSyncDomains(domains: ActiveDomain[], owner: string): Promise<void> {
    const generation = ++activationGeneration;
    activeOwner = owner;
    activeSyncDomains.value = domains;
    // A newly activated domain has not been tried by THIS screen yet, so a failure recorded while
    // another screen held it is stale evidence. Clearing here means the first pass either succeeds
    // (stays clear) or fails and records fresh — rather than a just-opened screen inheriting a
    // banner, or `manualRefresh` throwing on someone else's failure.
    for (const domain of domains) clearDomainErrors(domain.name);
    const current = syncService();
    if (!current) {
      // No worker (a failed start, or a test double that never spawned one). The view is still
      // "ready" in the only sense it can act on: nothing further is pending on its behalf.
      syncDomainsReady.value = true;
      return;
    }
    await current.setDomains(domains);
    if (generation !== activationGeneration) return;
    syncDomainsReady.value = true;
  }

  /**
   * Retire the open screen's domains.
   *
   * `owner` is the id the caller activated under. Ionic fires `didLeave` on the OUTGOING view
   * after `willEnter` on the incoming one, so a view's teardown routinely runs when the screen
   * that replaced it already owns the worker; clearing there leaves the new screen polling
   * nothing until some unrelated watcher happens to re-activate it.
   *
   * Keyed on the owner rather than on the domain set because a screen's set legitimately changes
   * while it is open — ShopifyProductSync re-activates as job names resolve — so a set comparison
   * would reject that screen's own teardown and leak the polling it was meant to stop. A caller
   * with no owner (a hard reset, a test) keeps the unconditional clear.
   */
  async function deactivateSyncDomains(owner?: string): Promise<void> {
    if (owner && activeOwner !== owner) return;
    if (activeSyncDomains.value.length === 0) return;
    activeOwner = null;
    activeSyncDomains.value = [];
    syncDomainsReady.value = false;
    activationGeneration += 1;
    await syncService()?.setDomains([]);
  }

  /**
   * The last erroring domain in the open view's activated set, in that array's own order, or ""
   * when none of them are in error. `serviceState.errors` carries no timestamps, so this is not
   * "the newest failure" — it is whichever activated domain sorts last among the failing ones as
   * the caller listed them. A screen that activates several domains (the connection-sync session
   * activates around eight) should not read this as freshness.
   *
   * Scoped rather than global so a background domain's failure cannot light a banner on an
   * unrelated screen. `serviceState.errors` is the single source — `syncService` owns those maps
   * and every failure path, including a failed start and a failed post-mutation refetch, reports
   * through `recordSyncError` into them.
   */
  const syncDomainsError = computed(() =>
    activeSyncDomains.value
      .map((domain) => serviceState.errors[domain.name])
      .filter(Boolean)
      .pop() ?? "");

  /**
   * Force a pass over whatever is currently active.
   *
   * Distinct from `resyncReferenceData`, which first deletes the sync markers so every domain
   * re-seeds from scratch. This is the cheap "refresh what is on screen" the views want.
   */
  async function syncNow(): Promise<void> {
    await syncService()?.syncNow();
  }

  async function clearSyncMarkers(): Promise<void> {
    try {
      const syncMeta = config.db.raw().syncMeta;
      const keys = await syncMeta.toCollection().primaryKeys();
      const domainKeys = (keys as string[]).filter(
        (key) => key.startsWith("domain:") || key.startsWith("loginSync:")
      );
      if (domainKeys.length) {
        await syncMeta.bulkDelete(domainKeys);
      }
    } catch {
      // Ignore if table unavailable
    }
  }

  function startAppDbSync(onSynced?: () => void): Promise<void> {
    if (starting) return starting;
    const generation = ++startGeneration;

    const factory = config.createSyncService ?? defaultCreateSyncService;
    const workerUrl = config.getWorkerUrl ? config.getWorkerUrl() : (undefined as any);
    const attemptService = factory({
      workerUrl,
      db: config.db.raw(),
      /**
       * Error bookkeeping lives in ONE place — `syncService`'s maps, reached through the helpers
       * imported above. This handler routes the same statuses because a caller may supply its own
       * `createSyncService` (tests do), and then this is the only listener that runs. Every helper
       * is idempotent, so the real service having already recorded the message changes nothing.
       */
      onStatus: (status: Record<string, any>) => {
        if (generation !== startGeneration || service !== attemptService) return;
        if (status.type === "sync-end" && status.domain) {
          const domain = String(status.domain);
          bootstrapState.written[domain] = status.written ?? 0;
          clearDomainErrors(domain);
        } else if (status.type === "refetch-end" && status.domain) {
          const domain = String(status.domain);
          bootstrapState.written[domain] = status.written ?? 0;
          if (typeof status.scope === "string" && status.scope) {
            clearScopeError(domain, status.scope);
          }
        } else if (status.type === "sync-error" || status.type === "auth-error") {
          const domain = String(status.domain || "__start");
          const scope = typeof status.scope === "string" && status.scope ? status.scope : undefined;
          recordSyncError(domain, String(status.message ?? "failed"), scope);
        }
        config.onStatus?.(status);
      },
    }) as SyncService;
    service = attemptService;

    let succeeded = false;
    const readiness = attemptService
      .start()
      .then(() => {
        if (generation !== startGeneration || service !== attemptService) return;
        succeeded = true;
        clearDomainErrors("__start");
        onSynced?.();
      })
      .catch((err) => {
        if (generation !== startGeneration || service !== attemptService) return;
        recordSyncError("__start", err instanceof Error ? err.message : String(err));
        attemptService.stop();
        service = null;
      })
      .finally(() => {
        if (generation !== startGeneration) return;
        bootstrapState.running = false;
        if (!succeeded && starting === readiness) starting = null;
      });

    starting = readiness;
    return readiness;
  }

  async function stopAppDbSync(): Promise<void> {
    startGeneration += 1;
    if (service) {
      service.stop();
      service = null;
    }
    starting = null;
    bootstrapState.running = false;
    clearSeedTables();
    await clearDatabaseTables(config.db.raw()).catch(() => {});
  }

  async function whenReady(): Promise<void> {
    const readiness = starting ?? startAppDbSync();
    try {
      await readiness;
    } catch {
      // Recorded in bootstrapState.errors
    }
  }

  async function refreshAfterMutation(
    domain: string,
    pk: Record<string, unknown>
  ): Promise<number> {
    await whenReady();
    if (bootstrapState.errors.__start) {
      throw new CacheReconciliationError(
        domain,
        pk,
        new Error(bootstrapState.errors.__start)
      );
    }
    if (!service) {
      const cause = new Error("The reference-cache service is unavailable.");
      recordSyncError(domain, cause.message, cacheScopeKey(pk));
      throw new CacheReconciliationError(domain, pk, cause);
    }
    try {
      return await service.refetchOne(domain, pk);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordSyncError(domain, message, cacheScopeKey(pk));
      throw new CacheReconciliationError(domain, pk, error);
    }
  }

  async function resyncDomain(domain: string): Promise<void> {
    try {
      await config.db.raw().syncMeta.delete(`loginSync:${domain}`);
    } catch {}
    await whenReady();
    if (!service) {
      throw new Error(bootstrapState.errors.__start ?? "The reference-cache service is unavailable.");
    }
    await service.syncDomainNow(domain);
  }

  async function resyncReferenceData(): Promise<void> {
    await clearSyncMarkers();
    await whenReady();
    if (!service) {
      throw new Error(bootstrapState.errors.__start ?? "The reference-cache service is unavailable.");
    }
    await service.syncNow();
  }

  return {
    syncService,
    startAppDbSync,
    stopAppDbSync,
    refreshAfterMutation,
    resyncDomain,
    resyncReferenceData,
    bootstrapState,
    activateSyncDomains,
    deactivateSyncDomains,
    createSyncDomainOwner,
    syncDomainsReady,
    syncDomainsError,
    syncNow,
  };
}
