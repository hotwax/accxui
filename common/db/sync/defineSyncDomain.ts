import type { SyncContext, SyncDomain } from "../types";

export interface SyncDomainConfig {
  name: string;
  label: string;
  syncClass: "A" | "B" | "C";
  table: string;
  intervalMs?: number;
  sync: (ctx: SyncContext, args?: any, options?: { force?: boolean }) => Promise<number | void>;
  refetchOne?: (ctx: SyncContext, pk: Record<string, unknown>, args?: any) => Promise<number | void>;
}

export function defineSyncDomain(config: SyncDomainConfig): SyncDomain {
  return {
    name: config.name,
    table: config.table,
    label: config.label,
    syncClass: config.syncClass,
    ...(config.intervalMs !== undefined ? { intervalMs: config.intervalMs } : {}),
    sync: config.sync,
    ...(config.refetchOne ? { refetchOne: config.refetchOne } : {}),
  };
}
