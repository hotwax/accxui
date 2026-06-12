# Per-Routing Run-Result Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each per-routing row on the variation Results tab clickable, opening a modal that shows outcome breakdown, facilities brokered to, queued orders, and per-order outcomes — derived from the `orderTraces` the API already returns.

**Architecture:** A new pure util `traceRollup.ts` derives all rollups from `orderTraces` (testable without Vue). A new thin `RoutingRunDetailModal.vue` renders them; `SimulationResults.vue` rows open it via `modalController`. No store changes, no new API calls. Spec: `docs/superpowers/specs/2026-06-12-routing-run-detail-drilldown-design.md`.

**Tech Stack:** Vue 3 + Ionic 8 PWA at `accxui/apps/order-routing`, Pinia (`simReferenceStore` for facility names), tests are plain `node:assert` scripts run with `npx tsx`.

**Working directory for ALL commands:** `/Users/aditipatel/sandbox/accxui/apps/order-routing`

**Repo caveats:**
- Do **NOT** run `npm run lint` — it crashes and `--fix`es the whole repo. Verify with `npm run build` and `npx tsx tests/<name>.test.ts`.
- `apps/order-routing` may be its own git repo or tracked by the parent `accxui` repo depending on checkout. Always run git commands from inside `apps/order-routing` and let git resolve the owning repo. Run `git rev-parse --show-toplevel` once at the start to know which repo you're committing to; use paths relative to that toplevel in `git add`.

---

### Task 1: Trace types in `types/variation.ts`

Replace `orderTraces?: any[]` with real interfaces matching the backend serializer (`ImpactPayloadSerializer.groovy` in the sim-routing component). Types only — verified by compilation in later tasks.

**Files:**
- Modify: `src/types/variation.ts` (lines 60–69, the `RoutingRunResult` block)

- [ ] **Step 1: Add the trace interfaces and update `RoutingRunResult`**

In `src/types/variation.ts`, replace this block:

```typescript
/** Per-routing result from a group run (variation run or parent live-config run). No routingName. */
export interface RoutingRunResult {
  orderRoutingId: string;
  sequenceNum: number;
  eligibleEntryCount: number;
  attemptedItemCount: number;
  brokeredItemCount: number;
  queuedItemCount: number;
  orderTraces?: any[];
}
```

with:

```typescript
/** Where an order item ultimately ended up after this routing ran. */
export type FinalReason = "FULLY_BROKERED" | "PARTIALLY_BROKERED" | "QUEUED" | "NO_INVENTORY" | "ERROR";

/** One facility assignment produced by a rule. Mirrors OrderAssignment in the sim-routing serializer. */
export interface OrderAssignment {
  orderId: string;
  orderItemSeqId: string;
  shipGroupSeqId: string;
  facilityId: string;
  routedQty: number;
  itemQty: number;
}

/** One rule's attempt at routing an order. Mirrors RuleAttempt in the sim-routing serializer. */
export interface RuleAttempt {
  routingRuleId: string;
  sequenceNum: number;
  durationMs?: number;
  suggestedFulfillmentLocations?: unknown;
  actionFilters?: unknown;
  outcome: string;
  runNextRule?: boolean;
  errorMessage?: string | null;
}

/** Per-order trace from a group run. Fields are optional-tolerant: older payloads may omit them. */
export interface OrderTrace {
  orderId: string;
  shipGroupSeqId?: string;
  orderItemSeqId?: string;
  finalReason: FinalReason | string;
  finalAssignments?: OrderAssignment[];
  ruleAttempts?: RuleAttempt[];
}

/** Per-routing result from a group run (variation run or parent live-config run). No routingName. */
export interface RoutingRunResult {
  orderRoutingId: string;
  sequenceNum: number;
  eligibleEntryCount: number;
  attemptedItemCount: number;
  brokeredItemCount: number;
  queuedItemCount: number;
  orderTraces?: OrderTrace[];
}
```

- [ ] **Step 2: Verify nothing existing broke**

Run: `npx tsx tests/routingResultJoin.test.ts`
Expected: `routingResultJoin tests passed`

