# Brokering Routing Animation — Group-Run Simulation (FE) — Design Spec

**Date:** 2026-05-28
**Author:** toaditi
**Status:** Draft — pending user review

---

## Context

The group-run simulation already exposes a live per-order event stream via the poll-incremental
progress feed (`2026-05-27-live-progress-feed-design.md`): each ~2.5s poll appends new
`OrderEvent { seq, orderId, facilityId, finalReason, phase, phaseIndex }` items to
`sim.batchProgress[i].events`, rendered today as a plain `ion-list` in `SimulationProgress.vue`.

This spec adds a second, opt-in **animation** view of that same stream: a console-style ASCII
"stage" where a little character "thinks" then routes each order to the facility it was assigned
to. Facilities appear as little ASCII storefronts; a new tile pops up the first time a facility is
assigned to in a batch and bumps its count on subsequent assignments. Orders with no facility
(QUEUED / NO_RULE_MATCH / null `facilityId`) land in a fixed unfilled bin.

The animation is purely cosmetic on top of existing data — it does not change polling, store
shape, or the run/result flow.

---

## Goals / Non-goals

**Goals**
- Per-batch, console-style ASCII animation of the live order stream: character poses (thinking /
  routing / sad) + storefront tiles + unfilled bin + scrolling text log under the stage.
- User can toggle each batch panel between today's plain `Live 📜` list and the new
  `Animation 🏪` view; both views render the same underlying data.
- Animation paces at ~400ms per order, draining a queue steadily even when polls deliver bursts,
  and continues at that pace after the run completes until the queue empties.
- Respect `prefers-reduced-motion` (snap, no CSS keyframe motion).

**Non-goals**
- No persistence of the per-batch toggle across sessions; component-local state only.
- No fast-forward / queue cap at completion (user chose "keep steady pace").
- No cross-batch merging (each batch has its own stage, scoped stores/unfilled).
- No sound, no canvas, no new transport (polling, contract, store shape all unchanged).
- No change to the final results view, the run-state summary, or the per-variation badges.

---

## Key decisions (from brainstorming)

1. **Visual style** — ASCII stage (character + stores grid + unfilled bin) **plus** a scrolling
   monospace event log under the stage.
2. **Pacing** — Queue & drain steadily at ~400ms/order. No adaptive speed, no fast-forward, no cap.
3. **Placement** — Per-batch `ion-segment` toggle `Live 📜 | Animation 🏪` inside
   `SimulationProgress.vue`. Default selection: **Animation**. Toggle is component-local state.
4. **Multi-batch** — One animator + one stage per batch panel; stores/unfilled scoped per batch.
5. **Unfilled orders** — Dedicated unfilled bin tile on the stage. Character shows `sad` pose
   while a null-facility order is current; tile renders only once `unfilled > 0`.

---

## Architecture

Three new units, all additive. The existing live-progress wiring
(`SimulationService.pollJob` → `simulationStore.batchProgress` via `mergeEvents`) is unchanged.

### Pure helper — `src/util/animationQueue.ts` (new, unit-tested)

Pure TS, no Vue / no DOM. Mirrors the shape of `progressBuffer.ts`.

```ts
import type { OrderEvent } from "@/types/simulation";

export type Pose = "idle" | "routing" | "sad";

export interface AnimState {
  queue: OrderEvent[];              // FIFO, enqueued from batchProgress.events
  current: OrderEvent | null;       // the event being animated this tick
  pose: Pose;
  stores: Map<string, number>;      // facilityId → lifetime count for this batch
  unfilled: number;                 // lifetime null-facility count for this batch
  log: OrderEvent[];                // rolling last LOG_CAP, newest-first
  lastSeq: number;                  // dedup cursor against batchProgress.events
}

export const LOG_CAP = 20;

export function initAnimState(): AnimState;
export function enqueueNew(state: AnimState, events: OrderEvent[]): AnimState;
export function tick(state: AnimState): AnimState;
```

Semantics:
- `enqueueNew` filters `events` to those with `seq > state.lastSeq`, appends them in `seq` order,
  and advances `lastSeq` to the max appended `seq`. De-dup is the cursor's job; we trust input.
