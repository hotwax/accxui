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

> NOTE: this is blocked in practice by the existing returns-service `ClassCastException`
> (see `backend-request-list-bug-and-identifiers.md`) — list and real-return detail currently 400.
> That P0 bug must be fixed for any of this to be testable end-to-end.

## Frontend status (already wired — nothing else needed from us)
The PWA already implements the full approval UX against this contract:
- `ReturnsService.approveReturn / rejectReturn / cancelReturn` → these three endpoints.
- Approve auto-polls `sync.shopify` to completion; a Retry re-runs the push on `failed`.
- Return detail shows **Approve + Reject** for `RETURN_REQUESTED` and **Cancel** for
  `RETURN_APPROVED`; terminal statuses show no actions.
- It no longer assumes a push on create.

So the moment these endpoints exist (and the cast bug is fixed), the flow works with no frontend change.