- [ ] **Step 3: Commit**

```bash
git add src/types/variation.ts
git commit -m "feat(sim): type orderTraces — OrderTrace/OrderAssignment/RuleAttempt interfaces"
```

---

### Task 2: `traceRollup.ts` — `outcomeCounts` + `facilityRollup`

**Files:**
- Create: `src/util/traceRollup.ts`
- Create: `tests/traceRollup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/traceRollup.test.ts`:

```typescript
// tests/traceRollup.test.ts
import assert from "node:assert";
import { outcomeCounts, facilityRollup } from "../src/util/traceRollup";
import type { OrderTrace } from "../src/types/variation";

const trace = (orderId: string, finalReason: string, assignments: Array<[string, number]> = [], orderItemSeqId = "00101"): OrderTrace => ({
  orderId,
  orderItemSeqId,
  shipGroupSeqId: "00001",
  finalReason,
  finalAssignments: assignments.map(([facilityId, routedQty]) => ({
    orderId, orderItemSeqId, shipGroupSeqId: "00001", facilityId, routedQty, itemQty: routedQty,
  })),
  ruleAttempts: [],
});

// --- outcomeCounts ---
assert.deepStrictEqual(outcomeCounts(undefined), {});
assert.deepStrictEqual(outcomeCounts([]), {});
assert.deepStrictEqual(
  outcomeCounts([
    trace("O1", "FULLY_BROKERED"),
    trace("O2", "FULLY_BROKERED"),
    trace("O3", "QUEUED"),
  ]),
  { FULLY_BROKERED: 2, QUEUED: 1 },
);

// --- facilityRollup ---
assert.deepStrictEqual(facilityRollup(undefined), []);
assert.deepStrictEqual(facilityRollup([trace("O1", "NO_INVENTORY")]), []); // no assignments -> empty

const rolled = facilityRollup([
  trace("O1", "FULLY_BROKERED", [["WH_NYC", 2]]),
  trace("O2", "FULLY_BROKERED", [["WH_NYC", 1], ["STORE_LA", 3]]),
  trace("O3", "PARTIALLY_BROKERED", [["STORE_LA", 1]]),
]);
// Sorted by itemCount desc, ties by facilityId asc.
assert.deepStrictEqual(rolled, [
  { facilityId: "STORE_LA", itemCount: 2, totalRoutedQty: 4 },
  { facilityId: "WH_NYC", itemCount: 2, totalRoutedQty: 3 },
]);

console.log("traceRollup tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/traceRollup.test.ts`
Expected: FAIL — `Cannot find module '../src/util/traceRollup'` (or similar resolve error)

- [ ] **Step 3: Write the implementation**

Create `src/util/traceRollup.ts`:

```typescript
// src/util/traceRollup.ts
// Pure: derive drill-down rollups from a routing run's orderTraces.
// Every function tolerates undefined/empty traces (older payloads omit them) and returns an empty result.
import type { OrderTrace } from "../types/variation";

export interface FacilityRollupRow {
  facilityId: string;
  itemCount: number;       // number of assignments routed to this facility
  totalRoutedQty: number;  // sum of routedQty across those assignments
}

/** Count traces by finalReason, e.g. { FULLY_BROKERED: 120, QUEUED: 19 }. */
export function outcomeCounts(traces?: OrderTrace[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of traces ?? []) {
    const reason = t.finalReason || "UNKNOWN";
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

/** Group finalAssignments by facility. Sorted by itemCount desc, ties by facilityId asc. */
export function facilityRollup(traces?: OrderTrace[]): FacilityRollupRow[] {
  const byFacility = new Map<string, FacilityRollupRow>();
  for (const t of traces ?? []) {
    for (const a of t.finalAssignments ?? []) {
      if (!a.facilityId) continue;
      const row = byFacility.get(a.facilityId) || { facilityId: a.facilityId, itemCount: 0, totalRoutedQty: 0 };
      row.itemCount += 1;
      row.totalRoutedQty += a.routedQty ?? 0;
      byFacility.set(a.facilityId, row);
    }
  }
  return [...byFacility.values()].sort((a, b) => b.itemCount - a.itemCount || a.facilityId.localeCompare(b.facilityId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/traceRollup.test.ts`
