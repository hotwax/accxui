import { translate } from "@common";
import type { ReturnOrigin, ShopifySync, SyncState } from "@/types/returns";

export type { ShopifySync }; // re-export so adapters can keep importing it from here

export interface Identification {
  returnIdentificationTypeId: string;
  idValue: string;
}

export function resolveOrigin(identifications: Identification[]): ReturnOrigin {
  return identifications.some((i) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID") ? "shopify" : "pwa";
}

/** Map a SyncState to an Ionic color token. */
export function syncColor(s: SyncState): string | undefined {
  return { synced: "success", pending: "warning", failed: "danger", not_synced: "medium" }[s];
}

/** Human-readable, translated label for a SyncState. */
export function syncLabel(s: SyncState): string {
  return translate({ synced: "Synced", pending: "Pending", failed: "Failed", not_synced: "Not synced" }[s]);
}

/**
 * Collapse the backend `shopifySync` object into the PWA's SyncState.
 * - null                → not_synced (never pushed; also the state on create)
 * - synced === true     → synced (AUTHORITATIVE — stays synced even after a Shopify-side cancel)
 * - PUSH_PENDING        → pending (outbound push in flight)
 * - PUSH_FAILED         → failed
 * - PUSH_OK             → synced
 * - else, has a Shopify return id → synced; otherwise not_synced
 */
export function resolveShopifySyncState(shopifySync: ShopifySync | null | undefined): SyncState {
  if (!shopifySync) return "not_synced";
  if (shopifySync.synced === true) return "synced";
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
