import { translate } from "@common";
import type { CompletionState, ReturnOrigin, ShopifySync, SyncState } from "@/types/returns";

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

/** Map a CompletionState to an Ionic color token. */
export function completionColor(s: CompletionState): string | undefined {
  return { completed: "success", pending: "warning", failed: "danger", skipped: "medium" }[s];
}

/** Human-readable, translated label for a CompletionState. */
export function completionLabel(s: CompletionState): string {
  return translate({ completed: "Closed in Shopify", pending: "Completing", failed: "Failed", skipped: "Not in Shopify" }[s]);
}

/**
 * Collapse the backend `shopifySync` completion fields into a CompletionState. Only meaningful once the
 * OMS return is RETURN_COMPLETED — the caller drives that off statusId.
 * - no shopifyReturnId  → skipped (never synced; the Shopify completion no-ops — "Completed (not in Shopify)")
 * - returnStatusId == CLOSED → completed (AUTHORITATIVE) — also CLOSE_OK
 * - CLOSE_PENDING / unset    → pending (close push in flight, or just triggered)
 * - CLOSE_FAILED             → failed (surface closePushErrorMessage + Retry)
 */
export function resolveShopifyCloseState(shopifySync: ShopifySync | null | undefined): CompletionState {
  if (!shopifySync || !shopifySync.shopifyReturnId) return "skipped";
  if (shopifySync.returnStatusId === "CLOSED") return "completed";
  switch (shopifySync.closePushStatusId) {
    case "CLOSE_OK":
      return "completed";
    case "CLOSE_FAILED":
      return "failed";
    case "CLOSE_PENDING":
    default:
      return "pending";
  }
}
