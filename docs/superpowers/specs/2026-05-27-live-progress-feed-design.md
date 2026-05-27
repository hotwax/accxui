# Live Progress Feed — Group-Run Simulation (FE) — Design Spec

**Date:** 2026-05-27
**Author:** toaditi
**Status:** Draft — pending user review

---

## Context

Group-run brokering simulations run async (submit → poll) and today the PWA only shows a coarse
per-variation phase (pending/running/done) while a run is in flight, then the full result on
completion. The user wants to **watch individual orders as they're brokered** during the run.

True streaming isn't needed: the backend now exposes a **poll-based incremental progress** contract
on the existing status endpoint — each poll carries running tallies plus the per-order events since
a cursor. This spec covers the **PWA consumer** of that contract (the backend side is owned by the
backend team and defined by the FE brief reproduced in §2).

This builds on the shipped simulation screen (`2026-05-27-brokering-simulation-screen-design.md`)
and the verified async contract (`2026-05-27-async-group-brokering-simulation-*`).

---

## Goals / Non-goals

**Goals**
- While a run is in flight, show per-order events streaming in (orderId, finalReason, facility).
- Show live progress per round: progress bar (`ordersProcessed/ordersInScope`) + brokered/queued tallies.
- Handle multi-batch runs (>5 variations → multiple concurrent jobs) with one panel per batch.

**Non-goals**
- No per-order rule-attempt detail in the live feed (that remains in the final results).
- No full event scrollback (rolling window only).
- No change to the parallel-batch submission model (batches still run concurrently).
- No new transport (no SSE/WebSocket) — polling only.

---

## Key decisions (from brainstorming)

1. **Transport** — poll-incremental with a `sinceSeq` cursor (backend contract, §2). No SSE.
2. **Multi-batch** — **per-batch sections**: one live panel per job/batch, each with its own bar,
   counters, and event list.
3. **Event list** — **rolling window (~50)** of the most recent order events + running counters as
   the source of truth for totals.
4. **Cadence** — poll **~2.5s** while running (brief: 2–3s; events are cheap deltas). (Was 15s.)
5. **Summary kept** — the existing per-variation `runStates` summary stays alongside the new
   per-batch live panels.

---

## Backend contract (given — FE brief)

```
GET /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}?sinceSeq={n}
Authorization: Bearer <token>
```
Cursor: every order event has a 1-based `seq`. First poll `sinceSeq=0`; each response returns
`nextSeq` — pass it back to get only newer events (no overlap, no dupes). The `events` list and its
`seq` are **global/monotonic across the whole job** (across phase boundaries).

Response (`progress` present on `running`, `complete`, and `failed`; absent on `not_found`):
```jsonc
{
  "jobId": "…", "status": "running",            // running | complete | failed | not_found
  "progress": {
    "phase": "BASELINE",                         // or "VARIANT"
    "phaseLabel": "Baseline (live config)",
    "phaseIndex": 1, "phaseCount": 2,            // which round of how many (baseline + N variants)
    "ordersInScope": 120,                        // progress-bar denominator
    "ordersProcessed": 47,                       // numerator
    "brokered": 3, "queued": 44,                 // running tallies — RESET to 0 each phase
    "events": [                                  // only events with seq > sinceSeq
      { "seq": 47, "phase": "BASELINE", "phaseIndex": 1,
        "orderId": "M431477", "shipGroupSeqId": "00001", "orderItemSeqId": "00001",
        "facilityId": "STORE_42",                // first assigned facility, or null if unfilled
        "finalReason": "FULLY_BROKERED" }        // FULLY_BROKERED|PARTIALLY_BROKERED|QUEUED|NO_RULE_MATCH|…
    ],
    "nextSeq": 47
  }
}
```
Counters (`ordersProcessed`, `brokered`, `queued`) **reset each phase**; switch the panel's
"current round" when an event's `phaseIndex` changes. `progress` gives a final flush on
`complete`/`failed`; same ~5-min retention caveat — keep polling continuously through completion.

---

## Architecture

Three touch points, all additive to the existing run flow; the final-results path is unchanged.

### Service — `src/services/SimulationService.ts` (`pollJob`)

Extend the existing poll loop (which already runs per batch in `submit`):
- Maintain `sinceSeq` (start `0`); append `?sinceSeq=<n>` to the GET; advance to `progress.nextSeq`
  after each response.
- Add an `onProgress?: (progress: GroupRunProgress) => void` parameter, invoked with `resp.progress`
  on **every** poll that carries it (running and the terminal flush).
- Drop `POLL_INTERVAL_MS` to **2_500**. Keep `MAX_POLL_DURATION_MS = 90 min` and the
  `interpretJobStatus` terminal handling. `not_found` → terminal (no `progress`).
