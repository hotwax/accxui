# Brokering Routing Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cute, console-style ASCII animation view of the live brokering simulation feed. A character "thinks" then routes each order to its assigned facility; each facility appears as a storefront tile that pops up on first assignment and bumps a count on repeats; null-facility orders land in an unfilled bin.

**Architecture:** Three new units in `apps/order-routing/src/` — a pure state-machine helper (`util/animationQueue.ts`), a Vue composable that drives it on a 400ms tick (`composables/useBatchAnimator.ts`), and a per-batch component (`components/simulation/SimulationStage.vue`). `SimulationProgress.vue` gains a per-batch `ion-segment` toggle (`Live 📜 | Animation 🏪`, default `Animation`) that swaps the existing event list for the new stage. No changes to polling, store shape, or the run/result flow. Authoritative spec: `docs/superpowers/specs/2026-05-28-brokering-routing-animation-design.md`.

**Tech Stack:** Vue 3 + Composition API + `<script setup>`, Ionic 8 (`ion-segment`, `ion-segment-button`, `ion-list`), Pinia (`simulationStore`), TypeScript, plain CSS keyframes. Pure-helper tests run via `npx tsx tests/<name>.test.ts` using `node:assert` (no Jest in this app — see `apps/order-routing/CLAUDE.md`).

---

## File structure

- **Create:** `apps/order-routing/src/util/animationQueue.ts` — pure helper: `Pose`, `AnimState`, `initAnimState`, `enqueueNew`, `tick`, `LOG_CAP`, `TICK_MS`. No Vue imports, no DOM.
- **Create:** `apps/order-routing/tests/animationQueue.test.ts` — pure unit tests (`tsx` + `node:assert`), following the shape of `tests/progressBuffer.test.ts`.
- **Create:** `apps/order-routing/src/composables/useBatchAnimator.ts` — Vue composable that bridges `simulationStore.batchProgress[i].events` into the pure helper and runs the `setInterval` tick driver. Exposes computed refs.
- **Create:** `apps/order-routing/src/components/simulation/SimulationStage.vue` — per-batch ASCII stage component: character + thought line + connector + storefront tiles + unfilled bin + scrolling log.
- **Modify:** `apps/order-routing/src/components/simulation/SimulationProgress.vue` — add per-batch `ion-segment` toggle and conditional mount of `SimulationStage`.

---

## Task 1: Pure helper — types, `initAnimState`, `enqueueNew`

**Files:**
- Create: `apps/order-routing/src/util/animationQueue.ts`
- Test:   `apps/order-routing/tests/animationQueue.test.ts`

- [ ] **Step 1: Write the failing tests for `initAnimState` and `enqueueNew`**

Create `apps/order-routing/tests/animationQueue.test.ts` with this exact content:

