import type { ReturnOrigin, SyncState } from "@/types/returns";

export interface Identification {
  returnIdentificationTypeId: string;
  idValue: string;
}

export function resolveOrigin(identifications: Identification[]): ReturnOrigin {
  return identifications.some((i) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID") ? "shopify" : "pwa";
}

export interface SyncStateInput {
  hasShopifyId: boolean;
  origin: ReturnOrigin;
  pushAttempted: boolean;
  pushFailed: boolean;
}

export function resolveSyncState({ hasShopifyId, origin, pushAttempted, pushFailed }: SyncStateInput): SyncState {
  if (hasShopifyId) return "synced";
  if (pushFailed) return "failed";
  if (pushAttempted) return "pending";
  // Shopify-origin returns are mid-ingest until their GID is recorded; PWA returns await a push.
  return origin === "shopify" ? "pending" : "not_synced";
}