Expected: `traceRollup tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/util/traceRollup.ts tests/traceRollup.test.ts
git commit -m "feat(sim): traceRollup — outcomeCounts + facilityRollup from orderTraces"
```

---

### Task 3: `traceRollup.ts` — `compareFacilities` + `queuedDiff`

**Files:**
- Modify: `src/util/traceRollup.ts`
- Modify: `tests/traceRollup.test.ts`

- [ ] **Step 1: Extend the test (append before the final `console.log` line)**

Append to `tests/traceRollup.test.ts` (keep `console.log("traceRollup tests passed")` last; extend the import to include the new functions):

```typescript
import { outcomeCounts, facilityRollup, compareFacilities, queuedDiff } from "../src/util/traceRollup";
```

```typescript
// --- compareFacilities ---
assert.deepStrictEqual(compareFacilities(undefined, undefined), []);

const cmp = compareFacilities(
  [trace("O1", "FULLY_BROKERED", [["WH_NYC", 1]]), trace("O2", "FULLY_BROKERED", [["WH_NYC", 1]])],
  [trace("O1", "FULLY_BROKERED", [["WH_NYC", 1]]), trace("O2", "FULLY_BROKERED", [["STORE_LA", 1]]), trace("O3", "FULLY_BROKERED", [["STORE_LA", 2]])],
);
// Sorted by variationQty desc; union of both sides; delta = variation - parent (itemCount based).
assert.deepStrictEqual(cmp, [
  { facilityId: "STORE_LA", parentQty: 0, variationQty: 2, delta: 2 },
  { facilityId: "WH_NYC", parentQty: 2, variationQty: 1, delta: -1 },
]);

// --- queuedDiff ---
assert.deepStrictEqual(queuedDiff(undefined, undefined), []);

const queued = queuedDiff(
  [trace("O1", "QUEUED", [], "00101"), trace("O2", "FULLY_BROKERED", [], "00101")],
  [trace("O1", "QUEUED", [], "00101"), trace("O2", "QUEUED", [], "00101"), trace("O3", "FULLY_BROKERED", [], "00101")],
);
// O1 queued in both -> not new; O2 newly queued; O3 not queued at all.
assert.deepStrictEqual(queued, [
  { orderId: "O1", orderItemSeqId: "00101", newlyQueued: false },
  { orderId: "O2", orderItemSeqId: "00101", newlyQueued: true },
]);

// No parent traces -> no baseline -> never flagged "newly queued" (avoids a false claim).
assert.deepStrictEqual(
  queuedDiff(undefined, [trace("O9", "QUEUED", [], "00101")]),
  [{ orderId: "O9", orderItemSeqId: "00101", newlyQueued: false }],
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/traceRollup.test.ts`
Expected: FAIL — `compareFacilities` is not exported

- [ ] **Step 3: Implement (append to `src/util/traceRollup.ts`)**