```ts
import assert from "assert";
import { initAnimState, enqueueNew, LOG_CAP } from "../src/util/animationQueue";
import { OrderEvent } from "../src/types/simulation";

const ev = (seq: number, facilityId: string | null = "STORE_42"): OrderEvent => ({
  seq,
  orderId: `O${seq}`,
  facilityId,
  finalReason: facilityId ? "FULLY_BROKERED" : "NO_RULE_MATCH",
});

// initAnimState: clean slate
{
  const s = initAnimState();
  assert.deepStrictEqual(s.queue, []);
  assert.strictEqual(s.current, null);
  assert.strictEqual(s.pose, "idle");
  assert.strictEqual(s.stores.size, 0);
  assert.strictEqual(s.unfilled, 0);
  assert.deepStrictEqual(s.log, []);
  assert.strictEqual(s.lastSeq, 0);
}

// enqueueNew: appends in order and advances lastSeq
{
  const s0 = initAnimState();
  const s1 = enqueueNew(s0, [ev(1), ev(2), ev(3)]);
  assert.deepStrictEqual(s1.queue.map((e) => e.seq), [1, 2, 3], "appends in seq order");
  assert.strictEqual(s1.lastSeq, 3, "lastSeq = max seq appended");
}

// enqueueNew: filters by lastSeq — no duplicates across calls
{
  const s0 = initAnimState();
  const s1 = enqueueNew(s0, [ev(1), ev(2)]);
  const s2 = enqueueNew(s1, [ev(2), ev(3)]); // server cursor would have prevented this, but defend anyway
  assert.deepStrictEqual(s2.queue.map((e) => e.seq), [1, 2, 3], "no duplicate seq=2");
  assert.strictEqual(s2.lastSeq, 3);
}

// enqueueNew: empty input is a no-op
{
  const s0 = enqueueNew(initAnimState(), [ev(1)]);
  const s1 = enqueueNew(s0, []);
  assert.strictEqual(s1, s0, "empty input returns the same state ref (no-op)");
}

// enqueueNew: out-of-order incoming gets sorted by seq
{
  const s = enqueueNew(initAnimState(), [ev(3), ev(1), ev(2)]);
  assert.deepStrictEqual(s.queue.map((e) => e.seq), [1, 2, 3], "sorted by seq");
  assert.strictEqual(s.lastSeq, 3);
}

// LOG_CAP is exported and is a positive integer
assert.ok(Number.isInteger(LOG_CAP) && LOG_CAP > 0, "LOG_CAP exported");

console.log("animationQueue init/enqueue tests passed");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from `apps/order-routing`:
```bash
npx tsx tests/animationQueue.test.ts
```
Expected: failure — module `../src/util/animationQueue` cannot be resolved (file does not exist yet).

- [ ] **Step 3: Implement `animationQueue.ts` with the helper surface**

Create `apps/order-routing/src/util/animationQueue.ts`:

```ts
// src/util/animationQueue.ts
// Pure state-machine helper for the per-batch routing animation. No Vue / no DOM imports
// so this module is safe to import from tests run with `npx tsx`. Mirrors the shape of
// progressBuffer.ts (a pure peer in the same simulation pipeline).
import type { OrderEvent } from "../types/simulation";

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

/** How many recent events to keep in the on-stage scrolling log. */
export const LOG_CAP = 20;

/** Animator tick cadence in ms (one order per tick). */
export const TICK_MS = 400;

export function initAnimState(): AnimState {
  return {
    queue: [],
    current: null,
    pose: "idle",
    stores: new Map(),
    unfilled: 0,
    log: [],
    lastSeq: 0,
  };
}

/** Append fresh events (`seq > state.lastSeq`) to the queue in seq order. Returns a new state
 *  object so Vue ref-style reactivity triggers; returns the same ref for empty/no-op inputs. */
export function enqueueNew(state: AnimState, events: OrderEvent[]): AnimState {
  if (!events || events.length === 0) return state;
  const fresh = events.filter((e) => e.seq > state.lastSeq);
  if (fresh.length === 0) return state;
  fresh.sort((a, b) => a.seq - b.seq);
  return {
    ...state,
    queue: [...state.queue, ...fresh],
    lastSeq: fresh[fresh.length - 1].seq,
  };
}
```

(`tick` will be added in Task 2.)

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx tsx tests/animationQueue.test.ts
```
Expected: `animationQueue init/enqueue tests passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aditipatel/sandbox/accxui
git add apps/order-routing/src/util/animationQueue.ts apps/order-routing/tests/animationQueue.test.ts
git commit -m "feat(simulation): animationQueue helper — initAnimState + enqueueNew"
```

---

## Task 2: Pure helper — `tick`

**Files:**
- Modify: `apps/order-routing/src/util/animationQueue.ts` (append `tick` at end of file)
- Modify: `apps/order-routing/tests/animationQueue.test.ts` (append tick tests at end, before the final `console.log`)

- [ ] **Step 1: Write the failing `tick` tests**

Open `apps/order-routing/tests/animationQueue.test.ts`. Replace the final `console.log` line with the following block (which adds tick tests, then prints the success message):