- `tick` dequeues the head into `current`; sets `pose = "routing"` if `current.facilityId` is a
  non-null string, else `"sad"`; bumps `stores.get(facilityId)` or `unfilled`; prepends `current`
  to `log` and caps `log` to `LOG_CAP`. If the queue is empty, sets `current = null` and
  `pose = "idle"`.
- The "thinking" beat at the start of an order is purely a CSS-keyframe sub-phase of the consuming
  component (0–40% of the tick, character glyph briefly shows the thinking face, then snaps to the
  pose set by the state machine). The state machine itself does not model a separate thinking step
  — one tick = one order.

### Composable — `src/composables/useBatchAnimator.ts` (new)

Wraps the pure helper with Vue reactivity. One instance per mounted `SimulationStage`.

```ts
export function useBatchAnimator(batchIndex: Ref<number> | number) {
  // 1. Maintain an internal ref<AnimState> initialised via initAnimState().
  // 2. watch(() => sim.batchProgress[i].events, (events) => enqueueNew(state, events ?? []),
  //    { deep: false }). Array reference changes each mergeEvents call.
  // 3. setInterval(() => state.value = tick(state.value), TICK_MS) while
  //    sim.isRunning || state.queue.length > 0 || state.current !== null. Otherwise clear.
  // 4. onUnmounted → clearInterval.
  // 5. Expose reactive refs derived from state: pose, currentOrder, stores, unfilled, log.
}

export const TICK_MS = 400;
```

Notes:
- `setInterval` is started/stopped by a `watchEffect` on the activity predicate above so we don't
  spin the timer when idle.
- The composable does **not** persist state across unmount — toggling away and back resets the
  stage. Acceptable: counters and bar above the stage remain authoritative.

### Component — `src/components/simulation/SimulationStage.vue` (new)

Props: `batchIndex: number`.

Renders three regions inside a single bordered monospace box:

1. **Stage** — a `<pre aria-hidden="true">` with:
   - Character ASCII chosen by `pose` (`idle`, `routing`, `sad`), with a CSS-driven "thinking"
     glyph swapped in for the first 0–40% of each tick (see state-machine note above). 3–4 line
     glyph per pose.
   - Thought bubble line: `... thinking order {currentOrder.orderId}` whenever `currentOrder` is
     non-null; empty line when idle.
   - Connector arrow that "draws" toward the destination tile during the routing phase. Animated
     via a CSS keyframe keyed off `currentOrder?.seq` so re-render on each tick restarts the
     animation.

2. **Tiles row** — a flex row of storefront tiles (one per entry in `stores`) plus, when
   `unfilled > 0`, a single unfilled bin tile on the right. Tile glyph:
   ```
   [🏪 STORE_42]
       ×3
   ```
   Each tile is its own component-internal block. First appearance triggers a `pop-in` CSS
   keyframe (scale 0.6 → 1.0, opacity 0 → 1, ~250ms). Count bump triggers a subtle `count-bump`
   keyframe on the count line only.

3. **Log** — `<ul aria-live="polite">` of the last `LOG_CAP` events, newest first:
   `> M431477 → STORE_42 ✓ FULLY_BROKERED` (✓ for brokered, ⊙ for queued, ✗ for unfilled/no-match).
   Color-coded with the existing `.ok / .muted / .warn` classes from `SimulationProgress.vue`.

Accessibility:
- Stage is `aria-hidden` (decorative).
- Log is the screen-reader source of truth via `aria-live="polite"`.
- `@media (prefers-reduced-motion: reduce)` disables keyframes (character pose still updates,
  arrow appears static at its end position, tiles appear without pop-in).

### Toggle — modifications to `src/components/simulation/SimulationProgress.vue`

Inside the existing per-batch panel, above the current event list:

```html
<ion-segment :value="viewMode[bp.batchIndex] ?? 'animation'"
             @ionChange="viewMode[bp.batchIndex] = String($event.detail.value)"
             class="stage-toggle">
  <ion-segment-button value="live"><ion-label>Live 📜</ion-label></ion-segment-button>
  <ion-segment-button value="animation"><ion-label>Animation 🏪</ion-label></ion-segment-button>
</ion-segment>
```

