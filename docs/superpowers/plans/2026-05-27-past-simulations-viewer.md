# Past Simulations Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "view / slice-and-dice past simulations" experience to the PWA's Simulate tab — a filterable list of persisted runs, a saved-run detail view (reusing the existing results UI), and a Phase-2 item explorer with in-house charts.

**Architecture:** Phase 1 (list + detail + deep-link) and Phase 2 (slice/dice charts + item table) over the backend's §3 read API. A pure adapter maps the persisted detail response into the shape `SimulationResults.vue` already renders; `SimulationResults` is refactored to accept that shape as a prop (falling back to the live store). All read-only GETs via the existing `SimulationService` pattern (dynamic `@common` import).

**Tech Stack:** Vue 3 + Ionic 8, Pinia, `api`/`commonUtil` from `@common`, pure modules tested with `npx tsx` + `node:assert`. No charting library — Phase-2 charts are in-house CSS/SVG.

---

## Critical prerequisite

The backend **§3 read API does not exist yet** (`GET brokeringSimulations`, `…/{id}`,
`…/{id}/variants/{seq}/items`, `…/{id}/aggregates`) and Follow-up A (`simulationId` in the poll
envelope) is pending. This plan builds against the assumed contract in the design spec
(`docs/superpowers/specs/2026-05-27-past-simulations-viewer-design.md`). The pure adapter and
service functions are fully buildable/testable now; the views are verified against a mock until the
endpoints land. **Work from:** `/Users/aditipatel/sandbox/accxui/apps/order-routing` for all tasks.

## Reference: shapes

Assumed §3 detail response (`GET brokeringSimulations/{id}`):
```
{ simulationId, routingGroupId, productStoreId, runType: "SINGLE"|"VARIATION",
  statusId: "RUNNING"|"COMPLETE"|"FAILED", createdDate,
  brokeredItemCount, attemptedItemCount, queuedItemCount,
  variants: [ { variantSeqId, label, isBaseline: "Y"|"N", failed: "Y"|"N",
               brokeredItemCount, attemptedItemCount, queuedItemCount, diffJson } ] }
```
Target shape consumed by `SimulationResults.vue` (already in use for live runs):
```
{ baseline: { brokeredItemCount, attemptedItemCount, queuedItemCount } | null,
  variants: [ { label, failed: boolean,
               groupRun: { brokeredItemCount, attemptedItemCount, queuedItemCount },
               diff: { finalReasonTransitions, routingBrokeredDelta, facilityAllocationDelta } } ],
  partial: boolean }
```

## File structure

| File | Phase | Responsibility |
|---|---|---|
| `src/util/persistedSimulationAdapter.ts` (create) | 1 | Pure map: §3 detail → results shape. |
| `src/services/SimulationService.ts` (extend) | 1,2 | `fetchPastSimulations`, `fetchSimulation` (P1); `fetchSimulationAggregates`, `fetchSimulationItems` (P2). |
| `src/components/simulation/SimulationResults.vue` (modify) | 1 | Accept optional `result`/`running` props; fall back to store (live). |
| `src/components/simulation/PastSimulationsList.vue` (create) | 1 | Filters + paginated list of headers. |
| `src/views/PastSimulationDetail.vue` (create) | 1 | Fetch `{id}` → adapt → render `SimulationResults`. |
| `src/views/SimulationHome.vue` (modify) | 1 | Segment: New simulation / Past simulations. |
| `src/store/simulationStore.ts` (modify) | 1 | `lastSimulationId` for the deep-link. |
| `src/router/index.ts` (modify) | 1 | Add `simulate/history/:simulationId` (`props: true`). |
| `src/components/simulation/FacilityAllocationChart.vue` (create) | 2 | CSS/SVG bar chart. |
| `src/components/simulation/FinalReasonChart.vue` (create) | 2 | CSS/SVG donut. |
| `src/views/SimulationSliceDice.vue` (create) | 2 | Charts + searchable item table. |
| `tests/persistedSimulationAdapter.test.ts` (create) | 1 | Adapter tests. |

---

# Phase 1 — list + detail + deep-link

## Task 1: Persisted-simulation adapter (pure, TDD)