```ts
import { tick } from "../src/util/animationQueue";

// tick on empty queue: idles, returns equal state when already idle
{
  const s = initAnimState();
  const t = tick(s);
  assert.strictEqual(t.current, null);
  assert.strictEqual(t.pose, "idle");
  assert.strictEqual(t.queue.length, 0);
}

// tick with brokered order: pose=routing, store count bumps, log gets newest-first entry
{
  let s = enqueueNew(initAnimState(), [ev(1, "STORE_42"), ev(2, "STORE_42"), ev(3, "WH_WEST")]);
  s = tick(s);
  assert.strictEqual(s.current?.seq, 1);
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.stores.get("STORE_42"), 1);
  assert.strictEqual(s.unfilled, 0);
  assert.deepStrictEqual(s.log.map((e) => e.seq), [1]);

  s = tick(s);
  assert.strictEqual(s.current?.seq, 2);
  assert.strictEqual(s.stores.get("STORE_42"), 2, "repeat facility bumps count");
  assert.deepStrictEqual(s.log.map((e) => e.seq), [2, 1], "log is newest-first");

  s = tick(s);
  assert.strictEqual(s.current?.seq, 3);
  assert.strictEqual(s.stores.get("WH_WEST"), 1, "new facility appears");
  assert.strictEqual(s.stores.size, 2);
}

// tick with null-facility order: pose=sad, unfilled bumps
{
  let s = enqueueNew(initAnimState(), [ev(1, null), ev(2, null)]);
  s = tick(s);
  assert.strictEqual(s.pose, "sad");
  assert.strictEqual(s.unfilled, 1);
  assert.strictEqual(s.stores.size, 0);
  s = tick(s);
  assert.strictEqual(s.unfilled, 2);
}

// tick after queue empties: pose returns to idle, current becomes null
{
  let s = enqueueNew(initAnimState(), [ev(1, "STORE_42")]);
  s = tick(s); // process the single event
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.current?.seq, 1);
  s = tick(s); // queue empty now
  assert.strictEqual(s.current, null);
  assert.strictEqual(s.pose, "idle");
  assert.strictEqual(s.stores.get("STORE_42"), 1, "stores persist across idle");
}

// log caps at LOG_CAP, keeping newest
{
  const seqs = Array.from({ length: LOG_CAP + 5 }, (_, i) => i + 1);
  let s = enqueueNew(initAnimState(), seqs.map((n) => ev(n, "STORE_42")));
  for (const _ of seqs) s = tick(s);
  assert.strictEqual(s.log.length, LOG_CAP, "log capped at LOG_CAP");
  assert.strictEqual(s.log[0].seq, seqs[seqs.length - 1], "newest first");
  assert.strictEqual(s.log[s.log.length - 1].seq, seqs[seqs.length - LOG_CAP], "oldest kept is LOG_CAP-back");
}

console.log("animationQueue tests passed");
```

(Note: the prior `console.log("animationQueue init/enqueue tests passed")` line is deleted as part of this edit; the new final line covers all tests.)

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd apps/order-routing
npx tsx tests/animationQueue.test.ts
```
Expected: failure — `tick` is not exported from `../src/util/animationQueue`.

- [ ] **Step 3: Implement `tick` in `animationQueue.ts`**

Append the following function to `apps/order-routing/src/util/animationQueue.ts`:

```ts
/** Dequeue one order and update derived state. Returns a new state object so Vue refs detect
 *  the change. On empty queue, settles to idle (returns the same ref if already idle to avoid
 *  spurious reactive cycles). */