Below, swap based on selection:
- `viewMode === 'live'` → existing `<ion-list>` of events (unchanged).
- `viewMode === 'animation'` → `<SimulationStage :batchIndex="bp.batchIndex" />`.

The header (`phaseLabel · Round X/Y`), progress bar, and counters above remain unchanged in both
modes. `viewMode` is a local `reactive({})` keyed by `batchIndex` — not persisted.

---

## Data flow

```
poll (~2.5s)
  └─ SimulationService.pollJob.onProgress
       └─ simulationStore: batchProgress[i].events = mergeEvents(..., 50)
            └─ useBatchAnimator(i): watch → enqueueNew(state, events)

setInterval(TICK_MS) while running || queue non-empty:
  └─ state = tick(state)
       └─ SimulationStage renders { pose, currentOrder, stores, unfilled, log } reactively
            └─ CSS keyframes on currentOrder.seq drive think→route within the tick
```

---

## Error handling / edge cases

- **Tab/view switch** — the `Simulation.vue` segment uses `v-show`, so the progress component
  stays mounted while the user switches between editor and simulation tabs; the animator keeps
  ticking. Switching the per-batch toggle to `live` unmounts the stage and clears its interval;
  switching back creates a fresh animator (counters above remain authoritative).
- **Phase rollover** — `bp.brokered` / `bp.queued` reset per phase per the backend contract; the
  stage's store counts are lifetime within the batch and are unaffected. Header still shows the
  current `phaseLabel · Round X/Y` from `batchProgress`.
- **Failed batch** — animator simply stops receiving new events; the queue drains to empty and the
  character settles to `idle`. The plain-list view continues to surface the error via the run-state
  summary; that pathway is unchanged.
- **`not_found`** — terminal with no `progress`; same outcome as failed for the animator.
- **Long backlog at completion** — by design, the animator keeps ticking at ~400ms/order until the
  queue is empty. Users who want the final numbers immediately have the bar + counters above (live)
  and can flip to `Live 📜` or to the Results view.
- **Reduced motion** — CSS keyframes disabled via `@media (prefers-reduced-motion: reduce)`; state
  transitions still apply (poses change, tiles still appear, log still updates).
- **No events yet** — pose `idle`, no tiles, empty log; stage box still renders the empty layout.

---

## Testing

- **`animationQueue.ts`** — `tests/animationQueue.test.ts` (pure, `tsx` + `node:assert`):
  - `enqueueNew` filters by `lastSeq` (no duplicates across calls), preserves seq order, advances
    `lastSeq` to the max appended seq.
  - `tick` on empty queue yields `current=null`, `pose='idle'`, unchanged stores/unfilled/log.
  - `tick` with non-null `facilityId` bumps the right store count and sets `pose='routing'`.
  - `tick` with null `facilityId` bumps `unfilled` and sets `pose='sad'`.
  - `log` caps at `LOG_CAP` (newest-first; oldest dropped on overflow).
- **Composable / component** — verified in-app against a live run (per the repo's UI-by-interaction
  convention) using the existing simulation screen: confirm pose transitions, tile pop-in on a
  first-seen facility, count bumps on repeats, unfilled bin appearing on the first null event, log
  scrolling, reduced-motion behavior, and toggle parity (both views agree on totals).

---

## Open questions / assumptions

1. **Default toggle value** — assumes `animation` by default (the point of the feature); if any
   user prefers `live` as default for performance or muscle-memory reasons we can flip the default
   without changing the design.
2. **Tile cap** — no explicit cap on store tiles. Real facility fan-out in a single batch is
   bounded (small dozens at most by current group sizes); revisit only if a run produces a wide
   row that overflows on narrow viewports.
3. **Character vocabulary** — exact ASCII glyphs for `idle / routing / sad` poses (plus the
   transient "thinking" face used by the CSS sub-phase) are left to implementation; we'll start
   from the mock `(o_o)` family and tweak in-app.