```typescript
export interface FacilityCompareRow {
  facilityId: string;
  parentQty: number;     // itemCount in the parent run
  variationQty: number;  // itemCount in the variation run
  delta: number;         // variationQty - parentQty
}

/** Join both sides' facility rollups (itemCount). Sorted by variationQty desc, then parentQty desc, then id. */
export function compareFacilities(parentTraces?: OrderTrace[], variationTraces?: OrderTrace[]): FacilityCompareRow[] {
  const parent = new Map(facilityRollup(parentTraces).map((r) => [r.facilityId, r.itemCount]));
  const variation = new Map(facilityRollup(variationTraces).map((r) => [r.facilityId, r.itemCount]));
  const ids = new Set([...parent.keys(), ...variation.keys()]);
  return [...ids]
    .map((facilityId) => {
      const parentQty = parent.get(facilityId) ?? 0;
      const variationQty = variation.get(facilityId) ?? 0;
      return { facilityId, parentQty, variationQty, delta: variationQty - parentQty };
    })
    .sort((a, b) => b.variationQty - a.variationQty || b.parentQty - a.parentQty || a.facilityId.localeCompare(b.facilityId));
}

export interface QueuedItem {
  orderId: string;
  orderItemSeqId?: string;
  newlyQueued: boolean;
}

const itemKey = (t: { orderId: string; orderItemSeqId?: string }) => `${t.orderId}|${t.orderItemSeqId ?? ""}`;

/** The variation side's queued order items, flagged newlyQueued when the parent did not queue the same item.
 *  Pass parentTraces=undefined when there is no parent baseline — nothing gets flagged then. */
export function queuedDiff(parentTraces: OrderTrace[] | undefined, variationTraces?: OrderTrace[]): QueuedItem[] {
  const hasParent = parentTraces != null;
  const parentQueued = new Set((parentTraces ?? []).filter((t) => t.finalReason === "QUEUED").map(itemKey));
  return (variationTraces ?? [])
    .filter((t) => t.finalReason === "QUEUED")
    .map((t) => ({ orderId: t.orderId, orderItemSeqId: t.orderItemSeqId, newlyQueued: hasParent && !parentQueued.has(itemKey(t)) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/traceRollup.test.ts`
Expected: `traceRollup tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/util/traceRollup.ts tests/traceRollup.test.ts
git commit -m "feat(sim): traceRollup — compareFacilities + queuedDiff parent-vs-variation"
```

---

### Task 4: `traceRollup.ts` — `describeRuleAttempts`

**Files:**
- Modify: `src/util/traceRollup.ts`
- Modify: `tests/traceRollup.test.ts`

- [ ] **Step 1: Extend the test (append before the final `console.log`; extend the import to include `describeRuleAttempts`)**

```typescript
// --- describeRuleAttempts ---
assert.deepStrictEqual(describeRuleAttempts({ orderId: "O1", finalReason: "QUEUED" }), []);

const lines = describeRuleAttempts({
  orderId: "O1",
  finalReason: "FULLY_BROKERED",
  ruleAttempts: [
    { routingRuleId: "RR1", sequenceNum: 1, outcome: "NO_INVENTORY" },
    { routingRuleId: "RR2", sequenceNum: 2, outcome: "FULL_BROKER" },
    { routingRuleId: "RR3", sequenceNum: 3, outcome: "SOME_NEW_OUTCOME" },
    { routingRuleId: "RR4", sequenceNum: 4, outcome: "ERROR", errorMessage: "timeout" },
  ],
});
assert.deepStrictEqual(lines, [
  "Rule 1: no available inventory — fell through",
  "Rule 2: fully brokered here",
  "Rule 3: some new outcome",      // unknown outcomes humanize instead of breaking
  "Rule 4: errored (timeout)",
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/traceRollup.test.ts`
Expected: FAIL — `describeRuleAttempts` is not exported

- [ ] **Step 3: Implement (append to `src/util/traceRollup.ts`)**

```typescript
const OUTCOME_TEXT: Record<string, string> = {
  FULL_BROKER: "fully brokered here",
  PARTIAL_BROKER: "partially brokered here",
  ROUTED: "routed",
  ROUTED_TO_QUEUE: "moved to queue",
  NO_INVENTORY: "no available inventory — fell through",
  ERROR: "errored",
};

/** Plain-English line per rule attempt, e.g. "Rule 2: fully brokered here".
 *  Unknown outcome enums are humanized (underscores -> spaces, lowercased) rather than dropped. */
export function describeRuleAttempts(trace: OrderTrace): string[] {
  return (trace.ruleAttempts ?? []).map((ra) => {
    const text = OUTCOME_TEXT[ra.outcome] ?? (ra.outcome || "unknown outcome").replace(/_/g, " ").toLowerCase();
    const err = ra.errorMessage ? ` (${ra.errorMessage})` : "";
    return `Rule ${ra.sequenceNum ?? "?"}: ${text}${err}`;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/traceRollup.test.ts`
Expected: `traceRollup tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/util/traceRollup.ts tests/traceRollup.test.ts
git commit -m "feat(sim): traceRollup — describeRuleAttempts plain-English narrative"
```

---

