/**
 * Worker-side sync harness.
 */

import { expose } from "comlink";
import { BaseCacheDB, ensureCacheReady } from "../db";
import type { SyncContext } from "../types";
import { getAllSyncDomains, getSyncDomain } from "./syncRegistry";

export interface HarnessStartPayload {
  maargUrl: string;
  token: string;
  /** Required — the worker has no cookies, so the main thread must name the OMS to cache into. */
  omsInstance: string;
  domains?: string[];
  baseTickMs?: number;
}

export interface SyncHarness {
  start: (payload: HarnessStartPayload) => Promise<void>;
  syncNow: () => Promise<void>;
  resyncDomain: (domain: string) => Promise<void>;
  resyncAll: () => Promise<void>;
  refetchOne: (domain: string, pk: Record<string, unknown>) => Promise<void>;
  updateToken: (token: string) => void;
  stop: () => void;
  getDomainNames: () => string[];
}

export function createPollingWorkerHarness(getDb: (omsInstance: string) => BaseCacheDB): SyncHarness {
  let ctx: SyncContext = { token: "", now: Date.now(), maargUrl: "", omsInstance: "" };
  let activeDomainNames: string[] = [];
  let timer: any = null;
  let running = false;

  const syncChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("hotwax-cache-sync") : null;

  async function tick() {
    if (running || !ctx.token) return;
    running = true;
    try {
      ctx.now = Date.now();
      const all = getAllSyncDomains();
      const targets = activeDomainNames.length > 0
        ? all.filter((d) => activeDomainNames.includes(d.name))
        : all;

      for (const domain of targets) {
        try {
          await domain.sync(ctx);
          syncChannel?.postMessage({ type: "domain-synced", domain: domain.name });
        } catch (error) {
          console.warn(`[cache-worker] Sync failed for domain ${domain.name}:`, error);
        }
      }
      syncChannel?.postMessage({ type: "sync-complete" });
    } finally {
      running = false;
    }
  }

  const harness: SyncHarness = {
    async start(payload: HarnessStartPayload) {
      if (timer) clearInterval(timer);
      ctx = {
        token: payload.token,
        maargUrl: payload.maargUrl,
        omsInstance: payload.omsInstance,
        now: Date.now(),
      };
      activeDomainNames = payload.domains || [];

      const db = getDb(ctx.omsInstance);
      await ensureCacheReady(db);

      await tick();
      if (payload.baseTickMs && payload.baseTickMs > 0) {
        timer = setInterval(tick, payload.baseTickMs);
      }
    },

    async syncNow() {
      await tick();
    },

    async resyncDomain(domainName: string) {
      const domain = getSyncDomain(domainName);
      if (!domain) return;
      ctx.now = Date.now();
      const db = getDb(ctx.omsInstance);
      await db.syncMeta.delete(`loginSync:${domainName}`);
      await domain.sync(ctx);
      syncChannel?.postMessage({ type: "domain-synced", domain: domainName });
    },

    async resyncAll() {
      ctx.now = Date.now();
      const db = getDb(ctx.omsInstance);
      const all = getAllSyncDomains();
      for (const domain of all) {
        await db.syncMeta.delete(`loginSync:${domain.name}`);
      }
      await tick();
    },

    async refetchOne(domainName: string, pk: Record<string, unknown>) {
      const domain = getSyncDomain(domainName);
      if (!domain || !domain.refetchOne) return;
      ctx.now = Date.now();
      await domain.refetchOne(pk, ctx);
    },

    updateToken(token: string) {
      ctx.token = token;
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    getDomainNames() {
      return getAllSyncDomains().map((d) => d.name);
    },
  };

  return harness;
}

export function exposeWorkerHarness(getDb: (omsInstance: string) => BaseCacheDB): void {
  const harness = createPollingWorkerHarness(getDb);
  expose(harness);
}