**Files:**
- Create: `src/util/persistedSimulationAdapter.ts`
- Test: `tests/persistedSimulationAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/persistedSimulationAdapter.test.ts
import assert from "assert";
import { adaptPersistedSimulation } from "../src/util/persistedSimulationAdapter";

// variation run: baseline + 2 variants, diffJson as string
{
  const detail = {
    runType: "VARIATION", statusId: "COMPLETE",
    variants: [
      { variantSeqId: 0, label: "Baseline", isBaseline: "Y", failed: "N", brokeredItemCount: 480, attemptedItemCount: 500, queuedItemCount: 20 },
      { variantSeqId: 1, label: "Tighter distance", isBaseline: "N", failed: "N", brokeredItemCount: 470, attemptedItemCount: 500, queuedItemCount: 30, diffJson: '{"routingBrokeredDelta":{"100054":[200,190]}}' },
      { variantSeqId: 2, label: "Bigger buffer", isBaseline: "N", failed: "Y", brokeredItemCount: 0, attemptedItemCount: 0, queuedItemCount: 0 },
    ],
  };
  const out = adaptPersistedSimulation(detail);
  assert.deepStrictEqual(out.baseline, { brokeredItemCount: 480, attemptedItemCount: 500, queuedItemCount: 20 });
  assert.strictEqual(out.variants.length, 2);
  assert.strictEqual(out.variants[0].label, "Tighter distance");
  assert.deepStrictEqual(out.variants[0].groupRun, { brokeredItemCount: 470, attemptedItemCount: 500, queuedItemCount: 30 });
  assert.deepStrictEqual(out.variants[0].diff, { routingBrokeredDelta: { "100054": [200, 190] } }, "diffJson string parsed");
  assert.strictEqual(out.variants[1].failed, true, "failed Y → true");
  assert.strictEqual(out.partial, true, "a failed variant makes the run partial");
}

// single run: only the synthetic baseline → no comparison variants
{
  const detail = { runType: "SINGLE", statusId: "COMPLETE", variants: [
    { variantSeqId: 0, label: "Baseline", isBaseline: "Y", failed: "N", brokeredItemCount: 490, attemptedItemCount: 500, queuedItemCount: 10 },
  ] };
  const out = adaptPersistedSimulation(detail);
  assert.deepStrictEqual(out.baseline, { brokeredItemCount: 490, attemptedItemCount: 500, queuedItemCount: 10 });
  assert.deepStrictEqual(out.variants, []);
  assert.strictEqual(out.partial, false);
}

// diffJson already an object, and missing counts default to null
{
  const detail = { statusId: "COMPLETE", variants: [
    { variantSeqId: 0, isBaseline: "Y", failed: "N" },
    { variantSeqId: 1, isBaseline: "N", failed: "N", diffJson: { facilityAllocationDelta: { F1: [5, 7] } } },
  ] };
  const out = adaptPersistedSimulation(detail);
  assert.deepStrictEqual(out.baseline, { brokeredItemCount: null, attemptedItemCount: null, queuedItemCount: null });
  assert.deepStrictEqual(out.variants[0].diff, { facilityAllocationDelta: { F1: [5, 7] } }, "object diffJson passes through");
  assert.strictEqual(out.variants[0].label, "Variant 1", "missing label falls back to Variant <seq>");
}

console.log("persistedSimulationAdapter tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/persistedSimulationAdapter.test.ts`
Expected: FAIL — `Cannot find module '../src/util/persistedSimulationAdapter'`.

- [ ] **Step 3: Implement**

```typescript
// src/util/persistedSimulationAdapter.ts
// Pure: map a persisted §3 simulation-detail response into the { baseline, variants, partial }
// shape SimulationResults.vue renders. No Vue/@common imports (runnable under tsx).

function counts(v: any) {
  return {
    brokeredItemCount: v?.brokeredItemCount ?? null,
    attemptedItemCount: v?.attemptedItemCount ?? null,
    queuedItemCount: v?.queuedItemCount ?? null,
  };
}

function isBaseline(v: any): boolean {
  return v?.isBaseline === "Y" || v?.isBaseline === true;
}

function isFailed(v: any): boolean {
  return v?.failed === "Y" || v?.failed === true;
}

function parseDiff(d: any): any {
  if (d == null) return {};
  if (typeof d === "string") {
    try { return JSON.parse(d); } catch { return {}; }
  }
  return d;
}

export function adaptPersistedSimulation(detail: any): { baseline: any; variants: any[]; partial: boolean } {
  const all: any[] = detail?.variants ?? [];
  const baselineRow = all.find(isBaseline) ?? null;

  const variants = all
    .filter((v) => !isBaseline(v))
    .map((v) => ({
      label: v.label || `Variant ${v.variantSeqId}`,
      failed: isFailed(v),
      groupRun: counts(v),
      diff: parseDiff(v.diffJson),
    }));

  const partial = detail?.statusId === "FAILED" || variants.some((v) => v.failed);

  return { baseline: baselineRow ? counts(baselineRow) : null, variants, partial };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/persistedSimulationAdapter.test.ts`
Expected: PASS — prints `persistedSimulationAdapter tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/util/persistedSimulationAdapter.ts tests/persistedSimulationAdapter.test.ts
git commit -m "feat(past-sims): persisted simulation → results adapter"
```

---

## Task 2: Service read functions (list + detail)

**Files:**
- Modify: `src/services/SimulationService.ts`

Note: `SimulationService.ts` must keep **no top-level `@common` import** (the pure
`interpretJobStatus` test imports this module under `tsx`). Import `@common` dynamically inside each
function, exactly like the existing `submitBatch`/`pollJob`.

