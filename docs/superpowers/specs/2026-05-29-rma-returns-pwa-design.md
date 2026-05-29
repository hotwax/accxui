# RMA Returns PWA — Design

**Date:** 2026-05-29
**Status:** Approved for planning
**Author:** brainstormed with Claude

## 1. Overview

### 1.1 Objective
Build a small Ionic/Vue PWA — a new micro-frontend at `apps/returns/` in the `accxui`
monorepo — that demonstrates a happy-path customer return (RMA) that round-trips between
HotWax OMS (Moqui) and Shopify. The app follows existing HotWax PWA guidelines and consumes
the shared `@common` library exactly as other apps (e.g. `order-routing`) do.

### 1.2 Goals
- Demo a **2-way return sync** between Shopify and OMS (happy path only).
- Produce a **clear, concise REST contract** the front end codes against (an explicit deliverable).
- **Prove integration ability** for Shopify sync, with the sync layer designed so an ERP target
  can be added later without rework.

### 1.3 Non-goals (explicitly out of scope)
- Production hardening: load/perf, accessibility audits, multi-tenant test matrices.
- Covering every return scenario — only the happy path must work.
- ERP sync (designed for, not built).
- Backend implementation of the OMS→Shopify push (tracked separately; see §3.4).

### 1.4 Success criteria
- An operator can create a return in the PWA, submit it to OMS, and watch its Shopify sync
  badge progress `pending → synced` (outbound leg).
- A Shopify-originated return appears in the PWA list, flagged as Shopify-origin (inbound leg).
- The PWA runs end-to-end against an in-memory stub before the real backend lands, and switches
  to the live OMS backend by changing one env flag.

## 2. Context & key constraints

`accxui` is a pnpm monorepo of HotWax micro-frontends: **Vue 3 + Ionic + Vite + Pinia + vue-i18n**,
PWA via Capacitor. Apps live under `apps/<name>` and consume `@common` (shared `remoteApi` Axios
wrapper with auth + OMS/Maarg base URLs, `useAuth`, `Login.vue`, `initialiseConfig`,
`createDxpI18n`, logging). Auth uses the standard `@common` login flow (instance URL → login →
token), gated by a global `authGuard` that redirects to `/login`.

### 2.1 Backend reality (from team audit, 2026-05-29)
- **Shopify → OMS (inbound): wired.** Webhook (`ORDERS_UPDATED` → EventBridge → SQS → `consume_ShopifyOrders_SQS`
  every ~1 min) plus a 5-min polling fallback. Returns ride inside the order payload and land via
  `RefundServices.create#ShopifyReturnInProgress` / `create#ShopifyReturnCompleted`, writing standard
  `ReturnHeader` + `ReturnItem` + `ReturnStatus` + `ReturnIdentification (SHOPIFY_RTN_ID)` rows.
  Cross-reference idempotency via `ShopifyReturnHistory`. Typical latency ~30–90s (webhook), up to ~6 min (fallback).
  *Caveat:* Shopify ServiceJobs ship `paused="Y"` and must be unpaused in the running deployment.
- **OMS → Shopify (outbound) for returns: does NOT exist.** No SECA, no job, no `returnCreate`
  GraphQL mutation, no endpoint. This is net-new backend work, handled in parallel by the team.
- **Create return:** only entity-level `POST /rest/s1/oms/returns` (header fields only — no nested items).
  A working scripted builder exists (`RefundServices.create#ShopifyReturnInProgress`) but assumes a
  Shopify payload. Recommended backend addition: a thin composite `create#CustomerReturn` service.
- **Get single return / return reasons:** no service-REST mounts; use Entity REST fallbacks
  (`GET /rest/e1/ReturnHeader/{id}?dependents=true`, `GET /rest/e1/ReturnReason`).
- **Order lookup:** `GET /rest/s1/oms/orders/{id}` works well but has no `returnableQty` — computed client-side.
- **Auth:** `POST /rest/s1/admin/login` → use the longer-lived `api_key` header (not the ~300s JWT).
  CORS `*`; use `api_key` header, not cookies.

### 2.2 Decision: PWA assumes the full 2-way contract works
The front end codes to the complete contract (including outbound push and sync-status reads).
The team makes the backend match in parallel. Until then, an in-memory stub adapter satisfies the
same contract so the PWA can be built and demoed.

## 3. Architecture (Approach A — contract-first, pluggable backend)

