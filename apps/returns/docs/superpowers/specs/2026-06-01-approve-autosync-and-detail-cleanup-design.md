# Approve auto-syncs to Shopify + ReturnDetail cleanup

**Date:** 2026-06-01
**Scope:** `apps/returns` — return approval flow & detail view

## Goal
1. Pressing **Approve** should sync the return to Shopify in one action — no separate manual
   "Push to Shopify" step.
2. Clean up `ReturnDetail.vue`, which grew messy during the wedged-push debugging
   (a dual-purpose manual-push button + repeated inline danger styles + debug-era copy).

## Part 1 — Approve drives the push itself

**Today:** `returnsStore.approveReturn` approves, re-fetches, and polls *only if the backend already
set `sync.shopify === "pending"`*. It depends on the backend's auto-push-on-approve, which can wedge
in `PUSH_PENDING`. When the auto-push doesn't fire, the return stays `not_synced` and the user must
click a manual push button — the "additional step."

**Change:** after approve + re-fetch, if the sync is **neither `synced` nor `pending`** (the backend
didn't kick a push), the store explicitly triggers the push via `pushToTarget("shopify")`, then polls
to completion:

```
approve → fetch → (sync is not_synced | failed) ? pushToTarget("shopify") : (already pending) → pollSync until synced/failed
```

So approval always drives the sync from the client, regardless of backend reliability. The stub models
a working backend (approve → `pending`), so the explicit-push branch is a real-backend fallback and
existing tests pass unchanged.

## Part 2 — ReturnDetail.vue cleanup

Concentrated in the **Shopify-sync card**:

1. **Manual push button → Retry-on-failure only.** Remove the dual-purpose button (`canManualPush`
   computed, the `detail-push-btn` "stuck pending" path). Keep one **Retry** button shown only when
   `sync.shopify === 'failed'` (`detail-retry-btn`). Replace `push()` (and its "didn't complete / may
   be pending" toast, which existed for the stuck-pending path) with a plain `retryPush()` =
   `store.pushAndPoll(...)` wrapped in `runAction`.
2. **Consolidate inline styles.** Three sites use
   `style="color: var(--ion-color-danger); white-space: pre-wrap"` (error banner, push error, close
   error) → one scoped `.error` class.
3. **Copy.** "Syncs to Shopify once approved." → "Syncs to Shopify automatically when approved."
   Update `src/locales/en.json`: drop now-unused "Push to Shopify" key, add the new copy.

Untouched (already clean): Actions card, Completion card, store completion code, `types/returns.ts`,
`ReturnFiltersContent.vue`, `util/syncState.ts`, `stubAdapter.ts`.

## Tradeoff
A wedged `PUSH_PENDING` (not `failed`) loses its manual button. Part 1's explicit push minimizes the
window; the genuine fix is the backend push-worker bug already tracked in
`docs/backend-request-approval-flow.md`. Net: cleaner UI, approve self-drives the sync, failures stay
recoverable via Retry.

## Tests
- `tests/unit/returnsStoreCrud.spec.ts` approve tests pass unchanged (stub happy path).
- No view tests reference the removed `detail-push-btn` testid.
- Verify: `npm test` in `apps/returns` + typecheck.