export function tick(state: AnimState): AnimState {
  if (state.queue.length === 0) {
    if (state.current === null && state.pose === "idle") return state;
    return { ...state, current: null, pose: "idle" };
  }
  const [head, ...rest] = state.queue;
  const stores = new Map(state.stores);
  let unfilled = state.unfilled;
  let pose: Pose;
  if (head.facilityId) {
    stores.set(head.facilityId, (stores.get(head.facilityId) ?? 0) + 1);
    pose = "routing";
  } else {
    unfilled += 1;
    pose = "sad";
  }
  const log = [head, ...state.log].slice(0, LOG_CAP);
  return { ...state, queue: rest, current: head, pose, stores, unfilled, log };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx tsx tests/animationQueue.test.ts
```
Expected: `animationQueue tests passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/aditipatel/sandbox/accxui
git add apps/order-routing/src/util/animationQueue.ts apps/order-routing/tests/animationQueue.test.ts
git commit -m "feat(simulation): animationQueue.tick — routing/sad/idle transitions + log cap"
```

---

## Task 3: Composable — `useBatchAnimator`

**Files:**
- Create: `apps/order-routing/src/composables/useBatchAnimator.ts`

This composable wraps the pure helper with Vue reactivity: watches a batch's `events` array and feeds new ones in; runs a 400ms tick interval while the run is active or the queue is non-empty; clears on unmount. Exposes computed refs for the template. There is no automated test for this layer — verification is in-app once the component is wired up (Tasks 4–5), per the repo's UI-by-interaction convention noted in `apps/order-routing/CLAUDE.md`.

- [ ] **Step 1: Create the composable file with full content**

Create `apps/order-routing/src/composables/useBatchAnimator.ts`:

```ts
// src/composables/useBatchAnimator.ts
// Bridges simulationStore.batchProgress[i].events into the animationQueue state machine
// and drives a ~400ms tick loop. One instance per mounted SimulationStage.
import { computed, onUnmounted, ref, watch, watchEffect } from "vue";
import { simulationStore } from "@/store/simulationStore";
import { initAnimState, enqueueNew, tick, TICK_MS } from "@/util/animationQueue";

export function useBatchAnimator(batchIndex: number) {
  const sim = simulationStore();
  const state = ref(initAnimState());

  // Pull any events present at mount, then any future updates. The events array reference
  // changes on each mergeEvents call in the store, so a shallow watch is sufficient.
  watch(
    () => sim.batchProgress[batchIndex]?.events ?? [],
    (events) => { state.value = enqueueNew(state.value, events); },
    { immediate: true }
  );

  // Run the tick driver while the batch is doing something (running or backlog to drain).
  // Stops cleanly once the run is over AND the queue has been drained to idle.
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const shouldTick = computed(
    () => sim.isRunning || state.value.queue.length > 0 || state.value.current !== null
  );

  watchEffect(() => {
    if (shouldTick.value && intervalId === null) {
      intervalId = setInterval(() => { state.value = tick(state.value); }, TICK_MS);
    } else if (!shouldTick.value && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });

  onUnmounted(() => { if (intervalId !== null) clearInterval(intervalId); });

  return {
    pose: computed(() => state.value.pose),
    currentOrder: computed(() => state.value.current),
    stores: computed(() => state.value.stores),
    unfilled: computed(() => state.value.unfilled),
    log: computed(() => state.value.log),
  };
}
```

- [ ] **Step 2: Type-check the new file**

From `apps/order-routing`:
```bash
npx tsc --noEmit -p .
```
Expected: no errors related to `useBatchAnimator.ts`. (Pre-existing project errors, if any, are out of scope; if you see an error pointing at this file specifically, fix it before continuing.)

- [ ] **Step 3: Commit**

```bash
cd /Users/aditipatel/sandbox/accxui
git add apps/order-routing/src/composables/useBatchAnimator.ts
git commit -m "feat(simulation): useBatchAnimator composable — events → 400ms tick driver"
```

---

## Task 4: Component — `SimulationStage.vue`

**Files:**
- Create: `apps/order-routing/src/components/simulation/SimulationStage.vue`

This is the visible animation: a bordered monospace "stage" with a character (pose-driven), a thought line referencing `currentOrder.orderId`, a connector arrow that animates per-tick, a row of storefront tiles plus an unfilled bin tile, and a scrolling log underneath. Verification is interactive: run the dev server, kick off a group simulation, and confirm the stage updates as events stream in.

- [ ] **Step 1: Create `SimulationStage.vue` with template, script, and styles**

Create `apps/order-routing/src/components/simulation/SimulationStage.vue`:

```vue
<template>
  <div class="stage-wrapper">
    <!-- ASCII stage: bordered monospace box. aria-hidden because the log below is the SR source. -->
    <div class="stage" aria-hidden="true">
      <pre class="character" :data-pose="pose" :key="currentOrder?.seq ?? 'idle'">{{ glyphFor(pose) }}</pre>
      <p class="thought">
        <span v-if="currentOrder">…thinking order <strong>{{ currentOrder.orderId }}</strong></span>
        <span v-else class="dim">…waiting for orders</span>
      </p>
      <pre class="connector" :key="`c-${currentOrder?.seq ?? 'idle'}`">{{ connectorFor(currentOrder) }}</pre>

      <div class="tiles">
        <transition-group name="popin" tag="div" class="tiles-row">
          <div v-for="[fid, count] in storeEntries" :key="fid" class="tile">
            <div class="tile-name">[🏪 {{ fid }}]</div>
            <div class="tile-count" :key="`${fid}-${count}`">×{{ count }}</div>
          </div>
          <div v-if="unfilled > 0" key="__unfilled" class="tile tile-unfilled">
            <div class="tile-name">[📦 unfilled]</div>
            <div class="tile-count" :key="`unfilled-${unfilled}`">×{{ unfilled }}</div>
          </div>
        </transition-group>
      </div>
    </div>

    <!-- Log: SR-readable, newest first. -->
    <ul class="log" aria-live="polite">
      <li v-for="ev in log" :key="ev.seq" :class="logClassFor(ev)">
        &gt; {{ ev.orderId }} → {{ ev.facilityId ?? translate("unfilled") }}
        {{ glyphForReason(ev) }} {{ ev.finalReason }}
      </li>
      <li v-if="!log.length" class="dim">{{ translate("No orders yet.") }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";
import { useBatchAnimator } from "@/composables/useBatchAnimator";
import type { OrderEvent } from "@/types/simulation";
import type { Pose } from "@/util/animationQueue";

const props = defineProps<{ batchIndex: number }>();

const { pose, currentOrder, stores, unfilled, log } = useBatchAnimator(props.batchIndex);

// Map → sorted entries for stable rendering order (insertion order — Map preserves it).
const storeEntries = computed(() => Array.from(stores.value.entries()));

const IDLE_GLYPH = "  (•_•)  \n <(   )> \n  /   \\  ";
const ROUTING_GLYPH = "  (o_o)  \n <( ▸ )> \n  /   \\  ";
const SAD_GLYPH = "  (˘_˘)  \n <(   )> \n  /   \\  ";

function glyphFor(p: Pose): string {
  if (p === "routing") return ROUTING_GLYPH;
  if (p === "sad") return SAD_GLYPH;
  return IDLE_GLYPH;
}

function connectorFor(ev: OrderEvent | null): string {
  if (!ev) return "";
  if (ev.facilityId) return `   │\n   └──▶ [🏪 ${ev.facilityId}]`;
  return "   │\n   └──▶ [📦 unfilled]";
}

function logClassFor(ev: OrderEvent): string {
  if (ev.facilityId && (ev.finalReason === "FULLY_BROKERED" || ev.finalReason === "PARTIALLY_BROKERED")) return "ok";
  if (ev.finalReason === "QUEUED") return "muted";
  return "warn";
}

function glyphForReason(ev: OrderEvent): string {
  if (ev.facilityId && (ev.finalReason === "FULLY_BROKERED" || ev.finalReason === "PARTIALLY_BROKERED")) return "✓";
  if (ev.finalReason === "QUEUED") return "⊙";
  return "✗";
}
</script>

<style scoped>
.stage-wrapper { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.stage {
  border: 1px solid var(--ion-color-medium-shade);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--ion-color-light);
  margin-bottom: 8px;
}
.character {
  margin: 0;
  font-family: inherit;
  white-space: pre;
  line-height: 1.1;
}
/* "Thinking" CSS sub-phase: at the start of each tick (new :key), briefly hint thinking
   by fading-in from a slightly raised position. The pose glyph then settles for the rest
   of the tick. Real per-pose glyphs above already render the steady-state expression. */
.character {
  animation: think-then-pose 400ms ease-out;
}
@keyframes think-then-pose {
  0%   { opacity: 0.4; transform: translateY(-2px); }
  40%  { opacity: 1;   transform: translateY(0); }
  100% { opacity: 1;   transform: translateY(0); }
}
.thought { margin: 4px 0 6px; font-family: inherit; }
.thought .dim { color: var(--ion-color-medium); }
.connector {
  margin: 0 0 10px;
  font-family: inherit;
  white-space: pre;
  line-height: 1.1;
  min-height: 2.2em;
  animation: connector-draw 400ms ease-out;
}
@keyframes connector-draw {
  0%   { clip-path: inset(0 100% 0 0); }
  40%  { clip-path: inset(0 100% 0 0); }
  100% { clip-path: inset(0 0 0 0); }
}
.tiles-row { display: flex; gap: 10px; flex-wrap: wrap; }
.tile {
  border: 1px solid var(--ion-color-medium-tint);
  border-radius: 4px;
  padding: 6px 8px;
  background: var(--ion-background-color);
  min-width: 110px;
  text-align: center;
}
.tile-unfilled { border-color: var(--ion-color-warning); }
.tile-name { font-family: inherit; }
.tile-count { font-family: inherit; color: var(--ion-color-medium); animation: count-bump 250ms ease-out; }
@keyframes count-bump {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.25); }
  100% { transform: scale(1); }
}
.popin-enter-active { animation: pop-in 250ms ease-out; }
@keyframes pop-in {
  0%   { opacity: 0; transform: scale(0.6); }
  100% { opacity: 1; transform: scale(1); }
}
.log {
  margin: 0;
  padding: 6px 8px;
  list-style: none;
  font-family: inherit;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--ion-color-light-shade);
  border-radius: 4px;
}
.log li { padding: 2px 0; }
.dim  { color: var(--ion-color-medium); }
.ok   { color: var(--ion-color-success); }
.muted { color: var(--ion-color-medium); }
.warn { color: var(--ion-color-warning-shade); }
@media (prefers-reduced-motion: reduce) {
  .character, .connector, .tile-count, .popin-enter-active { animation: none !important; }
}
</style>
```

- [ ] **Step 2: Type-check the component**

```bash
cd apps/order-routing
npx tsc --noEmit -p .
```
Expected: no new errors related to `SimulationStage.vue`.

- [ ] **Step 3: Commit**

```bash
cd /Users/aditipatel/sandbox/accxui
git add apps/order-routing/src/components/simulation/SimulationStage.vue
git commit -m "feat(simulation): SimulationStage component — ASCII character + storefront tiles + log"
```

---

## Task 5: Wire the toggle into `SimulationProgress.vue`

**Files:**
- Modify: `apps/order-routing/src/components/simulation/SimulationProgress.vue`

Add an `ion-segment` toggle inside each batch panel (`Live 📜 | Animation 🏪`, default `Animation`). When `animation` is selected, render `<SimulationStage :batchIndex="bp.batchIndex" />` in place of the existing `ion-list` of events; the header (`phaseLabel · Round X/Y`), progress bar, and counters stay in both modes. Selection lives in component-local state keyed by `batchIndex` — not persisted, per the spec.

- [ ] **Step 1: Edit `SimulationProgress.vue` — template**

Open `apps/order-routing/src/components/simulation/SimulationProgress.vue`. Replace the entire `v-if="bp.events.length"` `<ion-list>` block (currently lines ~14–21) — the per-batch event list — with the toggle + conditional stage/list block below. The progress bar, counters, header, and the per-variation summary list at the bottom are untouched.

Inside the existing `<div v-for="bp in sim.batchProgress" ...>` panel, **after** the `<p class="counts">` line, replace:

```vue
      <ion-list v-if="bp.events.length">
        <ion-item v-for="ev in reversed(bp.events)" :key="ev.seq" lines="none">
          <ion-label class="ion-text-wrap">
            {{ ev.orderId }} · <span :class="reasonClass(ev.finalReason)">{{ ev.finalReason }}</span>
            · {{ ev.facilityId || translate("unfilled") }}
          </ion-label>
        </ion-item>
      </ion-list>
