import type { ReturnOrigin, SyncState } from "@/types/returns";

export interface Identification {
  returnIdentificationTypeId: string;
  idValue: string;
}

export function resolveOrigin(identifications: Identification[]): ReturnOrigin {
  return identifications.some((i) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID") ? "shopify" : "pwa";
}

/** The backend `shopifySync` map on a return detail (null when there is no Shopify state). */
export interface ShopifySync {
  shopifyReturnId?: string | null;
  pushStatusId?: string | null; // PUSH_OK | PUSH_PENDING | PUSH_FAILED | null
}

/**
 * Collapse the backend `shopifySync` map into the PWA's SyncState.
 * - PUSH_OK            → synced
 * - PUSH_PENDING       → pending (outbound push in flight)
 * - PUSH_FAILED        → failed
 * - no push status but a Shopify return id present (inbound-origin) → synced
 * - null / no id       → not_synced (OMS-only return awaiting a push)
 */
export function resolveShopifySyncState(shopifySync: ShopifySync | null | undefined): SyncState {
  if (!shopifySync) return "not_synced";
  switch (shopifySync.pushStatusId) {
    case "PUSH_OK":
      return "synced";
    case "PUSH_PENDING":
      return "pending";
    case "PUSH_FAILED":
      return "failed";
    default:
      return shopifySync.shopifyReturnId ? "synced" : "not_synced";
  }
}
