# Live Progress Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream per-order brokering events into the simulation screen while a run is in flight, consuming the backend's poll-incremental progress contract (`?sinceSeq=` cursor → `progress` with running tallies + per-order events), rendered as one live panel per batch.

**Architecture:** Additive to the shipped run flow. `pollJob` gains a `sinceSeq` cursor + `onProgress` callback and polls ~2.5s; a pure `mergeEvents` helper caps the rolling window; `simulationStore` holds `batchProgress[]` updated per poll; `SimulationProgress.vue` renders a panel per batch (progress bar + brokered/queued counters + last ~50 order events). The final-results path is unchanged.

**Tech Stack:** Vue 3 + Ionic 8, Pinia, `api`/`commonUtil` from `@common`, pure modules tested with `npx tsx` + `node:assert`.

**Work from:** `/Users/aditipatel/sandbox/accxui/apps/order-routing` for all tasks.

---

## Reference: backend progress contract (spec §2)

```
GET …/routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}?sinceSeq={n}
→ { jobId, status, progress?: {
      phase, phaseLabel, phaseIndex, phaseCount,
      ordersInScope, ordersProcessed, brokered, queued,
      events: [{ seq, phase, phaseIndex, orderId, shipGroupSeqId, orderItemSeqId, facilityId|null, finalReason }],
      nextSeq } }
```
`sinceSeq` starts 0; advance to `progress.nextSeq` each poll. `progress` present on `running`,
`complete`, `failed`; absent on `not_found`. Counters reset per phase. Events are deduped by the
server cursor.

## File structure

| File | Responsibility |
|---|---|
| `src/types/simulation.ts` (modify) | Add `OrderEvent`, `GroupRunProgress`, `BatchProgress`; extend `JobStatusResponse` with `progress?`. |
| `src/util/progressBuffer.ts` (create) | Pure `mergeEvents(existing, incoming, cap)` — append + cap rolling window. |
| `src/services/SimulationService.ts` (modify) | `pollJob` gains `sinceSeq` cursor + `onProgress`; interval → 2.5s. |
| `src/store/simulationStore.ts` (modify) | `batchProgress[]` state; populate via `onProgress` in `submit()`. |
| `src/components/simulation/SimulationProgress.vue` (modify) | Per-batch live panels above the existing `runStates` summary. |
| `tests/progressBuffer.test.ts` (create) | `mergeEvents` tests. |

---

## Task 1: Types + `mergeEvents` (pure, TDD)

**Files:**
- Modify: `src/types/simulation.ts`
- Create: `src/util/progressBuffer.ts`
- Test: `tests/progressBuffer.test.ts`

- [ ] **Step 1: Add types to `src/types/simulation.ts`**

Append:

```typescript
/** A single per-order event from the live progress feed. */
export interface OrderEvent {
  seq: number;
  phase?: string;
  phaseIndex?: number;
  orderId: string;
  shipGroupSeqId?: string;
  orderItemSeqId?: string;
  facilityId: string | null;   // null = unfilled
  finalReason: string;
}

/** The `progress` object returned on each poll while running (and on the terminal flush). */
export interface GroupRunProgress {
  phase: string;
  phaseLabel: string;
  phaseIndex: number;
  phaseCount: number;
  ordersInScope: number;
  ordersProcessed: number;
  brokered: number;
  queued: number;
  events: OrderEvent[];
  nextSeq: number;
}

/** Per-batch live state held in the store (index-aligned with the submit batches). */
export interface BatchProgress {
  batchIndex: number;
  phaseLabel: string;
  phaseIndex: number;
  phaseCount: number;
  ordersInScope: number;
  ordersProcessed: number;
  brokered: number;
  queued: number;
  events: OrderEvent[];   // rolling, capped at 50
}
```

Then extend the existing `JobStatusResponse` interface — add a `progress?` field:

```typescript
export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  groupRun?: any;
  variation?: any;
  error?: string;
  progress?: GroupRunProgress;   // present on running/complete/failed; absent on not_found
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/progressBuffer.test.ts
import assert from "assert";
import { mergeEvents } from "../src/util/progressBuffer";
import { OrderEvent } from "../src/types/simulation";

const ev = (seq: number): OrderEvent => ({ seq, orderId: `O${seq}`, facilityId: null, finalReason: "QUEUED" });

// appends incoming to existing
{
  const out = mergeEvents([ev(1), ev(2)], [ev(3)], 50);
  assert.deepStrictEqual(out.map((e) => e.seq), [1, 2, 3], "appends in order");
}

// caps at the most recent `cap` events (keeps newest)
{
  const existing = [ev(1), ev(2), ev(3)];
  const out = mergeEvents(existing, [ev(4), ev(5)], 3);
  assert.deepStrictEqual(out.map((e) => e.seq), [3, 4, 5], "keeps the last `cap`");
}

// empty inputs
{
  assert.deepStrictEqual(mergeEvents([], [], 50), [], "empty in → empty out");
  assert.deepStrictEqual(mergeEvents([ev(1)], [], 50).map((e) => e.seq), [1], "no incoming keeps existing");
}

console.log("progressBuffer tests passed");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx tests/progressBuffer.test.ts`
Expected: FAIL — `Cannot find module '../src/util/progressBuffer'`.

- [ ] **Step 4: Implement**

```typescript
// src/util/progressBuffer.ts
import { OrderEvent } from "../types/simulation";

/** Append server-cursor-deduped `incoming` events to `existing`, keeping only the most recent
 *  `cap` (the rolling window). Order is preserved (oldest→newest). */
export function mergeEvents(existing: OrderEvent[], incoming: OrderEvent[], cap = 50): OrderEvent[] {
  const all = [...existing, ...incoming];
  return all.length > cap ? all.slice(all.length - cap) : all;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/progressBuffer.test.ts`
Expected: PASS — prints `progressBuffer tests passed`.

- [ ] **Step 6: Commit**

```bash
git add src/types/simulation.ts src/util/progressBuffer.ts tests/progressBuffer.test.ts
git commit -m "feat(live-feed): order-event types + rolling-window mergeEvents"
```

---

## Task 2: `pollJob` — cursor + `onProgress` + 2.5s interval

**Files:**
- Modify: `src/services/SimulationService.ts`

- [ ] **Step 1: Drop the poll interval to 2.5s**

Change the constant:

```typescript
// Live progress feed streams per-order events as deltas, so a tight 2.5s cadence stays cheap.
const POLL_INTERVAL_MS = 2_500;
```
(Leave `MAX_POLL_DURATION_MS = 90 * 60_000` as-is.)

- [ ] **Step 2: Add the cursor + `onProgress` to `pollJob`**

Replace the existing `pollJob` with:

```typescript
import { JobStatusResponse, GroupRunProgress } from "../types/simulation";
// ^ ensure GroupRunProgress is added to the existing type import from "../types/simulation".

/** Poll a job to completion with a sinceSeq cursor for the live progress feed.
 *  Resolves with { groupRun?, variation? } on success; throws on failure/timeout.
 *  `onPhase` gets the raw status each poll; `onProgress` gets the `progress` object each poll
 *  that carries one (running ticks and the terminal flush). */
export async function pollJob(
  routingGroupId: string,
  jobId: string,
  onPhase?: (status: string) => void,
  onProgress?: (progress: GroupRunProgress) => void,
): Promise<{ groupRun?: any; variation?: any }> {
  const { api, commonUtil } = await import("@common");
  const deadline = Date.now() + MAX_POLL_DURATION_MS;
  let sinceSeq = 0;
  while (Date.now() < deadline) {
    const resp: any = await api({
      url: `order-routing/routingGroups/${routingGroupId}/brokeringSimulation/jobs/${jobId}`,
      method: "GET",
      params: { sinceSeq },
    });
    if (commonUtil.hasError(resp)) throw new Error(`Polling failed: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
    const status = resp.data as JobStatusResponse;
    onPhase?.(status.status);
    if (status.progress) {
      onProgress?.(status.progress);
      if (typeof status.progress.nextSeq === "number") sinceSeq = status.progress.nextSeq;
    }
    const outcome = interpretJobStatus(status); // same module — call directly
    if (outcome.done) {
      if (outcome.error) throw new Error(outcome.error);
      return outcome.result ?? {};
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Simulation timed out. Please re-run this batch.");
}
```

Note: on a terminal `complete`/`failed` poll, `onProgress` fires with the final flush **before**
`interpretJobStatus` resolves/throws — so the last events are never dropped.

- [ ] **Step 3: Verify no top-level @common + pure test still passes**

Run: `grep -nE "^import.*@common" src/services/SimulationService.ts` → expect no output.
Run: `npx tsx tests/simulationService.test.ts` → prints `simulationService tests passed` (the pure
`interpretJobStatus` is unchanged; the new param is additive).

- [ ] **Step 4: Commit**

```bash
git add src/services/SimulationService.ts
git commit -m "feat(live-feed): pollJob sinceSeq cursor + onProgress + 2.5s cadence"
```

---

## Task 3: Store — `batchProgress[]`

**Files:**
- Modify: `src/store/simulationStore.ts`

- [ ] **Step 1: Add the state field + imports**

Add to the imports at the top:

```typescript
import { mergeEvents } from "../util/progressBuffer";
import { Variation, VariationRunState, BatchProgress } from "../types/simulation";
// ^ extend the existing "../types/simulation" import to include BatchProgress.
```

Add to `state`:

```typescript
batchProgress: [] as BatchProgress[],
```

- [ ] **Step 2: Initialise + populate `batchProgress` in `submit()`**

In `submit()`, right after `const batches = chunkVariants(live.map((b) => b.variant), 5);`, add:

```typescript
this.batchProgress = batches.map((_, i) => ({
  batchIndex: i, phaseLabel: "", phaseIndex: 0, phaseCount: 0,
  ordersInScope: 0, ordersProcessed: 0, brokered: 0, queued: 0, events: [],
}));
```

Then change the `pollJob` call inside the batch map to pass an `onProgress` (4th arg):

```typescript
const result = await pollJob(
  this.routingGroupId,
  jobId,
  (status) => { if (status === "running") ids.forEach((id) => setPhase(id, "running")); },
  (progress) => {
    const bp = this.batchProgress[i];
    if (!bp) return;
    bp.phaseLabel = progress.phaseLabel;
    bp.phaseIndex = progress.phaseIndex;
    bp.phaseCount = progress.phaseCount;
    bp.ordersInScope = progress.ordersInScope;
    bp.ordersProcessed = progress.ordersProcessed;
    bp.brokered = progress.brokered;
    bp.queued = progress.queued;
    bp.events = mergeEvents(bp.events, progress.events ?? [], 50);
  },
);
```

Also reset it on a fresh load — in `loadGroup`'s success block (next to `this.runStates = []`), add
`this.batchProgress = [];`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json` → confirm no errors reference `simulationStore.ts`.
Run: `npx eslint --ext .ts src/store/simulationStore.ts` → fix new errors.

- [ ] **Step 4: Commit**

```bash
git add src/store/simulationStore.ts
git commit -m "feat(live-feed): batchProgress state populated from poll progress"
```

---

## Task 4: `SimulationProgress.vue` — per-batch live panels

**Files:**
- Modify: `src/components/simulation/SimulationProgress.vue`

- [ ] **Step 1: Render per-batch panels above the runStates summary**

Replace the file with:

```vue
<template>
  <div>
    <!-- Live per-batch panels (one per job): bar + counters + rolling last-50 order events -->
    <div v-for="bp in sim.batchProgress" :key="bp.batchIndex" class="batch-panel">
      <h3>
        {{ bp.phaseLabel || translate("Starting…") }}
        <small v-if="bp.phaseCount">· {{ translate("Round") }} {{ bp.phaseIndex }}/{{ bp.phaseCount }}</small>
      </h3>
      <ion-progress-bar :value="bp.ordersInScope ? bp.ordersProcessed / bp.ordersInScope : 0" />
      <p class="counts">
        {{ bp.ordersProcessed }}/{{ bp.ordersInScope }} ·
        {{ translate("Brokered") }} {{ bp.brokered }} · {{ translate("Queued") }} {{ bp.queued }}
      </p>
      <ion-list v-if="bp.events.length">
        <ion-item v-for="ev in reversed(bp.events)" :key="ev.seq" lines="none">
          <ion-label class="ion-text-wrap">
            {{ ev.orderId }} · <span :class="reasonClass(ev.finalReason)">{{ ev.finalReason }}</span>
            · {{ ev.facilityId || translate("unfilled") }}
          </ion-label>
        </ion-item>
      </ion-list>
    </div>

    <!-- Per-variation summary (unchanged) -->
    <ion-list>
      <ion-list-header><ion-label>{{ translate("Simulation progress") }}</ion-label></ion-list-header>
      <ion-item v-for="rs in sim.runStates" :key="rs.variationId">
        <ion-label>
          <h3>{{ rs.label }}</h3>
          <p v-if="rs.error" class="error">{{ rs.error }}</p>
        </ion-label>
        <ion-spinner slot="end" v-if="rs.phase === 'running' || rs.phase === 'submitted'" />
        <ion-badge slot="end" v-else :color="badgeColor(rs.phase)">{{ phaseLabel(rs.phase) }}</ion-badge>
      </ion-item>
    </ion-list>
  </div>
</template>

<script setup lang="ts">
import { translate } from "@common";
import { IonBadge, IonItem, IonLabel, IonList, IonListHeader, IonProgressBar, IonSpinner } from "@ionic/vue";
import { simulationStore } from "@/store/simulationStore";
import { OrderEvent } from "@/types/simulation";

const sim = simulationStore();

function reversed(events: OrderEvent[]) { return [...events].reverse(); } // newest first

function reasonClass(reason: string) {
  if (reason === "FULLY_BROKERED" || reason === "PARTIALLY_BROKERED") return "ok";
  if (reason === "QUEUED") return "muted";
  return "warn"; // NO_RULE_MATCH / unfillable / etc.
}

function phaseLabel(phase: string) {
  return { pending: translate("Queued"), done: translate("Done"), failed: translate("Failed") }[phase] || phase;
}
function badgeColor(phase: string) {
  return phase === "done" ? "success" : phase === "failed" ? "danger" : "medium";
}
</script>

<style scoped>
.batch-panel { margin-bottom: var(--spacer-base); padding: var(--spacer-sm); border: 1px solid var(--ion-color-light-shade); border-radius: 8px; }
.batch-panel h3 { margin: 0 0 6px; font-size: 15px; }
.batch-panel h3 small { color: var(--ion-color-medium); font-weight: 400; }
.counts { font-size: 13px; color: var(--ion-color-medium); margin: 6px 0; }
.ok { color: var(--ion-color-success); }
.muted { color: var(--ion-color-medium); }
.warn { color: var(--ion-color-warning-shade); }
.error { color: var(--ion-color-danger); }
</style>
```

- [ ] **Step 2: Lint + build**

Run: `npx eslint --ext .vue src/components/simulation/SimulationProgress.vue` → fix new errors.
Run: `npm run build` → succeeds (confirms the template compiles, including `ion-progress-bar`).

- [ ] **Step 3: Commit**

```bash
git add src/components/simulation/SimulationProgress.vue
git commit -m "feat(live-feed): per-batch live panels — progress bar, counters, streaming order events"
```

---

## Task 5: End-to-end verification

**Files:** none.

- [ ] **Step 1: Full pure suite + lint + build**

Run: `npx tsx tests/progressBuffer.test.ts && npx tsx tests/simulationDiff.test.ts && npx tsx tests/simulationBatch.test.ts && npx tsx tests/simulationService.test.ts`
Expected: all four print their `… passed` lines.
Run: `npx eslint --ext .ts,.vue src/util/progressBuffer.ts src/services/SimulationService.ts src/store/simulationStore.ts src/components/simulation/SimulationProgress.vue` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 2: In-app check (against the live backend or a mock emitting the §2 shape)**

With `npm run dev` running: submit a run; on the Simulation view confirm a per-batch panel shows the
phase label + "Round i/n", the bar advances `ordersProcessed/ordersInScope`, brokered/queued tick up,
and order rows stream in (newest first, ~50 max), resetting counters when the phase changes. On
completion the results scorecard renders as before.

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A && git commit -m "chore(live-feed): end-to-end verification fixes"
```

---

## Notes for the implementer

- **Backend gating:** the `progress` field requires the backend's incremental support to be live;
  until then `progress` is simply absent and the panels stay at their initial zero state (no breakage).
  Verify the streaming UI against a mock emitting the §2 shape if the backend isn't ready.
- **`SimulationService` import rule:** never add a top-level `import … from "@common"` — keep it
  dynamic inside `pollJob` (the pure `interpretJobStatus` test imports the module via `tsx`).
- **Reactivity:** mutating `this.batchProgress[i]` fields in place is fine under Pinia (reactive
  array of reactive objects); `bp.events = mergeEvents(...)` reassigns the array so the list updates.
- **No new transport / no scrollback:** polling only; the event list is a rolling 50 (per the spec).
- **Field-name assumptions** (`progress.*`, event `facilityId|null`, `finalReason` enum) come from the
  FE brief; if the real responses differ, the store's `onProgress` mapper is the single point of change.
