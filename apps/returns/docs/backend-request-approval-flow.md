# Backend request: return approval flow (approve / reject / cancel) gating Shopify sync

## Summary
Requested returns must go through an **approval step** before they sync to Shopify. Today the backend
auto-pushes a return to Shopify on creation; we need that push to fire **on approval instead**. Please
add three transitions — **approve**, **reject**, **cancel** — and stop auto-pushing on create.

This adds two new status ids (`RETURN_APPROVED`, `RETURN_REJECTED`) and three endpoints. Existing
fields/endpoints are otherwise unchanged.

## Desired lifecycle
```
                 ┌──────────────► RETURN_REJECTED   (terminal; never synced to Shopify)
                 │   reject
RETURN_REQUESTED ─┤
   (on create,   │   approve
    NOT synced)  └──────────────► RETURN_APPROVED ──(auto OMS→Shopify push)──► sync: pending → synced
                                       │
                                       │ cancel
                                       ▼
                                  RETURN_CANCELLED   (terminal)

cancel is also allowed from RETURN_REQUESTED.
```

- **On create** (`POST /oms/returns/customerReturn`): the return is `RETURN_REQUESTED` and is **NOT**
  pushed to Shopify. `sync.shopify` = `not_synced`. (This is the behavior change — remove the
  auto-push-on-create.)
- **Approve**: `RETURN_REQUESTED` → `RETURN_APPROVED`, **and** trigger the OMS→Shopify push (the same
  push logic that previously ran on create). The return's `sync.shopify` then progresses
  `not_synced → pending → synced` (or `failed`) as it does today.
- **Reject**: `RETURN_REQUESTED` → `RETURN_REJECTED`. Terminal. Never pushed to Shopify.
- **Cancel**: `RETURN_REQUESTED` or `RETURN_APPROVED` → `RETURN_CANCELLED`. Terminal.

## Endpoints (new)
All operate on an existing return and should return the updated return (or at minimum `200` with the
new `statusId`; the PWA re-fetches `GET /oms/returns/{id}` after each).

| Method & path | Effect |
|---|---|
| `POST /oms/returns/{returnId}/approve` | Set status `RETURN_APPROVED`; trigger the OMS→Shopify push. |
| `POST /oms/returns/{returnId}/reject`  | Set status `RETURN_REJECTED`. No Shopify push. |
| `POST /oms/returns/{returnId}/cancel`  | Set status `RETURN_CANCELLED`. No Shopify push (and ideally a no-op/undo if already pushed — see edge cases). |

Each should append a `statusHistory` entry (so `GET /oms/returns/{id}` → `statusHistory[]` reflects the
transition with its timestamp), consistent with how status changes are already recorded.

## Status ids
| statusId | Meaning | New? |
|---|---|---|
| `RETURN_REQUESTED` | Created, awaiting approval | existing |
| `RETURN_APPROVED` | Approved; pushed/pushing to Shopify | **NEW** |
| `RETURN_REJECTED` | Denied; terminal | **NEW** |
| `RETURN_CANCELLED` | Cancelled; terminal | existing |
| `RETURN_RECEIVED` / `RETURN_COMPLETED` | downstream | existing |

Please confirm the exact `statusId` strings you create for approved/rejected (the PWA maps these to
"Approved"/"Rejected" labels — tell us if you use different ids).

## Edge cases / guards
- **Approve/reject only from `RETURN_REQUESTED`.** If called on a return in another status, return a
  clear `4xx` (the PWA only shows these actions for requested returns, but please guard server-side).
- **Cancel** from `RETURN_REQUESTED` or `RETURN_APPROVED` only. If a return was already pushed to
  Shopify when cancelled, do whatever the OMS policy is (cancel the Shopify return if possible, else
  just mark cancelled) — tell us the resulting `sync.shopify` value so we display it correctly.
- **Idempotency:** a repeated approve/reject/cancel on an already-transitioned return should not double
  push; return the current state or a `409`.

## Acceptance criteria
1. `POST /oms/returns/{id}/approve` sets `RETURN_APPROVED` and the return then syncs to Shopify
   (`sync.shopify` reaches `synced`, `externalIds.shopify`/Shopify return id populated).
2. `POST /oms/returns/{id}/reject` sets `RETURN_REJECTED` and the return is never pushed to Shopify.
3. `POST /oms/returns/{id}/cancel` sets `RETURN_CANCELLED`.
4. `POST /oms/returns/customerReturn` (create) leaves the return `RETURN_REQUESTED` with
   `sync.shopify = not_synced` — **no** push on create.
5. `GET /oms/returns/{id}` and the list reflect the new `statusId` and updated `statusHistory`.
6. Invalid transitions return a clear `4xx`.
7. Reply with the exact `statusId` strings used for approved/rejected.

> UPDATE 2026-06-01: the `ClassCastException` is FIXED — list and detail now return 200, and
> approve/reject/cancel transitions work (status changes correctly). One open bug remains, below.

## OPEN BUG: approve sets RETURN_APPROVED but the Shopify push stays stuck in PUSH_PENDING

Observed on a real return (`M100053`, order `782`, which **is** a Shopify order — `orderExternalId`
`4685330546732`):
- Approve worked: `statusHistory` shows `RETURN_REQUESTED → RETURN_APPROVED`.
- But `shopifySync` never resolves:
  ```json
  { "synced": false, "shopifyReturnId": null, "pushStatusId": "PUSH_PENDING",
    "pushErrorMessage": null, "lastAttemptDate": 1780069659724 }
  ```
- `lastAttemptDate` (1780069659724) ≈ the return's **creation** time (~2.6 days ago), NOT the approve
  time — so **approve did not trigger a fresh push**; the push has been `PUSH_PENDING` since create.
- `POST /oms/returns/M100053/pushToShopify` returns **`{"status":"skipped"}`** (a no-op) and does not
  advance `lastAttemptDate` — re-push is declined, presumably because a `PUSH_PENDING` already exists.

**Net effect:** the return is wedged — it can never sync, because the original push never resolves to
`PUSH_OK`/`PUSH_FAILED` and a manual re-push is skipped due to the stale pending state.

**Asks:**
1. Approve must (re)trigger the OMS→Shopify push and advance `lastAttemptDate`.
2. The push worker must resolve `PUSH_PENDING` → `PUSH_OK` (set `synced:true` + `shopifyReturnId`) or
   `PUSH_FAILED` (set `pushErrorMessage`); it must not hang in `PUSH_PENDING` indefinitely.
3. `pushToShopify` should be able to recover a stale/stuck `PUSH_PENDING` (re-enqueue) rather than
   silently returning `skipped`; if it does skip, the response should say *why* (e.g.
   `{ status: "skipped", reason: "already_pending" }`) so the UI can explain it.

## Frontend status
- Transitions (approve/reject/cancel) + the `shopifySync` object mapping are wired and live.
- Approve auto-polls `shopifySync` to completion; the detail page now offers a manual
  **Push to Shopify** when a return is approved-but-unsynced (covers a stuck `PUSH_PENDING`, not just
  `PUSH_FAILED`), and surfaces a "didn't complete / may be pending" message when a push is skipped.
- Nothing more needed from the PWA for the wedged-return case — it's resolved once the push worker /
  re-push behavior above is fixed.