### 3.1 App skeleton
```
apps/returns/
├── src/
│   ├── main.ts                 # IonicVue, pinia, i18n, logger, initialiseConfig
│   ├── App.vue
│   ├── router/index.ts         # authGuard → @common Login.vue; Tabs shell
│   ├── views/
│   │   ├── Tabs.vue
│   │   ├── ReturnsList.vue      # screen 1
│   │   ├── CreateReturn.vue     # screen 2
│   │   ├── ReturnDetail.vue     # screen 3
│   │   └── Settings.vue
│   ├── services/ReturnsService.ts   # the typed REST contract (deliverable)
│   ├── adapters/
│   │   ├── omsAdapter.ts        # real → @common remoteApi (OMS/Entity REST)
│   │   └── stubAdapter.ts       # demo fallback, same interface
│   ├── store/
│   │   ├── userStore.ts         # postLogin/postLogout/oms/current (@common contract)
│   │   └── returnsStore.ts      # Pinia: list, current return, sync status
│   ├── types/returns.ts
│   ├── locales/
│   └── theme/
```

### 3.2 Key decisions
- **Adapter selection** via `VITE_RETURNS_BACKEND=oms|stub`, read in `ReturnsService`.
  Screens/store never know which adapter is active.
- **Auth/session** is 100% `@common`; `userStore` only implements the `initialiseConfig` contract
  (`oms`, `current`, `postLogin`, `postLogout`) like `order-routing`. Stored credential is `api_key`.
- **OMS owns sync.** The PWA reads sync status and may trigger an outbound push; it never calls Shopify directly.
- **`SyncTarget`** is an enum (`shopify` today) so ERP is additive later — no structural change.

### 3.3 The REST contract
```ts
// types/returns.ts
type SyncTarget   = "shopify"
type SyncState    = "not_synced" | "pending" | "synced" | "failed"
type ReturnOrigin = "pwa" | "shopify"

interface ReturnItemInput { orderItemSeqId: string; productId: string; returnQuantity: number; returnReasonId: string }
interface ReturnSummary   { returnId: string; orderId: string; statusId: string; entryDate: string;
                            origin: ReturnOrigin; sync: Record<SyncTarget, SyncState> }
interface ReturnDetail    extends ReturnSummary { items: ReturnItemDetail[]; statuses: ReturnStatus[];
                            externalIds: Record<SyncTarget, string | null> }
interface OrderForReturn  { orderId: string; items: ReturnableLine[]; billingEmail?: string }
interface ReturnableLine  { orderItemSeqId: string; productId: string; orderedQty: number;
                            alreadyReturnedQty: number; returnableQty: number; unitPrice: number }
interface ReturnReason    { returnReasonId: string; description: string }
```

```ts
// services/ReturnsService.ts — 7 methods, the entire contract
interface ReturnsService {
  listReturns(p: { pageIndex?: number; pageSize?: number; statusId?: string }): Promise<{ items: ReturnSummary[]; total: number }>
  getReturn(returnId: string): Promise<ReturnDetail>
  createReturn(input: { orderId: string; items: ReturnItemInput[] }): Promise<{ returnId: string }>
  getOrderForReturn(orderId: string): Promise<OrderForReturn>   // returnableQty computed here
  listReturnReasons(): Promise<ReturnReason[]>
  pushToTarget(returnId: string, target: SyncTarget): Promise<void>          // outbound trigger
  getSyncStatus(returnId: string): Promise<Record<SyncTarget, SyncState>>    // for polling
}
```

### 3.4 Adapter → endpoint mapping (`omsAdapter`)
| Method | OMS call | Notes |
|---|---|---|
| `listReturns` | `GET /rest/s1/oms/returns` | reads `X-Total-Count`; maps `ReturnIdentification` → `origin` |
| `getReturn` | `GET /rest/e1/ReturnHeader/{id}?dependents=true` | Entity REST until `/oms/returns/{id}` mount exists |
| `createReturn` | `POST /oms/returns` (composite `create#CustomerReturn` when ready; else header + per-item) | one method, swap internals |
| `getOrderForReturn` | `GET /rest/s1/oms/orders/{id}` | adapter computes `returnableQty` |
| `listReturnReasons` | `GET /rest/e1/ReturnReason` | swap to `/oms/returnReasons` mount when added |
| `pushToTarget` | *assumed* `POST /oms/returns/{id}/push` (future `push#ShopifyReturn`) | backend leg in progress |
| `getSyncStatus` | derive from `ReturnIdentification.SHOPIFY_RTN_ID` + status | `synced` once Shopify GID present |

`stubAdapter` implements the same 7 methods with in-memory fixtures, including a fake push that
flips `pending → synced` after a tick, so the full demo runs before the backend lands.

## 4. Screens & happy-path flow