### Task 5: `RoutingRunDetailModal.vue`

The modal is deliberately thin — all logic already lives (tested) in `traceRollup.ts`. Facility names come from `simReferenceStore.facilities` (already loaded for the Simulate tab; fall back to the raw id).

**Files:**
- Create: `src/components/simulation/RoutingRunDetailModal.vue`
- Modify: `src/locales/en.json` (add new keys)

- [ ] **Step 1: Create the component**

Create `src/components/simulation/RoutingRunDetailModal.vue`:

```vue
<template>
  <ion-header>
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-button @click="closeModal">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
      <ion-title>{{ row.routingName }}</ion-title>
    </ion-toolbar>
  </ion-header>

  <ion-content class="ion-padding">
    <!-- One-sided rows (routing added/removed by the variation): single-column view with a note. -->
    <ion-note v-if="!row.parent" color="medium">{{ translate("Not present in the parent run — showing variation only.") }}</ion-note>
    <ion-note v-else-if="!row.variation" color="medium">{{ translate("Not run in this variation — showing parent only.") }}</ion-note>

    <!-- Summary: same numbers as the list row. -->
    <ion-card>
      <ion-card-header><ion-card-title>{{ translate("Summary") }}</ion-card-title></ion-card-header>
      <ion-card-content>
        <div class="cmp">
          <span class="metric"><span class="lbl">{{ translate("Eligible") }}</span><span>{{ pair("eligibleEntryCount") }}</span></span>
          <span class="metric"><span class="lbl">{{ translate("Brokered") }}</span><span>{{ pair("brokeredItemCount") }}</span></span>
          <span class="metric"><span class="lbl">{{ translate("Queued") }}</span><span>{{ pair("queuedItemCount") }}</span></span>
        </div>
        <p v-if="zeroEligible" class="sig-warn">{{ translate("0 eligible — filter matched nothing") }}</p>
      </ion-card-content>
    </ion-card>

    <template v-if="hasTraces && !zeroEligible">
      <!-- Outcome breakdown by finalReason. -->
      <ion-card>
        <ion-card-header><ion-card-title>{{ translate("Outcomes") }}</ion-card-title></ion-card-header>
        <ion-card-content>
          <div class="cmp">
            <span v-for="reason in outcomeReasons" :key="reason" class="metric">
              <span class="lbl">{{ reasonLabel(reason) }}</span>
              <span>{{ outcomePair(reason) }}</span>
            </span>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- Facilities brokered: parent vs variation item counts. -->
      <ion-card v-if="facilityRows.length">
        <ion-card-header><ion-card-title>{{ translate("Facilities brokered") }}</ion-card-title></ion-card-header>
        <ion-list>
          <ion-item v-for="f in facilityRows" :key="f.facilityId" lines="none">
            <ion-label>
              <h3>{{ facilityName(f.facilityId) }}</h3>
              <p v-if="bothSides">{{ f.parentQty }} → {{ f.variationQty }} ({{ f.delta >= 0 ? "+" : "" }}{{ f.delta }})</p>
              <p v-else>{{ row.variation ? f.variationQty : f.parentQty }} {{ translate("items") }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </ion-card>

      <!-- Queued orders, with newly-queued badge vs parent. -->
      <ion-card v-if="queuedItems.length">
        <ion-card-header><ion-card-title>{{ translate("Queued orders") }}</ion-card-title></ion-card-header>
        <ion-list>
          <ion-item v-for="q in queuedItems" :key="q.orderId + (q.orderItemSeqId || '')" lines="none">
            <ion-label>{{ q.orderId }}<span v-if="q.orderItemSeqId"> · {{ q.orderItemSeqId }}</span></ion-label>
            <ion-badge v-if="q.newlyQueued" slot="end" color="warning">{{ translate("newly queued") }}</ion-badge>
          </ion-item>
        </ion-list>
      </ion-card>

      <!-- Per-order outcomes: searchable, capped at 50 with load-more, rows expand to the rule narrative. -->
      <ion-card>
        <ion-card-header><ion-card-title>{{ translate("Per-order outcomes") }}</ion-card-title></ion-card-header>
        <ion-searchbar v-model="query" :placeholder="translate('Search by order ID')" />
        <ion-list>
          <ion-item v-for="t in visibleTraces" :key="traceKey(t)" button @click="toggle(traceKey(t))">
            <ion-label>
              <h3>{{ t.orderId }}<span v-if="t.orderItemSeqId"> · {{ t.orderItemSeqId }}</span></h3>
              <p>{{ reasonLabel(String(t.finalReason)) }}</p>
              <template v-if="expanded.has(traceKey(t))">
                <p v-for="(line, i) in describeRuleAttempts(t)" :key="i">{{ line }}</p>
                <p v-for="a in t.finalAssignments ?? []" :key="a.facilityId + a.orderItemSeqId">
                  → {{ facilityName(a.facilityId) }} · {{ translate("qty") }} {{ a.routedQty }}
                </p>
              </template>
            </ion-label>
          </ion-item>
        </ion-list>
        <ion-button v-if="filteredTraces.length > visibleCount" fill="clear" @click="visibleCount += 50">
          {{ translate("Load more") }} ({{ filteredTraces.length - visibleCount }})
        </ion-button>
      </ion-card>
    </template>
    <p v-else-if="!zeroEligible" class="sig-info">{{ translate("Per-order detail not available for this run.") }}</p>

    <!-- Cost is group-level only until the backend enrichment lands (see trace-enrichment backend request spec). -->
    <p class="sig-info">{{ translate("Shipping cost is available at group level on the outcomes dashboard; per-routing cost is pending backend support.") }}</p>
  </ion-content>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { translate } from "@common";
import { IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSearchbar, IonTitle, IonToolbar, modalController } from "@ionic/vue";
import { closeOutline } from "ionicons/icons";
import type { CompareRow, OrderTrace, RoutingRunResult } from "@/types/variation";
import { compareFacilities, describeRuleAttempts, outcomeCounts, queuedDiff } from "@/util/traceRollup";
import { useSimReferenceStore } from "@/store/simReferenceStore";

const props = defineProps<{ row: CompareRow }>();
const row = props.row;
const refStore = useSimReferenceStore();

const bothSides = computed(() => !!(row.parent && row.variation));
// The side whose detail we show: variation when present (it's the focus), else parent.
const detail = computed<RoutingRunResult | null>(() => row.variation ?? row.parent);
const detailTraces = computed<OrderTrace[]>(() => detail.value?.orderTraces ?? []);
const hasTraces = computed(() => detailTraces.value.length > 0);
const zeroEligible = computed(() => !!row.variation && row.variation.eligibleEntryCount === 0);

const n = (v: number | undefined) => (v == null ? "—" : String(v));
function pair(field: "eligibleEntryCount" | "brokeredItemCount" | "queuedItemCount"): string {
  if (!bothSides.value) return n(detail.value?.[field]);
  return `${n(row.parent?.[field])} → ${n(row.variation?.[field])}`;
}

const parentOutcomes = computed(() => outcomeCounts(row.parent?.orderTraces));
const variationOutcomes = computed(() => outcomeCounts(row.variation?.orderTraces));
const outcomeReasons = computed(() => [...new Set([...Object.keys(parentOutcomes.value), ...Object.keys(variationOutcomes.value)])]);
function outcomePair(reason: string): string {
  if (!bothSides.value) return String((row.variation ? variationOutcomes.value : parentOutcomes.value)[reason] ?? 0);
  return `${parentOutcomes.value[reason] ?? 0} → ${variationOutcomes.value[reason] ?? 0}`;
}

const REASON_LABELS: Record<string, string> = {
  FULLY_BROKERED: "Fully brokered",
  PARTIALLY_BROKERED: "Partially brokered",
  QUEUED: "Queued",
  NO_INVENTORY: "No inventory",
  ERROR: "Error",
};
const reasonLabel = (reason: string) => translate(REASON_LABELS[reason] ?? reason);

const facilityRows = computed(() => compareFacilities(row.parent?.orderTraces, row.variation?.orderTraces));
// One-sided parent rows still list their queued items; no parent baseline -> no "newly queued" badges.
const queuedItems = computed(() => queuedDiff(row.variation ? row.parent?.orderTraces : undefined, detailTraces.value));

const query = ref("");
const visibleCount = ref(50);
const filteredTraces = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return detailTraces.value;
  return detailTraces.value.filter((t) => t.orderId.toLowerCase().includes(q));
});
const visibleTraces = computed(() => filteredTraces.value.slice(0, visibleCount.value));

const expanded = ref(new Set<string>());
const traceKey = (t: OrderTrace) => `${t.orderId}|${t.orderItemSeqId ?? ""}|${t.shipGroupSeqId ?? ""}`;
function toggle(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expanded.value = next;
}

function facilityName(facilityId: string): string {
  return refStore.facilities[facilityId]?.facilityName || facilityId;
}
function closeModal() {
  modalController.dismiss();
}
</script>

<style scoped>
.cmp { display: flex; gap: var(--spacer-base); flex-wrap: wrap; }
.metric { display: flex; flex-direction: column; }
.lbl { font-size: 0.75rem; color: var(--ion-color-medium); }
.sig-warn { color: var(--ion-color-warning); }
.sig-info { color: var(--ion-color-medium); }
</style>
```

