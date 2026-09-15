import { reactive } from "vue";
import type { AppDb } from "../defineAppDb";
import { clearDatabaseTables } from "../baseDb";
import {
  clearDomainErrors,
  clearScopeError,
  createSyncService as defaultCreateSyncService,
  recordSyncError,
  serviceState,
  type SyncService,
} from "./syncService";
import { CacheReconciliationError } from "../cacheReconciliationError";
import { cacheScopeKey } from "../cacheScopeKey";

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
    syncService: () => service,
    startAppDbSync,
    stopAppDbSync,
    refreshAfterMutation,
    resyncDomain,
    resyncReferenceData,
    bootstrapState,
  };
}