- On terminal `complete`/`failed`: invoke `onProgress` with the final flush (if present), then
  resolve with the result `{ groupRun?, variation? }` exactly as today.
- Keep `@common` imported dynamically inside the function (no top-level import — the pure
  `interpretJobStatus` test imports this module under `tsx`).

### Pure helper — `src/util/progressBuffer.ts` (new, unit-tested)

The cursor/rolling-window logic lives in a pure, testable helper:
- `mergeEvents(existing: OrderEvent[], incoming: OrderEvent[], cap = 50): OrderEvent[]` — append
  `incoming` (already deduped by the server cursor) to `existing`, keep newest, cap length at `cap`
  (keep the last `cap`). Newest-first ordering applied in the component.

### Store — `src/store/simulationStore.ts`

Add per-batch live state, reset on each `submit()`:
```typescript
batchProgress: [] as BatchProgress[]   // one entry per batch/job, index-aligned with batches
```
where
```typescript
interface BatchProgress {
  batchIndex: number;
  phaseLabel: string;
  phaseIndex: number;
  phaseCount: number;
  ordersInScope: number;
  ordersProcessed: number;
  brokered: number;
  queued: number;
  events: OrderEvent[];   // rolling, capped at 50 via mergeEvents
}
```
In `submit()`, initialise `batchProgress[i]` per batch and pass an `onProgress` to that batch's
`pollJob` that updates `batchProgress[i]` (scalars from `progress`; `events` via `mergeEvents`).
Existing `runStates` (per-variation pending/submitted/running/done/failed + no-op skips) is retained
as the summary.

### UI — `src/components/simulation/SimulationProgress.vue`

Render one panel per `batchProgress` entry (above or alongside the existing `runStates` summary):
- Header: `phaseLabel` + `Round {phaseIndex}/{phaseCount}`.
- `<ion-progress-bar :value="ordersProcessed / ordersInScope">` + `47/120` text.
- Counters: brokered / queued (per-phase).
- Rolling event list (newest first, ~50): `orderId · finalReason · facilityId || "unfilled"`,
  `finalReason` color-coded (brokered = success, queued = medium, unfilled/no-match = warning/danger).
Lives inside the existing "Simulation" view-toggle tab; editor↔simulation switching and the
results-on-complete behavior are unchanged.

---

## Data flow

```
submit()
  └─ per batch i (parallel):
       init batchProgress[i]
       pollJob(groupId, jobId, { onProgress })   // sinceSeq cursor inside pollJob
          every ~2.5s: resp.progress → onProgress → batchProgress[i] (scalars + mergeEvents)
          SimulationProgress renders panel i reactively
          terminal: final flush → result
  └─ all batches settle → mergeVariationResults → results view (unchanged)
```

---

## Error handling / edge cases

- **Final flush not dropped:** apply `onProgress` for the terminal response before resolving.
- **Failed batch:** its panel shows last partial progress + the failure; other batches continue
  (batch isolation already exists in `submit`).
- **`not_found`:** terminal, no `progress`; surface "result no longer available — re-run" (existing).
- **Phase rollover:** counters reset per phase per the contract — the panel reads them straight from
  `progress` each tick, so rollover is automatic; `phaseIndex/phaseLabel` update the header.
- **Cap growth:** `mergeEvents` caps `events` at 50 to bound DOM/memory on long runs.
- **Navigation:** unchanged limitation — leaving the Simulate screen abandons in-flight polling
  (the jobId-persistence/resume follow-up is still separate and out of scope here).

---

## Testing

- **`progressBuffer.ts`** (pure, `tsx` + `node:assert`): `mergeEvents` appends, caps at 50 (keeps the
  newest), preserves order; empty/short inputs.
- **`pollJob`**: cursor advances via `nextSeq`; `onProgress` called on running ticks and on the
  terminal flush; `not_found` path invokes no progress and resolves terminal. (Exercised with a fake
  `api`/timer where practical; the pure interpreter test must still pass.)
- **UI** (`SimulationProgress`): verified in-app against the live backend (or a mock emitting the §2
  shape) — panels update, bar advances, events stream, counters reset on phase change.

---

## Open questions / assumptions

1. **Field names** — `progress` fields per the FE brief (§2); confirm `facilityId` is null (not
   omitted) when unfilled, and that `finalReason` enum values match the result tree's.
2. **`sinceSeq` per job** — each batch/job has an independent monotonic `seq`; the FE keeps a cursor
   per batch (in `pollJob`'s loop scope), so no cross-batch collision.
3. **Cadence vs batches** — ~2.5s polling × N concurrent batches is more requests, but deltas are
   small; acceptable per the brief. Revisit only if many batches strain the client.