- [ ] **Step 2: Add the new locale keys**

In `src/locales/en.json`, add these keys (alphabetical placement, matching the file's existing ordering; values equal keys, as this app's convention is English-string keys):

```json
"0 eligible — filter matched nothing": "0 eligible — filter matched nothing",
"Error": "Error",
"Facilities brokered": "Facilities brokered",
"Fully brokered": "Fully brokered",
"items": "items",
"Load more": "Load more",
"newly queued": "newly queued",
"No inventory": "No inventory",
"Not present in the parent run — showing variation only.": "Not present in the parent run — showing variation only.",
"Not run in this variation — showing parent only.": "Not run in this variation — showing parent only.",
"Partially brokered": "Partially brokered",
"Per-order detail not available for this run.": "Per-order detail not available for this run.",
"Per-order outcomes": "Per-order outcomes",
"qty": "qty",
"Queued orders": "Queued orders",
"Search by order ID": "Search by order ID",
"Shipping cost is available at group level on the outcomes dashboard; per-routing cost is pending backend support.": "Shipping cost is available at group level on the outcomes dashboard; per-routing cost is pending backend support.",
"Summary": "Summary"
```

Skip any key that already exists (e.g. "0 eligible — filter matched nothing", "Queued", "Eligible", "Brokered", "Outcomes" are likely present — check with grep first):