**Screen 1 — `ReturnsList.vue`** (tab landing): `listReturns(...)`; each row shows return ID, order ID,
customer, date, status badge, and a sync badge (origin + Shopify sync state). Shopify-origin rows flagged
via `SHOPIFY_RTN_ID`. "Create return" → Screen 2. Pull-to-refresh + infinite scroll via `X-Total-Count`.

**Screen 2 — `CreateReturn.vue`** (stepped, single screen):
1. Order lookup → `getOrderForReturn(orderId)`; render ship-group line items.
2. Pick items + qty — stepper capped at `returnableQty` (computed: `orderedQty − Σ matching ReturnItem.returnQuantity`).
3. Reason — per-item or whole-return from `listReturnReasons()`.
4. Submit → `createReturn(...)`; on success route to Screen 3 with new `returnId`.

**Screen 3 — `ReturnDetail.vue`**: `getReturn(returnId)` → header + items + statuses + identification.
Sync panel shows per-target (Shopify) state, the Shopify return ID once synced, and a manual
"Push to Shopify" action. Polls until `synced` to visibly demo the round trip.

**Plus** `Settings.vue` (instance/user info, logout) and `Tabs.vue` shell, matching `order-routing`.

**Demo narrative:** create a return in the PWA → watch its Shopify sync badge go `pending → synced`
(outbound); separately, a Shopify-created return appears in the list flagged as Shopify-origin (inbound).

## 5. Sync-status model

Resolved from OMS data (the PWA never calls Shopify). One resolver feeds both the list badge and
the detail poller.

**State per return, per target (`shopify`):**
- `synced` — a `ReturnIdentification` with `returnIdentificationTypeId = SHOPIFY_RTN_ID` exists
  (Shopify return GID present). Ground truth for both directions.
- `pending` — exists in OMS, no Shopify GID yet, and origin is `pwa` (awaiting push) or a push was just triggered. Bounded by timeout → `failed`.
- `not_synced` — origin `pwa`, no push attempted yet (manual push available).
- `failed` — push returned/recorded an error, or `pending` exceeded the poll window.

**Origin:** `shopify` if a `SHOPIFY_RTN_ID` identification exists at creation (inbound); else `pwa`.

**Polling (Screen 3 only):** after create or push, poll `getSyncStatus(returnId)` every ~3s, capped
at ~90s (matches inbound SQS cadence), with a spinner on the sync badge. Stop on `synced`/`failed`.
No websockets. The list screen resolves state from row data it already fetched.

The PWA logic is identical regardless of which side the backend work lands — it only watches for the GID.

## 6. Error handling & edge cases
- **Auth / 401** — `@common` `remoteApi` bounces to `/login` via `authGuard`. Verify the persisted credential is `api_key`, not the ~300s JWT.
- **Order lookup miss** — inline "Order not found" on Screen 2, no navigation.
- **Nothing returnable** — all lines `returnableQty = 0` → disable submit with an explainer.
- **Qty over-pick** — stepper hard-capped; submit re-validates against a fresh `getOrderForReturn`.
- **Create failure** — surface OMS error; keep form populated for retry (idempotency is backend's concern via `ShopifyReturnHistory`).
- **Push failure / timeout** — sync badge → `failed` with a Retry action.
- **Partial composite create** (non-composite path) — a return with zero items is treated as failed and surfaced; composite service makes this atomic.
- **Empty / loading states** — standard Ionic skeletons.

## 7. Testing (minimal but real, scaled to a demo)
- **Unit (vitest):** `stubAdapter` (deterministic); `returnableQty` computation (partials, multiple
  `ReturnItem`s per `orderItemSeqId`, zero); sync-state resolver (each state from representative payloads).
- **Component:** `CreateReturn.vue` happy path against `stubAdapter` (lookup → pick → reason → submit → detail).
- **E2E (cypress, one spec):** the demo narrative end-to-end against the stub — create a return, watch
  badge `pending → synced`; list shows a Shopify-origin return. Doubles as the demo rehearsal script.
- **Out of scope:** exhaustive backend-contract tests, load/perf, a11y, multi-tenant matrices.

## 8. Dependencies & open items
- Backend (parallel, team-owned): composite `create#CustomerReturn`; outbound `push#ShopifyReturn`
  (Shopify `returnCreate` GraphQL mutation) + `POST /oms/returns/{id}/push`; optional read mounts
  `GET /oms/returns/{id}` and `GET /oms/returnReasons`; unpause Shopify ServiceJobs in the deployment.
- The PWA does not block on these — it ships against `stubAdapter` and flips to `oms` when ready.
- Confirm `@common` `remoteApi` persists `api_key` (not JWT) during implementation.