- [ ] **Step 1: Append the read functions**

```typescript
export interface PastSimulationFilters {
  routingGroupId?: string;
  productStoreId?: string;
  statusId?: string;
  runType?: string;
  createdDateFrom?: string;
  createdDateThru?: string;
  pageIndex?: number;
  pageSize?: number;
}

/** List persisted simulation headers (newest first). Read-only. */
export async function fetchPastSimulations(filters: PastSimulationFilters = {}): Promise<any[]> {
  const { api, commonUtil } = await import("@common");
  const params: Record<string, unknown> = { orderByField: "createdDate DESC", pageSize: 20, ...filters };
  Object.keys(params).forEach((k) => (params[k] == null || params[k] === "") && delete params[k]);
  const resp: any = await api({ url: "order-routing/brokeringSimulations", method: "GET", params });
  if (commonUtil.hasError(resp)) {
    throw new Error(`Failed to load past simulations: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
  }
  return Array.isArray(resp.data) ? resp.data : (resp.data?.simulations ?? []);
}

/** Fetch one persisted simulation header + its variants. Read-only. */
export async function fetchSimulation(simulationId: string): Promise<any> {
  const { api, commonUtil } = await import("@common");
  const resp: any = await api({
    url: `order-routing/brokeringSimulations/${encodeURIComponent(simulationId)}`,
    method: "GET",
  });
  if (commonUtil.hasError(resp) || !resp.data) {
    throw new Error(`Failed to load simulation ${simulationId}: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
  }
  return resp.data;
}
```

- [ ] **Step 2: Verify no top-level @common + pure test still passes**

Run: `grep -nE "^import.*@common" src/services/SimulationService.ts` → expect no output.
Run: `npx tsx tests/simulationService.test.ts` → prints `simulationService tests passed`.

- [ ] **Step 3: Commit**

```bash
git add src/services/SimulationService.ts
git commit -m "feat(past-sims): SimulationService list + detail read functions"
```

---

## Task 3: Make `SimulationResults` prop-or-store driven

**Files:**
- Modify: `src/components/simulation/SimulationResults.vue`

Goal: render either the live run (from the store, current behavior) or a saved run (from a prop),
without coupling the saved-run detail page to live run state.

- [ ] **Step 1: Add props + computed source; reference them in the template**

In the `<script setup>`, replace the store-only wiring:

```typescript
import { computed } from "vue";
// ...existing imports...
import { simulationStore } from "@/store/simulationStore";

const props = defineProps({
  // When provided, render this saved/adapted result instead of the live store run.
  result: { type: Object, default: null },
});

const sim = simulationStore();
const live = computed(() => !props.result);
const results = computed(() => props.result ?? sim.results);
const running = computed(() => (props.result ? false : sim.isRunning));

const winnerLabel = computed(() => {
  const vs = results.value?.variants ?? [];
  let best: any = null;
  for (const v of vs) {
    if (v.failed) continue;
    if (!best || (v.groupRun?.brokeredItemCount ?? -1) > (best.groupRun?.brokeredItemCount ?? -1)) best = v;
  }
  return best?.label;
});
```

In the template: replace `sim.isRunning` → `running`, `sim.results` → `results`, and guard the
"Back to editor" button so it only shows in live mode:
- `<simulation-progress v-if="running" />`
- `<ion-button v-if="live" fill="clear" @click="sim.view = 'editor'">…Back to editor…</ion-button>`
- `<ion-card v-if="results">` … and every `sim.results.X` → `results.X` (e.g.
  `results.baseline?.brokeredItemCount`, `v-for="v in results.variants"`, `results.partial`).

- [ ] **Step 2: Verify live mode unbroken (build) + lint**

Run: `npx eslint --ext .vue src/components/simulation/SimulationResults.vue` → fix new errors.
Run: `npm run build` → succeeds (confirms template compiles). (The live Simulate flow renders
`<simulation-results />` with no prop → uses the store, unchanged.)

- [ ] **Step 3: Commit**

```bash
git add src/components/simulation/SimulationResults.vue
git commit -m "refactor(simulation): SimulationResults accepts optional result prop (reuse for saved runs)"
```

---

## Task 4: PastSimulationsList component

**Files:**
- Create: `src/components/simulation/PastSimulationsList.vue`

- [ ] **Step 1: Implement the list**

```vue
<template>
  <div class="ion-padding">
    <div class="filters">
      <ion-select :label="translate('Status')" interface="popover" :value="statusId" @ionChange="onFilter('statusId', $event)">
        <ion-select-option value="">{{ translate("All") }}</ion-select-option>
        <ion-select-option value="COMPLETE">{{ translate("Complete") }}</ion-select-option>
        <ion-select-option value="RUNNING">{{ translate("Running") }}</ion-select-option>
        <ion-select-option value="FAILED">{{ translate("Failed") }}</ion-select-option>
      </ion-select>
      <ion-select :label="translate('Type')" interface="popover" :value="runType" @ionChange="onFilter('runType', $event)">
        <ion-select-option value="">{{ translate("All") }}</ion-select-option>
        <ion-select-option value="SINGLE">{{ translate("Single") }}</ion-select-option>
        <ion-select-option value="VARIATION">{{ translate("Variation") }}</ion-select-option>
      </ion-select>
    </div>

    <p v-if="error" class="error">{{ error }} <ion-button fill="clear" size="small" @click="reload">{{ translate("Retry") }}</ion-button></p>
    <ion-list v-else-if="rows.length">
      <ion-item v-for="row in rows" :key="row.simulationId" button :detail="true" @click="open(row.simulationId)">
        <ion-label>
          <h2>{{ row.simulationId }} · {{ row.routingGroupId }}</h2>
          <p>{{ row.runType }} · {{ commonUtil.getDateAndTime(row.createdDate) }}</p>
        </ion-label>
        <ion-badge slot="end" :color="statusColor(row.statusId)">{{ row.statusId }}</ion-badge>
        <ion-note slot="end">{{ row.brokeredItemCount ?? '—' }}/{{ row.attemptedItemCount ?? '—' }}</ion-note>
      </ion-item>
    </ion-list>
    <p v-else-if="!loading" class="empty">{{ translate("No past simulations yet.") }}</p>

    <ion-button v-if="rows.length && !loading" expand="block" fill="outline" @click="loadMore">{{ translate("Load more") }}</ion-button>
    <ion-spinner v-if="loading" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { translate, commonUtil } from "@common";
import { IonBadge, IonButton, IonItem, IonLabel, IonList, IonNote, IonSelect, IonSelectOption, IonSpinner } from "@ionic/vue";
import { fetchPastSimulations } from "@/services/SimulationService";
import { productStore } from "@/store/productStore";
import router from "@/router";

const rows = ref<any[]>([]);
const loading = ref(false);
const error = ref("");
const statusId = ref("");
const runType = ref("");
const pageIndex = ref(0);

function statusColor(s: string) { return s === "COMPLETE" ? "success" : s === "FAILED" ? "danger" : "medium"; }

async function load(reset: boolean) {
  loading.value = true; error.value = "";
  try {
    if (reset) { pageIndex.value = 0; rows.value = []; }
    const page = await fetchPastSimulations({
      productStoreId: productStore().currentEComStore?.productStoreId,
      statusId: statusId.value || undefined,
      runType: runType.value || undefined,
      pageIndex: pageIndex.value,
      pageSize: 20,
    });
    rows.value = reset ? page : [...rows.value, ...page];
  } catch (e: any) {
    error.value = e?.message ?? translate("Could not load past simulations.");
  } finally {
    loading.value = false;
  }
}

function reload() { load(true); }
function onFilter(key: "statusId" | "runType", ev: CustomEvent) {
  (key === "statusId" ? statusId : runType).value = (ev.detail as any).value;
  load(true);
}
function loadMore() { pageIndex.value += 1; load(false); }
function open(id: string) { router.push(`/tabs/simulate/history/${id}`); }

onMounted(() => load(true));
</script>

<style scoped>
.filters { display: flex; gap: var(--spacer-base); flex-wrap: wrap; }
.error { color: var(--ion-color-danger); }
.empty { color: var(--ion-color-medium); }
</style>
```

- [ ] **Step 2: Lint**

Run: `npx eslint --ext .vue src/components/simulation/PastSimulationsList.vue` → fix new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulation/PastSimulationsList.vue
git commit -m "feat(past-sims): past simulations list with filters + paging"
```

---

## Task 5: PastSimulationDetail view + route

**Files:**
- Create: `src/views/PastSimulationDetail.vue`
- Modify: `src/router/index.ts`

- [ ] **Step 1: Add the route (with props: true)**

In `src/router/index.ts`, add to the `/tabs` children array after the `simulate/:routingGroupId`
entry:

```typescript
      {
        path: "simulate/history/:simulationId",
        component: () => import("@/views/PastSimulationDetail.vue"),
        props: true
      },
```

Note: register this BEFORE `simulate/:routingGroupId` is fine because the static segment `history`
disambiguates; vue-router matches the more specific path. If a conflict arises, move this entry
above `simulate/:routingGroupId`.

- [ ] **Step 2: Create the detail view**

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button default-href="/tabs/simulate" /></ion-buttons>
        <ion-title>{{ translate("Simulation") }} {{ simulationId }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div v-if="error" class="ion-padding">
        <p class="error">{{ error }}</p>
        <ion-button fill="outline" @click="reload">{{ translate("Retry") }}</ion-button>
      </div>
      <div v-else-if="loading" class="ion-padding"><ion-spinner /> {{ translate("Loading…") }}</div>
      <template v-else>
        <ion-button fill="clear" @click="openSliceDice">
          <ion-icon slot="start" :icon="analyticsOutline" />{{ translate("Slice & dice") }}
        </ion-button>
        <simulation-results :result="adapted" />
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { translate } from "@common";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonPage, IonSpinner, IonTitle, IonToolbar } from "@ionic/vue";
import { analyticsOutline } from "ionicons/icons";
import router from "@/router";
import { fetchSimulation } from "@/services/SimulationService";
import { adaptPersistedSimulation } from "@/util/persistedSimulationAdapter";
import SimulationResults from "@/components/simulation/SimulationResults.vue";

const props = defineProps({ simulationId: { type: String, required: true } });

const adapted = ref<any>(null);
const loading = ref(true);
const error = ref("");

async function reload() {
  loading.value = true; error.value = "";
  try {
    const detail = await fetchSimulation(props.simulationId);
    adapted.value = adaptPersistedSimulation(detail);
  } catch (e: any) {
    error.value = e?.message ?? translate("Could not load this simulation.");
  } finally {
    loading.value = false;
  }
}

function openSliceDice() {
  // Phase 2 — slice/dice view. Wired in Task 10.
  router.push(`/tabs/simulate/history/${props.simulationId}/slice`);
}

onMounted(reload);
</script>

<style scoped>
.error { color: var(--ion-color-danger); }
</style>
```

Note: the "Slice & dice" button routes to a Phase-2 view; until Task 10 adds that route it will
404 — acceptable within Phase 1 (the button is the only entry and Phase 2 follows). If shipping
Phase 1 alone, hide the button behind a `// Phase 2` comment by removing it and re-adding in Task 10.

- [ ] **Step 3: Verify in app (against mock) + lint**

Run: `npx eslint --ext .vue src/views/PastSimulationDetail.vue` → fix new errors.
With `npm run dev` running and a mock returning a detail payload, navigate to
`/tabs/simulate/history/<id>` and confirm the scorecard + diff drill-downs render via the reused
`SimulationResults`. (Real data once §3 ships.)

- [ ] **Step 4: Commit**

```bash
git add src/views/PastSimulationDetail.vue src/router/index.ts
git commit -m "feat(past-sims): saved-run detail view (adapter + reused results) + route"
```

---

## Task 6: SimulationHome segment (New simulation / Past simulations)

**Files:**
- Modify: `src/views/SimulationHome.vue`

- [ ] **Step 1: Wrap the existing picker in a segment and add the list**

Replace the content of `SimulationHome.vue` so the picker and the list are two segments. Keep the
existing group-picker markup as the "new" segment; add `PastSimulationsList` as the "past" segment.

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Simulate") }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment :value="segment" @ionChange="segment = String($event.detail.value)">
          <ion-segment-button value="new"><ion-label>{{ translate("New simulation") }}</ion-label></ion-segment-button>
          <ion-segment-button value="past"><ion-label>{{ translate("Past simulations") }}</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div v-show="segment === 'new'">
        <!-- existing group-picker list, unchanged -->
        <ion-list>
          <ion-list-header>
            <ion-label>{{ translate("Choose a routing group to simulate") }}</ion-label>
          </ion-list-header>
          <ion-item v-for="group in groups" :key="group.routingGroupId" button @click="openGroup(group.routingGroupId)">
            <ion-label>
              <h2>{{ group.groupName || group.routingGroupId }}</h2>
              <p>{{ group.routingGroupId }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </div>
      <past-simulations-list v-if="segment === 'past'" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { translate } from "@common";
import { IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonPage, IonSegment, IonSegmentButton, IonTitle, IonToolbar } from "@ionic/vue";
import { orderRoutingStore } from "@/store/orderRoutingStore";
import PastSimulationsList from "@/components/simulation/PastSimulationsList.vue";
import router from "@/router";

const routingStore = orderRoutingStore();
const groups = computed(() => routingStore.getRoutingGroups);
const segment = ref("new");

onMounted(async () => { await routingStore.fetchOrderRoutingGroups(); });

function openGroup(routingGroupId: string) { router.push(`/tabs/simulate/${routingGroupId}`); }
</script>
```

(If the existing `SimulationHome.vue` markup differs, preserve its exact picker list/markup inside
the `segment === 'new'` div rather than retyping — only add the segment scaffolding and the `past`
branch.)

- [ ] **Step 2: Lint + verify in app**

Run: `npx eslint --ext .vue src/views/SimulationHome.vue` → fix new errors.
With `npm run dev`: the Simulate tab shows two segments; "New simulation" still opens a group;
"Past simulations" renders the list (mock).

- [ ] **Step 3: Commit**

```bash
git add src/views/SimulationHome.vue
git commit -m "feat(past-sims): Simulate home segment — new vs past simulations"
```

---

## Task 7: Deep-link from a fresh run (Follow-up A consumer)

**Files:**
- Modify: `src/store/simulationStore.ts`
- Modify: `src/components/simulation/SimulationResults.vue`

- [ ] **Step 1: Capture `simulationId` from the poll envelope**

In `simulationStore.ts`, add state `lastSimulationId: null as string | null`, reset it to `null` at
the start of `submit()` (next to `this.results = null`), and set it from the first completed batch.
The batch result is the `{ groupRun?, variation? }` from `pollJob`; the envelope's `simulationId`
arrives alongside it. Update `pollJob` callers: `pollJob` returns the result object — extend it to
also surface `simulationId`. Minimal approach: in `submit()`, after `mergeVariationResults`, set
`lastSimulationId` from the first non-null batch result that carries it.

Concretely, change the batch mapping in `submit()` so each batch returns the raw poll result, then:

```typescript
// after: this.results = mergeVariationResults(batchResults);
const firstWithId = batchResults.find((r: any) => r && r.simulationId);
this.lastSimulationId = firstWithId?.simulationId ?? null;
```

And in `SimulationService.pollJob`, include `simulationId` in the resolved object:

```typescript
// inside pollJob, on completion:
return { ...(outcome.result ?? {}), simulationId: (status as any).simulationId };
```

(`status` is the poll response `JobStatusResponse`; `simulationId` is read-if-present, `undefined`
when the backend hasn't shipped Follow-up A yet.)

- [ ] **Step 2: Add the "View saved result" action (live mode only)**

In `SimulationResults.vue`, when `live` and `sim.lastSimulationId` is set, show an action that
routes to the saved detail:

```vue
<ion-button v-if="live && sim.lastSimulationId" fill="clear" @click="viewSaved">
  <ion-icon slot="start" :icon="bookmarkOutline" />{{ translate("View saved result") }}
</ion-button>
```
```typescript
import router from "@/router";
import { bookmarkOutline } from "ionicons/icons";
function viewSaved() { if (sim.lastSimulationId) router.push(`/tabs/simulate/history/${sim.lastSimulationId}`); }
```

- [ ] **Step 3: Lint + pure test sanity**

Run: `npx eslint --ext .ts,.vue src/store/simulationStore.ts src/components/simulation/SimulationResults.vue` → fix new errors.
Run: `npx tsx tests/simulationService.test.ts` → still prints `simulationService tests passed`
(pollJob change is additive; the pure interpreter is unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/store/simulationStore.ts src/components/simulation/SimulationResults.vue src/services/SimulationService.ts
git commit -m "feat(past-sims): capture simulationId from poll + 'View saved result' deep-link"
```

---

# Phase 2 — slice/dice (charts + item table)

## Task 8: Service functions for aggregates + items

**Files:**
- Modify: `src/services/SimulationService.ts`

- [ ] **Step 1: Append the Phase-2 read functions**

```typescript
/** Server-computed rollups for one variant (counts by finalReason/facility, distance). */
export async function fetchSimulationAggregates(simulationId: string, variantSeqId: string | number): Promise<any> {
  const { api, commonUtil } = await import("@common");
  const resp: any = await api({
    url: `order-routing/brokeringSimulations/${encodeURIComponent(simulationId)}/aggregates`,
    method: "GET",
    params: { variantSeqId },
  });
  if (commonUtil.hasError(resp)) throw new Error(`Failed to load aggregates: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
  return resp.data ?? {};
}

export interface SimulationItemFilters {
  facilityId?: string;
  finalReason?: string;
  orderId?: string;
  pageIndex?: number;
  pageSize?: number;
}

/** Paged, filtered item rows for one variant (the slice/dice grain). */
export async function fetchSimulationItems(simulationId: string, variantSeqId: string | number, filters: SimulationItemFilters = {}): Promise<any[]> {
  const { api, commonUtil } = await import("@common");
  const params: Record<string, unknown> = { pageSize: 50, ...filters };
  Object.keys(params).forEach((k) => (params[k] == null || params[k] === "") && delete params[k]);
  const resp: any = await api({
    url: `order-routing/brokeringSimulations/${encodeURIComponent(simulationId)}/variants/${encodeURIComponent(String(variantSeqId))}/items`,
    method: "GET",
    params,
  });
  if (commonUtil.hasError(resp)) throw new Error(`Failed to load items: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
  return Array.isArray(resp.data) ? resp.data : (resp.data?.items ?? []);
}
```

- [ ] **Step 2: Verify + commit**

Run: `grep -nE "^import.*@common" src/services/SimulationService.ts` → no output.
Run: `npx tsx tests/simulationService.test.ts` → passes.
```bash
git add src/services/SimulationService.ts
git commit -m "feat(past-sims): aggregates + items read functions"
```

---

## Task 9: CSS/SVG chart components

**Files:**
- Create: `src/components/simulation/FacilityAllocationChart.vue`
- Create: `src/components/simulation/FinalReasonChart.vue`

- [ ] **Step 1: Facility bar chart (CSS bars)**

```vue
<!-- src/components/simulation/FacilityAllocationChart.vue -->
<template>
  <div class="bars">
    <div v-for="row in normalized" :key="row.label" class="bar-row">
      <span class="bar-label">{{ row.label }}</span>
      <div class="bar-track"><div class="bar-fill" :style="{ width: row.pct + '%' }" /></div>
      <span class="bar-value">{{ row.value }}</span>
    </div>
    <p v-if="!normalized.length" class="empty">{{ translate("No facility data.") }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";

// data: array of { label, value } (e.g. routedQty or count per facility)
const props = defineProps({ data: { type: Array as () => { label: string; value: number }[], default: () => [] } });

const normalized = computed(() => {
  const max = Math.max(1, ...props.data.map((d) => d.value || 0));
  return props.data.map((d) => ({ label: d.label, value: d.value, pct: Math.round(((d.value || 0) / max) * 100) }));
});
</script>

<style scoped>
.bar-row { display: grid; grid-template-columns: 120px 1fr 48px; gap: 8px; align-items: center; margin-bottom: 6px; }
.bar-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { background: var(--ion-color-light-shade); border-radius: 4px; height: 14px; }
.bar-fill { background: var(--ion-color-primary); height: 100%; border-radius: 4px; }
.bar-value { font-size: 13px; text-align: right; }
.empty { color: var(--ion-color-medium); }
</style>
```

- [ ] **Step 2: FinalReason donut (SVG)**

```vue
<!-- src/components/simulation/FinalReasonChart.vue -->
<template>
  <div class="donut-wrap">
    <svg viewBox="0 0 42 42" class="donut" v-if="total">
      <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="var(--ion-color-light-shade)" stroke-width="6" />
      <circle v-for="seg in segments" :key="seg.label" cx="21" cy="21" r="15.9155" fill="transparent"
              :stroke="seg.color" stroke-width="6" :stroke-dasharray="`${seg.pct} ${100 - seg.pct}`"
              :stroke-dashoffset="seg.offset" />
    </svg>
    <ul class="legend">
      <li v-for="seg in segments" :key="seg.label"><span class="dot" :style="{ background: seg.color }" />{{ seg.label }} — {{ seg.value }}</li>
      <li v-if="!total" class="empty">{{ translate("No data.") }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";

// data: array of { label, value }
const props = defineProps({ data: { type: Array as () => { label: string; value: number }[], default: () => [] } });
const COLORS = ["#2dd36f", "#ffc409", "#eb445a", "#3880ff", "#92949c"];

const total = computed(() => props.data.reduce((s, d) => s + (d.value || 0), 0));
const segments = computed(() => {
  let acc = 0;
  return props.data.map((d, i) => {
    const pct = total.value ? Math.round(((d.value || 0) / total.value) * 100) : 0;
    const offset = 25 - acc; // start at top
    acc += pct;
    return { label: d.label, value: d.value, pct, offset, color: COLORS[i % COLORS.length] };
  });
});
</script>

<style scoped>
.donut-wrap { display: flex; gap: var(--spacer-base); align-items: center; }
.donut { width: 140px; height: 140px; transform: rotate(-90deg); }
.legend { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
.empty { color: var(--ion-color-medium); }
</style>
```

- [ ] **Step 3: Lint + commit**

Run: `npx eslint --ext .vue src/components/simulation/FacilityAllocationChart.vue src/components/simulation/FinalReasonChart.vue` → fix new errors.
```bash
git add src/components/simulation/FacilityAllocationChart.vue src/components/simulation/FinalReasonChart.vue
git commit -m "feat(past-sims): CSS/SVG facility bar + finalReason donut charts"
```

---

## Task 10: SimulationSliceDice view + route + wire-up

**Files:**
- Create: `src/views/SimulationSliceDice.vue`
- Modify: `src/router/index.ts`

- [ ] **Step 1: Add the route**

In `src/router/index.ts`, after the `simulate/history/:simulationId` entry:

```typescript
      {
        path: "simulate/history/:simulationId/slice",
        component: () => import("@/views/SimulationSliceDice.vue"),
        props: true
      },
```

- [ ] **Step 2: Create the slice/dice view**

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button :default-href="`/tabs/simulate/history/${simulationId}`" /></ion-buttons>
        <ion-title>{{ translate("Slice & dice") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div v-if="error" class="error">{{ error }} <ion-button fill="clear" size="small" @click="reload">{{ translate("Retry") }}</ion-button></div>
      <template v-else>
        <ion-card>
          <ion-card-header><ion-card-title>{{ translate("By facility") }}</ion-card-title></ion-card-header>
          <ion-card-content><facility-allocation-chart :data="facilityData" /></ion-card-content>
        </ion-card>
        <ion-card>
          <ion-card-header><ion-card-title>{{ translate("By outcome") }}</ion-card-title></ion-card-header>
          <ion-card-content><final-reason-chart :data="reasonData" /></ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header><ion-card-title>{{ translate("Orders") }}</ion-card-title></ion-card-header>
          <ion-card-content>
            <ion-searchbar :placeholder="translate('Filter by order id')" :debounce="400" @ionInput="onSearch($event)" />
            <ion-list>
              <ion-item v-for="(it, i) in items" :key="i">
                <ion-label>
                  <h3>{{ it.orderId }} · {{ it.productId }}</h3>
                  <p>{{ it.finalReason }} · {{ it.facilityId || translate('Backordered') }} · {{ it.routedQty }}/{{ it.itemQty }}<span v-if="it.distance != null"> · {{ it.distance }}</span></p>
                </ion-label>
              </ion-item>
            </ion-list>
            <ion-button v-if="items.length" expand="block" fill="outline" @click="loadMoreItems">{{ translate("Load more") }}</ion-button>
            <p v-else-if="!loading" class="empty">{{ translate("No items.") }}</p>
          </ion-card-content>
        </ion-card>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { translate } from "@common";
import { IonBackButton, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonItem, IonLabel, IonList, IonPage, IonSearchbar, IonTitle, IonToolbar } from "@ionic/vue";
import { fetchSimulationAggregates, fetchSimulationItems } from "@/services/SimulationService";
import FacilityAllocationChart from "@/components/simulation/FacilityAllocationChart.vue";
import FinalReasonChart from "@/components/simulation/FinalReasonChart.vue";

// Baseline variant (seq 0) by default; a variant switcher can be added later.
const props = defineProps({ simulationId: { type: String, required: true } });
const variantSeqId = ref<string | number>(0);

const aggregates = ref<any>(null);
const items = ref<any[]>([]);
const orderId = ref("");
const itemPage = ref(0);
const loading = ref(false);
const error = ref("");

// aggregates shape (assumed): { byFacility: [{facilityId, routedQty}], byFinalReason: [{finalReason, count}] }
const facilityData = computed(() => (aggregates.value?.byFacility ?? []).map((r: any) => ({ label: r.facilityId || "Backordered", value: r.routedQty ?? r.count ?? 0 })));
const reasonData = computed(() => (aggregates.value?.byFinalReason ?? []).map((r: any) => ({ label: r.finalReason, value: r.count ?? 0 })));

async function loadAggregates() {
  try { aggregates.value = await fetchSimulationAggregates(props.simulationId, variantSeqId.value); }
  catch (e: any) { error.value = e?.message ?? translate("Could not load aggregates."); }
}
async function loadItems(reset: boolean) {
  loading.value = true;
  try {
    if (reset) { itemPage.value = 0; items.value = []; }
    const page = await fetchSimulationItems(props.simulationId, variantSeqId.value, { orderId: orderId.value || undefined, pageIndex: itemPage.value, pageSize: 50 });
    items.value = reset ? page : [...items.value, ...page];
  } catch (e: any) { error.value = e?.message ?? translate("Could not load items."); }
  finally { loading.value = false; }
}
function onSearch(ev: CustomEvent) { orderId.value = (ev.detail as any).value || ""; loadItems(true); }
function loadMoreItems() { itemPage.value += 1; loadItems(false); }
function reload() { error.value = ""; loadAggregates(); loadItems(true); }

onMounted(reload);
</script>

<style scoped>
.error { color: var(--ion-color-danger); }
.empty { color: var(--ion-color-medium); }
</style>
```

- [ ] **Step 3: Lint + verify in app (mock)**

Run: `npx eslint --ext .vue src/views/SimulationSliceDice.vue` → fix new errors.
With a mock for `/aggregates` and `/items`, from a detail page click "Slice & dice" → charts render
from aggregates, the order table pages, search filters by orderId.

- [ ] **Step 4: Commit**

```bash
git add src/views/SimulationSliceDice.vue src/router/index.ts
git commit -m "feat(past-sims): slice/dice view — facility/outcome charts + item table"
```

---

## Notes for the implementer

- **Backend gating:** Phase 1 tasks 1–3 (adapter, service reads, results refactor) are testable now;
  the views (4–7) need a mock of §3 to exercise end-to-end and are not functional until the backend
  ships the read API + Follow-up A. Phase 2 (8–10) needs `/aggregates` + `/items`.
- **Mock approach:** stub the four GET endpoints (e.g. a temporary dev interceptor or fixture
  returning the shapes in the design spec) to verify the views; remove before relying on real data.
- **Route param convention:** all param routes use `props: true` + `defineProps` — never `useRoute()`
  (this app's router passes params as props; `useRoute()` returns undefined here).
- **`SimulationService` import rule:** never add a top-level `import … from "@common"` — import it
  dynamically inside each function (the pure `interpretJobStatus` test imports the module via `tsx`).
- **Assumed field names** (aggregates `byFacility`/`byFinalReason`, item `orderId`/`facilityId`/
  `finalReason`/`routedQty`/`itemQty`/`distance`) come from the design spec; confirm against the real
  §3 responses and adjust the computed mappers + the adapter if they differ (single points of change).