Run: `grep -c "Facilities brokered" src/locales/en.json` per key, or just add and rely on JSON-duplicate review.

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build completes with no TypeScript errors (warnings about bundle size are pre-existing and fine)

- [ ] **Step 4: Commit**

```bash
git add src/components/simulation/RoutingRunDetailModal.vue src/locales/en.json
git commit -m "feat(sim): RoutingRunDetailModal — per-routing drill-down detail modal"
```

---

### Task 6: Wire rows in `SimulationResults.vue` to open the modal

**Files:**
- Modify: `src/components/simulation/SimulationResults.vue` (per-routing `ion-item` at lines 19–29; script block)

- [ ] **Step 1: Make the row a button**

In the template, change the per-routing `ion-item` opening tag from:

```html
<ion-item v-for="row in sim.variationCompareRows" :key="row.routingName + (row.variationRoutingId || row.parentRoutingId)">
```

to:

```html
<ion-item v-for="row in sim.variationCompareRows" :key="row.routingName + (row.variationRoutingId || row.parentRoutingId)" button :detail="true" @click="openRowDetail(row)">
```

- [ ] **Step 2: Add the open function**

In the script block:

1. Add `modalController` to the existing `@ionic/vue` import list.
2. Add imports:

```typescript
import RoutingRunDetailModal from "./RoutingRunDetailModal.vue";
import type { CompareRow } from "@/types/variation";
```

3. Add below `compareSignal()`:

```typescript
async function openRowDetail(row: CompareRow) {
  const modal = await modalController.create({
    component: RoutingRunDetailModal,
    componentProps: { row },
  });
  await modal.present();
}
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build completes with no TypeScript errors

- [ ] **Step 4: Manual smoke check (optional but recommended)**

Run: `npm run serve`, open the Simulate tab, run a variation, open the Results tab, click a per-routing row. Expected: modal opens with summary; rows with traces show outcome/facility/queued/per-order sections; zero-eligible rows show the "filter matched nothing" line. (Chrome DevTools MCP per `.agent/rules/` if automating.)

- [ ] **Step 5: Commit**

```bash
git add src/components/simulation/SimulationResults.vue
git commit -m "feat(sim): clickable per-routing rows open run-result drill-down modal"
```

---

### Task 7: Backend request spec (doc only)

**Files:**
- Create: `docs/superpowers/specs/2026-06-12-trace-enrichment-backend-request.md` — at the **accxui docs root** (`/Users/aditipatel/sandbox/accxui/docs/...`), alongside the other sim specs

- [ ] **Step 1: Write the doc**

```markdown
# Backend request: enrich group-run order traces for the routing drill-down

**Date:** 2026-06-12
**Requesting app:** `accxui/apps/order-routing` (variation Results tab drill-down)
**Target:** `sim-routing` Moqui component — `ImpactPayloadSerializer.groovy` / `OrderAssignment`
**Related:** docs/superpowers/specs/2026-06-12-routing-run-detail-drilldown-design.md

## What we need

Two additions to each `OrderAssignment` emitted in
`groupRun -> routingResults[] -> orderTraces[] -> finalAssignments[]`:

| Field | Type | Purpose |
|---|---|---|
| `productId` | String | "Products brokered" section in the per-routing drill-down modal |
| `productName` | String (optional, nice-to-have) | Avoids a client-side product lookup against the sim instance |
| `estShippingCost` | BigDecimal | Per-routing and per-facility shipping-cost rollups; avg cost per order |

`estShippingCost` should be the same estimate the simulator already uses for the
group-level `outcomes.cost.totalShippingCost`, attributed per assignment. If only a
per-shipGroup estimate exists, attributing it to the first assignment of the ship
group is acceptable — the frontend sums per facility/routing, so attribution
granularity matters less than the total being consistent with `outcomes.cost`.

## Where

- Serializer: `ImpactPayloadSerializer.assignmentToMap()` — add the three fields.
- Surfaces that must carry them: the variation run response
  (`POST /variations/{vid}/simulation` -> `groupRunResult`) and the persisted
  `impactPayloadJson` (so the Phase 2 R4 items endpoint inherits them).

## Compatibility

Additive, optional fields — the frontend types them optional and degrades to the
current behavior (no products section, group-level-only cost note) when absent.
No version gate needed.

## Frontend follow-up once delivered

- Add `productId` / `productName` / `estShippingCost` to `OrderAssignment` in
  `src/types/variation.ts`.
- New `traceRollup` functions: `productRollup(traces)` and cost sums in
  `facilityRollup` / `compareFacilities`.
- Modal gains a "Products brokered" section; the facilities table gains a cost
  column; the cost note is replaced by real per-routing numbers.
```

- [ ] **Step 2: Commit (this file lives in the accxui repo — run git from `/Users/aditipatel/sandbox/accxui`)**

```bash
cd /Users/aditipatel/sandbox/accxui
git add docs/superpowers/specs/2026-06-12-trace-enrichment-backend-request.md
git commit -m "docs(sim): backend request — productId + estShippingCost on order-trace assignments"
cd apps/order-routing
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the full standalone test suite**

Run (from `apps/order-routing`):

```bash
for f in tests/*.test.ts; do npx tsx "$f" || echo "FAILED: $f"; done
```

Expected: every file prints its `... tests passed` line; no `FAILED:` lines. (Do NOT run `npm run lint`.)

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: completes cleanly.

- [ ] **Step 3: Verify working tree is clean and history is coherent**

Run: `git status --short && git log --oneline -8`
Expected: no unstaged leftovers from this work; commits from Tasks 1–7 present.