```

with:

```vue
      <ion-segment
        :value="viewMode[bp.batchIndex] ?? 'animation'"
        @ionChange="(e) => viewMode[bp.batchIndex] = String(e.detail.value)"
        class="stage-toggle"
      >
        <ion-segment-button value="live">
          <ion-label>{{ translate("Live") }} 📜</ion-label>
        </ion-segment-button>
        <ion-segment-button value="animation">
          <ion-label>{{ translate("Animation") }} 🏪</ion-label>
        </ion-segment-button>
      </ion-segment>

      <simulation-stage
        v-if="(viewMode[bp.batchIndex] ?? 'animation') === 'animation'"
        :batch-index="bp.batchIndex"
      />
      <ion-list v-else-if="bp.events.length">
        <ion-item v-for="ev in reversed(bp.events)" :key="ev.seq" lines="none">
          <ion-label class="ion-text-wrap">
            {{ ev.orderId }} · <span :class="reasonClass(ev.finalReason)">{{ ev.finalReason }}</span>
            · {{ ev.facilityId || translate("unfilled") }}
          </ion-label>
        </ion-item>
      </ion-list>
```

- [ ] **Step 2: Edit `SimulationProgress.vue` — script + imports**

In the `<script setup lang="ts">` block, add the segment imports and the local view-mode map. Replace the existing import line:

```ts
import { IonBadge, IonItem, IonLabel, IonList, IonListHeader, IonProgressBar, IonSpinner } from "@ionic/vue";
```

with:

```ts
import { IonBadge, IonItem, IonLabel, IonList, IonListHeader, IonProgressBar, IonSegment, IonSegmentButton, IonSpinner } from "@ionic/vue";
import { reactive } from "vue";
import SimulationStage from "./SimulationStage.vue";
```

Then, immediately after the existing line `const sim = simulationStore();`, add:

```ts
// Per-batch toggle between the plain live list and the animation stage. Component-local
// (not persisted): default is "animation" — the point of the feature.
const viewMode = reactive<Record<number, "live" | "animation">>({});
```

- [ ] **Step 3: Edit `SimulationProgress.vue` — styles**

Append to the existing `<style scoped>` block (right before `</style>`):

```css
.stage-toggle { max-width: 280px; margin: 6px 0 8px; }
```

- [ ] **Step 4: Type-check**

```bash
cd apps/order-routing
npx tsc --noEmit -p .
```
Expected: no new errors related to `SimulationProgress.vue`.

- [ ] **Step 5: Lint**

```bash
cd /Users/aditipatel/sandbox/accxui
pnpm lint
```
Expected: no new errors in the changed files.

- [ ] **Step 6: Manual / in-app verification**

Start the dev server and run a simulation to confirm everything wires together. From `apps/order-routing`:

```bash
ionic serve
```

In the running app:
1. Navigate to a routing group's **Simulate** screen, add at least one variation, and submit.
2. Switch to the **Simulation** tab. With the default toggle (`Animation 🏪`):
   - Confirm the character appears and animates per order (~400ms cadence).
   - Confirm a storefront tile pops in the first time each facility is assigned to; count bumps on repeats.
   - Confirm the `[📦 unfilled]` tile appears the first time a null-facility event arrives, and bumps on repeats.
   - Confirm the log under the stage scrolls (newest first, capped ~20 entries).
3. Flip the toggle to `Live 📜` — the plain event list should appear in place of the stage, with the same data.
4. Wait for the run to complete: counters + bar continue to reflect real-time data; the animation queue drains at steady pace and the character settles to the idle glyph when done.
5. (Reduced-motion check) Toggle macOS *Reduce Motion* on, refresh the run: pose still updates and tiles still appear, but the keyframe motion is gone.

- [ ] **Step 7: Commit**

```bash
cd /Users/aditipatel/sandbox/accxui
git add apps/order-routing/src/components/simulation/SimulationProgress.vue
git commit -m "feat(simulation): per-batch Live/Animation toggle in SimulationProgress"
```

---

## Wrap-up

After Task 5, the feature is complete:
- `npx tsx tests/animationQueue.test.ts` → `animationQueue tests passed`
- `npx tsc --noEmit -p .` and `pnpm lint` clean for the changed files
- In-app: the Simulation tab shows a per-batch animation by default, with a working toggle back to the plain list

Suggested final cleanup: run a full simulation against a non-trivial group (with at least one variation that produces unfilled orders) and capture a quick screencast or note in the PR description to show the animation behavior end-to-end. There is no DB migration, no env change, and no API contract change.
