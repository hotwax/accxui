/**
 * Main-thread Local Database Bootstrap and Mutation Dispatcher.
 */

import { wrap, type Remote } from "comlink";
import { reactive } from "vue";
import type { BaseDB } from "../baseDb";
import { clearDatabaseTables } from "../baseDb";
import type { SyncHarness } from "./pollingWorkerHarness";

export const bootstrapState = reactive({
  running: false,
  lastSyncAt: 0,
  error: null as string | null,
});

let workerInstance: Worker | null = null;
let harnessProxy: Remote<SyncHarness> | null = null;
let currentDb: BaseDB | null = null;

export interface BootstrapConfig {
  workerFactory: () => Worker;
  token: string;
  maargUrl: string;
  /** OMS instance whose database is being synced. Forwarded to the worker. */
  omsInstance: string;
  db: BaseDB;
  domains?: string[];
  baseTickMs?: number;
}

export async function startDbBootstrap(config: BootstrapConfig): Promise<void> {
  currentDb = config.db;
  bootstrapState.running = true;
  bootstrapState.error = null;

  try {
    if (!workerInstance) {
      workerInstance = config.workerFactory();
      harnessProxy = wrap<SyncHarness>(workerInstance);
    }

    await harnessProxy.start({
      token: config.token,
      maargUrl: config.maargUrl,
      omsInstance: config.omsInstance,
      domains: config.domains,
      baseTickMs: config.baseTickMs,
    });

    bootstrapState.lastSyncAt = Date.now();
  } catch (error: any) {
    console.error("[db-bootstrap] Bootstrap failed:", error);
    bootstrapState.error = error?.message || "Database sync failed";
  } finally {
    bootstrapState.running = false;
  }
}

export function updateWorkerToken(token: string): void {
  if (harnessProxy) {
    harnessProxy.updateToken(token);
  }
}

export async function refreshAfterMutation(domain: string, pk: Record<string, unknown>): Promise<void> {
  if (harnessProxy) {
    try {
      await harnessProxy.refetchOne(domain, pk);
    } catch (error) {
      console.warn(`[db] Failed to refresh record after mutation for ${domain}:`, error);
    }
  }
}

import { getAllSyncDomains, getSyncDomain } from "./syncRegistry";
import { cookieHelper } from "../../helpers/cookieHelper";
import { commonUtil } from "../../utils/commonUtil";

export async function resyncDomain(domain: string): Promise<void> {
  if (harnessProxy) {
    try {
      await harnessProxy.resyncDomain(domain);
      return;
    } catch (error) {
      console.warn(`[db] Failed to resync domain ${domain} via worker, attempting direct sync:`, error);
    }
  }

  const syncDomain = getSyncDomain(domain);
  if (syncDomain) {
    const token = cookieHelper().get("api_key") || cookieHelper().get("token") || "";
    const maargUrl = commonUtil.getMaargURL();
    if (currentDb) {
      await currentDb.syncMeta.delete(`loginSync:${domain}`);
    }
    await syncDomain.sync({
      syncId: `manual-${domain}-${Date.now()}`,
      token,
      maargUrl,
      omsInstance: commonUtil.getOMSInstanceName(),
      now: Date.now(),
      trigger: "manual",
    });
  }
}

export async function resyncAll(): Promise<void> {
  if (harnessProxy) {
    try {
      await harnessProxy.resyncAll();
      return;
    } catch (error) {
      console.warn(`[db] Failed to resync all domains via worker, attempting direct sync:`, error);
    }
  }

  const all = getAllSyncDomains();
  const token = cookieHelper().get("api_key") || cookieHelper().get("token") || "";
  const maargUrl = commonUtil.getMaargURL();
  for (const domain of all) {
    if (currentDb) {
      await currentDb.syncMeta.delete(`loginSync:${domain.name}`);
    }
    try {
      await domain.sync({
        syncId: `manual-all-${Date.now()}`,
        token,
        maargUrl,
        omsInstance: commonUtil.getOMSInstanceName(),
        now: Date.now(),
        trigger: "manual",
      });
    } catch (err) {
      console.warn(`[db] Failed to sync ${domain.name}:`, err);
    }
  }
}

export async function clearLocalDb(db?: BaseDB): Promise<void> {
  const targetDb = db || currentDb;
  if (harnessProxy) {
    harnessProxy.stop();
  }
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
    harnessProxy = null;
  }
  if (targetDb) {
    await clearDatabaseTables(targetDb);
  }
  bootstrapState.running = false;
  bootstrapState.lastSyncAt = 0;
}
