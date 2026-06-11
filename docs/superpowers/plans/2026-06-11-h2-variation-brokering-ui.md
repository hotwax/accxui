# H2 Variation Brokering UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a what-if routing-simulation UI in the order-routing PWA that clones a real routing group into a server-side H2 "variation," edits it (routings, filters, rules, inventory conditions, actions) with immediate REST writes, runs a brokering simulation against it, and compares per-routing results against the parent group's live-config run.

**Architecture:** A new Pinia store (`variationStore`) backed by a thin REST service (`VariationService`) talks to the `sim-routing` component. A fresh, Circuit-free editor component (`VariationCanvas`) renders the variation tree directly in the contract's shape and emits edit intents the store turns into immediate writes. Results come from running the variation (synchronous endpoint) and the parent group (existing async job endpoint), joined per-routing by id suffix.

**Tech Stack:** Vue 3 + Ionic 8, Pinia 3 (setup-light/options style matching existing stores), TypeScript, `simApi()` (axios via `@common`), `node:assert` + `tsx` unit tests.

---

## Deviations from the approved spec (confirm before executing)

The spec assumed refactoring `SimulationCanvas` in place behind a field-rename adapter. During planning two facts changed that call:

1. **`SimulationCanvas` is coupled to the Circuit AI assistant.** Refactoring it to REST writes would entangle unrelated AI-draft code. → Build a new `VariationCanvas` instead; leave `SimulationCanvas` untouched until the guarded retirement phase. **Consequence:** the new variation editor does **not** carry over the in-editor AI draft assistant (the contract doesn't involve it). Flag for the user.
2. **Run results carry no `routingName`.** → Join parent↔variation by **id suffix**, names from the loaded trees.

Because the new editor speaks the contract shape natively, the spec's big `orderFilters`/`inventoryFilters` rename adapter is **not needed**; it collapses into small pure helpers in `variationTree.ts`.

---

## File structure

**New files:**
- `src/types/variation.ts` — types for the variation tree, list item, run result, compare rows.
- `src/services/VariationService.ts` — one function per `sim-routing` endpoint + pure URL/payload builders.
- `src/util/variationTree.ts` — pure helpers: placeholder detection, sequence sort, routing-name map, `stripVariationPrefix`, next-seq id.
- `src/util/routingResultJoin.ts` — pure parent↔variation per-routing join.
- `src/store/variationStore.ts` — Pinia store: list, open tree, optimistic edits, run + compare.
- `src/components/simulation/VariationList.vue` — variations-of-a-parent list + "New variation".
- `src/components/simulation/VariationCanvas.vue` — the editor (routings → filters → rules → conditions/actions).
- `src/components/simulation/VariationRunPanel.vue` — run controls + progress (variation indeterminate, parent real).
- `src/components/simulation/VariationCompareTable.vue` — per-routing parent-vs-variation results table.
- `src/views/VariationEditor.vue` — page at `/simulate/variation/:variationGroupId`.
- `tests/variationTree.test.ts`, `tests/routingResultJoin.test.ts`, `tests/variationService.test.ts`.

**Modified files:**
- `src/services/SimulationService.ts` — add `simRoutingApiBaseUrl()`; add `runParentLiveConfig()`.
- `.env.example` — add `VITE_SIM_ROUTING_API_BASE_URL`.
- `src/views/SimulationHome.vue` — group pick now opens the variations list, not the old editor.
- `src/router/index.ts` — add the `/simulate/variation/:variationGroupId` route.
- `src/locales/en.json` — new UI strings.

**Retired later (guarded phase 6):** `simulationStore.ts`, `simulationDiff.ts`, `simulationBatch.ts`, `VariationRail.vue`, `OutcomeHeadline.vue`, `TradeoffChart.vue`, `CompositeScorePanel.vue`, `ExpeditedPanel.vue`, `FulfillmentMixPanel.vue`, `StockoutPanel.vue`, `outcomes.ts`, `Simulation.vue`, `SimulationCanvas.vue`, and their tests.

---

## Conventions for the implementing engineer

- Run a single unit test with: `cd apps/order-routing && npx tsx tests/<name>.test.ts`. A passing file prints `... tests passed` and exits 0; a failure throws (non-zero exit). There is **no** Jest wiring — do not add any (see `CLAUDE.md`).
- Lint with `cd apps/order-routing && npm run lint`.
- All `sim-routing` calls go through `simApi({ baseURL: simRoutingApiBaseUrl(), ... })` — never raw axios. `simApi` handles api_key (two-instance) vs Bearer (single-instance) auth and one re-login retry.
- Ionic + CSS variables only (no custom HTML/CSS frameworks); see `.agent/rules/`. Reuse vars like `--spacer-base`, `--ion-color-medium`, `--ion-color-success`.
- Commit after each task with the message shown in its final step.
- `apps/order-routing` is its own git repo — run git commands from inside it.

---

# Phase 1 — Config + pure data layer (fully TDD)

### Task 1: Add the `sim-routing` base URL config

**Files:**
- Modify: `src/services/SimulationService.ts` (add after `simApiBaseUrl`, ~line 35)
- Modify: `.env.example` (after `VITE_SIM_API_BASE_URL`, ~line 28)

- [ ] **Step 1: Add the env var to `.env.example`**

Add below the existing `VITE_SIM_API_BASE_URL` line:

```bash
# Variation (what-if) API base URL — the sim-routing component on the SAME host as VITE_SIM_API_BASE_URL.
# Promoting UAT -> prod is a config change here, not code. api_key/Bearer auth is shared with simApi().
VITE_SIM_ROUTING_API_BASE_URL="https://asb-sim-uat.hotwax.io/rest/s1/sim-routing"
```

- [ ] **Step 2: Add the accessor in `SimulationService.ts`**

Insert after the `simApiBaseUrl` function (after ~line 35):

```typescript
/** Base URL for the sim-routing (variation / what-if) API. Same host as simApiBaseUrl()'s sim
 *  instance, different component prefix (`sim-routing`). One place to configure host + prefix so
 *  UAT -> prod is config, not code. Auth is unchanged — simApi() attaches api_key (two-instance) or
 *  the OMS Bearer (single-instance). Env is injectable for headless testing. */
export function simRoutingApiBaseUrl(env: Record<string, any> = import.meta.env): string {
  return ((env && env.VITE_SIM_ROUTING_API_BASE_URL) || "https://asb-sim-uat.hotwax.io/rest/s1/sim-routing").trim();
}
```

- [ ] **Step 3: Verify lint passes**

Run: `cd apps/order-routing && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd apps/order-routing
git add src/services/SimulationService.ts .env.example
git commit -m "feat(sim): add sim-routing variation API base URL config"
```

---

### Task 2: Variation types

**Files:**
- Create: `src/types/variation.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/types/variation.ts
// Shapes for the H2 variation (what-if) feature. Pure TS — no runtime imports, safe under `npx tsx`.

/** A scope filter (on a routing) or an inventory condition (on a rule). operator/fieldValue are null
 *  for an unset placeholder row the engine ignores. */
export interface VariationCondition {
  conditionSeqId: string;
  fieldName: string | null;
  operator: string | null;
  fieldValue: string | null;
  sequenceNum: number;
  conditionTypeEnumId?: string; // ENTCT_FILTER (default) | ENTCT_SORT_BY
}

/** A rule action — what the rule does (ORA_NEXT_RULE, ORA_MV_TO_QUEUE, ORA_AUTO_CANCEL_DAYS, ...). */
export interface VariationAction {
  actionSeqId: string;
  actionTypeEnumId: string;
  actionValue: string | null;
}

export interface VariationRule {
  routingRuleId: string;
  ruleName: string;
  statusId: string; // RULE_ACTIVE | RULE_DRAFT | RULE_ARCHIVED
  sequenceNum: number;
  assignmentEnumId?: string;
  inventoryConditions: VariationCondition[];
  actions: VariationAction[];
}

export interface VariationRouting {
  orderRoutingId: string; // re-keyed, e.g. VM100204_100008
  routingName: string;
  statusId: string; // ROUTING_ACTIVE | ROUTING_DRAFT | ROUTING_ARCHIVED
  sequenceNum: number;
  filters: VariationCondition[];
  rules: VariationRule[];
}

export interface VariationTree {
  variationGroupId: string;
  parentRoutingGroupId: string;
  productStoreId: string;
  variationName: string;
  statusId: string; // VAR_DRAFT ...
  routings: VariationRouting[];
}

export interface VariationListItem {
  variationGroupId: string;
  parentRoutingGroupId: string;
  productStoreId: string;
  variationName: string;
  statusId: string;
  createdDate: number;
  createdByUserId?: string;
}

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

export interface GroupRunResult {
  routingGroupId: string;
  productStoreId: string;
  attemptedItemCount: number;
  brokeredItemCount: number;
  queuedItemCount: number;
  routingResults: RoutingRunResult[];
}

/** One row of the parent-vs-variation comparison table. Either side may be null. */
export interface CompareRow {
  routingName: string;
  parentRoutingId: string | null;     // e.g. 100008
  variationRoutingId: string | null;  // e.g. VM100204_100008
  parent: RoutingRunResult | null;
  variation: RoutingRunResult | null;
}
```

- [ ] **Step 2: Verify it compiles under tsx**

Run: `cd apps/order-routing && npx tsx -e "import('./src/types/variation.ts').then(()=>console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
cd apps/order-routing
git add src/types/variation.ts
git commit -m "feat(sim): variation feature types"
```

---

### Task 3: `variationTree.ts` pure helpers (TDD)

**Files:**
- Create: `src/util/variationTree.ts`
- Test: `tests/variationTree.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/variationTree.test.ts
import assert from "node:assert";
import {
  isPlaceholder, sortBySequence, stripVariationPrefix, buildRoutingNameMap, nextSeqId,
} from "../src/util/variationTree";
import type { VariationTree } from "../src/types/variation";

// isPlaceholder: a condition with null operator AND null value is an unset placeholder.
assert.strictEqual(isPlaceholder({ conditionSeqId: "04", fieldName: "orderDate", operator: null, fieldValue: null, sequenceNum: 0 }), true);
assert.strictEqual(isPlaceholder({ conditionSeqId: "06", fieldName: "salesChannelEnumId", operator: "equals", fieldValue: "POS_SALES_CHANNEL", sequenceNum: 0 }), false);

// sortBySequence: ascending by sequenceNum, stable for ties.
assert.deepStrictEqual(
  sortBySequence([{ sequenceNum: 5, id: "a" }, { sequenceNum: 1, id: "b" }, { sequenceNum: 5, id: "c" }]).map((x: any) => x.id),
  ["b", "a", "c"],
);

// stripVariationPrefix: removes the "<variationGroupId>_" prefix to recover the parent routing id.
assert.strictEqual(stripVariationPrefix("VM100204", "VM100204_100008"), "100008");
assert.strictEqual(stripVariationPrefix("VM100204", "100008"), "100008"); // already bare -> unchanged

// buildRoutingNameMap: orderRoutingId -> routingName for every routing in a tree.
const tree: VariationTree = {
  variationGroupId: "VM100204", parentRoutingGroupId: "100001", productStoreId: "SM_STORE",
  variationName: "x", statusId: "VAR_DRAFT",
  routings: [
    { orderRoutingId: "VM100204_100008", routingName: "Standard", statusId: "ROUTING_ACTIVE", sequenceNum: 5, filters: [], rules: [] },
  ],
};
assert.deepStrictEqual(buildRoutingNameMap(tree), { "VM100204_100008": "Standard" });

// nextSeqId: returns a 2-digit zero-padded id one past the max numeric seqId present.
assert.strictEqual(nextSeqId([{ conditionSeqId: "01" }, { conditionSeqId: "06" }], "conditionSeqId"), "07");
assert.strictEqual(nextSeqId([], "conditionSeqId"), "01");
assert.strictEqual(nextSeqId([{ actionSeqId: "09" }], "actionSeqId"), "10");

console.log("variationTree tests passed");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/variationTree.test.ts`
Expected: FAIL — cannot find module `../src/util/variationTree`.

- [ ] **Step 3: Implement `variationTree.ts`**

```typescript
// src/util/variationTree.ts
// Pure helpers for the variation tree. No runtime imports beyond types — safe under `npx tsx`.
import type { VariationCondition, VariationTree } from "../types/variation";

/** A condition with no operator AND no value is an unset placeholder the engine ignores. */
export function isPlaceholder(c: Pick<VariationCondition, "operator" | "fieldValue">): boolean {
  return (c.operator === null || c.operator === undefined || c.operator === "") &&
         (c.fieldValue === null || c.fieldValue === undefined || c.fieldValue === "");
}

/** Stable ascending sort by `sequenceNum`. Returns a new array. */
export function sortBySequence<T extends { sequenceNum: number }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.sequenceNum - b.item.sequenceNum) || (a.i - b.i))
    .map(({ item }) => item);
}

/** Recover the parent routing id by removing the "<variationGroupId>_" prefix. No-op if absent. */
export function stripVariationPrefix(variationGroupId: string, orderRoutingId: string): string {
  const prefix = `${variationGroupId}_`;
  return orderRoutingId.startsWith(prefix) ? orderRoutingId.slice(prefix.length) : orderRoutingId;
}

/** Map every routing's orderRoutingId -> routingName for display. */
export function buildRoutingNameMap(tree: Pick<VariationTree, "routings">): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of tree.routings || []) map[r.orderRoutingId] = r.routingName;
  return map;
}

/** Next 2-digit zero-padded seq id (one past the max numeric value of `key`). "01" when empty. */
export function nextSeqId(items: Array<Record<string, any>>, key: string): string {
  const max = (items || []).reduce((m, it) => Math.max(m, parseInt(it[key], 10) || 0), 0);
  return String(max + 1).padStart(2, "0");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/variationTree.test.ts`
Expected: PASS — prints `variationTree tests passed`.

- [ ] **Step 5: Commit**

```bash
cd apps/order-routing
git add src/util/variationTree.ts tests/variationTree.test.ts
git commit -m "feat(sim): variation tree pure helpers"
```

---

### Task 4: `routingResultJoin.ts` parent↔variation join (TDD)

**Files:**
- Create: `src/util/routingResultJoin.ts`
- Test: `tests/routingResultJoin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/routingResultJoin.test.ts
import assert from "node:assert";
import { joinRoutingResults } from "../src/util/routingResultJoin";
import type { RoutingRunResult } from "../src/types/variation";

const r = (id: string, seq: number, elig: number): RoutingRunResult => ({
  orderRoutingId: id, sequenceNum: seq, eligibleEntryCount: elig,
  attemptedItemCount: elig, brokeredItemCount: 0, queuedItemCount: 0,
});

const variationResults = [r("VM100204_100008", 5, 150)];
const parentResults = [r("100008", 5, 0), r("100009", 6, 12)];
const routingNameById = { "VM100204_100008": "Standard", "100008": "Standard", "100009": "Express" };

const rows = joinRoutingResults({
  variationGroupId: "VM100204", parentResults, variationResults, routingNameById,
});

// One row per routing: matched pair (Standard) + parent-only (Express). Sorted by sequenceNum.
assert.strictEqual(rows.length, 2);

const standard = rows.find((x) => x.routingName === "Standard")!;
assert.strictEqual(standard.parentRoutingId, "100008");
assert.strictEqual(standard.variationRoutingId, "VM100204_100008");
assert.strictEqual(standard.parent!.eligibleEntryCount, 0);
assert.strictEqual(standard.variation!.eligibleEntryCount, 150);

const express = rows.find((x) => x.routingName === "Express")!;
assert.strictEqual(express.parentRoutingId, "100009");
assert.strictEqual(express.variationRoutingId, null);
assert.strictEqual(express.variation, null);

// Sorted by sequenceNum (Standard seq 5 before Express seq 6).
assert.deepStrictEqual(rows.map((x) => x.routingName), ["Standard", "Express"]);

console.log("routingResultJoin tests passed");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/routingResultJoin.test.ts`
Expected: FAIL — cannot find module `../src/util/routingResultJoin`.

- [ ] **Step 3: Implement `routingResultJoin.ts`**

```typescript
// src/util/routingResultJoin.ts
// Pure: join a variation run and the parent live-config run into per-routing compare rows.
// Run results carry orderRoutingId + counts but NO routingName, so we join by id suffix:
// variation "VM100204_100008" -> strip "VM100204_" -> "100008" == parent id. Names come from the trees.
import type { CompareRow, RoutingRunResult } from "../types/variation";
import { stripVariationPrefix } from "./variationTree";

export interface JoinArgs {
  variationGroupId: string;
  parentResults: RoutingRunResult[];
  variationResults: RoutingRunResult[];
  routingNameById: Record<string, string>; // both parent and variation ids -> name
}

export function joinRoutingResults(args: JoinArgs): CompareRow[] {
  const { variationGroupId, parentResults, variationResults, routingNameById } = args;
  const parentById = new Map(parentResults.map((p) => [p.orderRoutingId, p]));
  const seenParent = new Set<string>();
  const rows: CompareRow[] = [];

  // Variation rows first (they're the focus), matched to their parent by stripped id.
  for (const v of variationResults) {
    const parentId = stripVariationPrefix(variationGroupId, v.orderRoutingId);
    const parent = parentById.get(parentId) || null;
    if (parent) seenParent.add(parentId);
    rows.push({
      routingName: routingNameById[v.orderRoutingId] || routingNameById[parentId] || v.orderRoutingId,
      parentRoutingId: parent ? parentId : null,
      variationRoutingId: v.orderRoutingId,
      parent,
      variation: v,
    });
  }

  // Parent-only routings (active in parent, not present in the variation run).
  for (const p of parentResults) {
    if (seenParent.has(p.orderRoutingId)) continue;
    rows.push({
      routingName: routingNameById[p.orderRoutingId] || p.orderRoutingId,
      parentRoutingId: p.orderRoutingId,
      variationRoutingId: null,
      parent: p,
      variation: null,
    });
  }

  // Sort by the sequenceNum of whichever side exists (variation preferred).
  return rows.sort((a, b) => {
    const sa = a.variation?.sequenceNum ?? a.parent?.sequenceNum ?? 0;
    const sb = b.variation?.sequenceNum ?? b.parent?.sequenceNum ?? 0;
    return sa - sb;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/routingResultJoin.test.ts`
Expected: PASS — prints `routingResultJoin tests passed`.

- [ ] **Step 5: Commit**

```bash
cd apps/order-routing
git add src/util/routingResultJoin.ts tests/routingResultJoin.test.ts
git commit -m "feat(sim): per-routing parent-vs-variation join"
```

---

### Task 5: `VariationService` URL/payload builders (TDD) + endpoint functions

**Files:**
- Create: `src/services/VariationService.ts`
- Test: `tests/variationService.test.ts`

- [ ] **Step 1: Write the failing test (pure builders only)**

```typescript
// tests/variationService.test.ts
import assert from "node:assert";
import { variationRequests } from "../src/services/VariationService";

// listVariations
assert.deepStrictEqual(variationRequests.listVariations("100001"), {
  url: "variations", method: "GET", params: { parentRoutingGroupId: "100001" },
});

// createVariation (name optional)
assert.deepStrictEqual(variationRequests.createVariation("100001", "web standard"), {
  url: "routingGroups/100001/variations", method: "POST", data: { variationName: "web standard" },
});
assert.deepStrictEqual(variationRequests.createVariation("100001").data, {});

// getVariation
assert.deepStrictEqual(variationRequests.getVariation("VM100204"), {
  url: "variations/VM100204", method: "GET",
});

// setRouting
assert.deepStrictEqual(variationRequests.setRouting("VM100204", "VM100204_100008", { statusId: "ROUTING_ACTIVE" }), {
  url: "variations/VM100204/routings/VM100204_100008", method: "PUT", data: { statusId: "ROUTING_ACTIVE" },
});

// upsertFilter
assert.deepStrictEqual(
  variationRequests.upsertFilter("VM100204", "VM100204_100008", {
    conditionSeqId: "06", fieldName: "salesChannelEnumId", operator: "equals", fieldValue: "WEB_SALES_CHANNEL", sequenceNum: 6,
  }),
  {
    url: "variations/VM100204/routings/VM100204_100008/filters", method: "POST",
    data: { conditionSeqId: "06", fieldName: "salesChannelEnumId", operator: "equals", fieldValue: "WEB_SALES_CHANNEL", sequenceNum: 6 },
  },
);

// deleteFilter
assert.deepStrictEqual(variationRequests.deleteFilter("VM100204", "VM100204_100008", "06"), {
  url: "variations/VM100204/routings/VM100204_100008/filters/06", method: "DELETE",
});

// rule endpoints
assert.deepStrictEqual(variationRequests.setRule("VM100204", "VM100204_100008", "VM100204_100524", { sequenceNum: 3 }), {
  url: "variations/VM100204/routings/VM100204_100008/rules/VM100204_100524", method: "PUT", data: { sequenceNum: 3 },
});
assert.deepStrictEqual(
  variationRequests.upsertInventoryCondition("VM100204", "VM100204_100008", "VM100204_100524", {
    conditionSeqId: "99", fieldName: "facilityGroupId", operator: "equals", fieldValue: "PICKUP", sequenceNum: 99,
  }).url,
  "variations/VM100204/routings/VM100204_100008/rules/VM100204_100524/inventoryConditions",
);
assert.deepStrictEqual(
  variationRequests.deleteAction("VM100204", "VM100204_100008", "VM100204_100524", "99").url,
  "variations/VM100204/routings/VM100204_100008/rules/VM100204_100524/actions/99",
);

// runVariation (sampleCap optional)
assert.deepStrictEqual(variationRequests.runVariation("VM100204", 500), {
  url: "variations/VM100204/simulation", method: "POST", data: { sampleCap: 500 },
});
assert.deepStrictEqual(variationRequests.runVariation("VM100204").data, {});

console.log("variationService tests passed");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/variationService.test.ts`
Expected: FAIL — cannot find module `../src/services/VariationService`.

- [ ] **Step 3: Implement `VariationService.ts`**

```typescript
// src/services/VariationService.ts
// Thin REST layer for the sim-routing (variation / what-if) API. The pure `variationRequests` builders
// return axios-style configs (testable without network); the exported async functions add baseURL +
// auth via simApi() and unwrap/validate the response.
import { simApi, simRoutingApiBaseUrl } from "./SimulationService";
import type { GroupRunResult, VariationListItem, VariationTree } from "../types/variation";

export interface VariationConditionInput {
  conditionSeqId: string;
  fieldName: string;
  operator: string;
  fieldValue: string;
  sequenceNum: number;
  conditionTypeEnumId?: string;
}
export interface VariationActionInput {
  actionSeqId: string;
  actionTypeEnumId: string;
  actionValue: string | null;
}

/** Pure request builders — { url, method, params?, data? } relative to simRoutingApiBaseUrl(). */
export const variationRequests = {
  listVariations: (parentRoutingGroupId: string) =>
    ({ url: "variations", method: "GET", params: { parentRoutingGroupId } }),
  createVariation: (parentRoutingGroupId: string, variationName?: string) =>
    ({ url: `routingGroups/${parentRoutingGroupId}/variations`, method: "POST",
       data: variationName ? { variationName } : {} }),
  getVariation: (vid: string) => ({ url: `variations/${vid}`, method: "GET" }),
  setRouting: (vid: string, rid: string, patch: { statusId?: string; sequenceNum?: number }) =>
    ({ url: `variations/${vid}/routings/${rid}`, method: "PUT", data: patch }),
  upsertFilter: (vid: string, rid: string, cond: VariationConditionInput) =>
    ({ url: `variations/${vid}/routings/${rid}/filters`, method: "POST", data: cond }),
  deleteFilter: (vid: string, rid: string, seqId: string) =>
    ({ url: `variations/${vid}/routings/${rid}/filters/${seqId}`, method: "DELETE" }),
  setRule: (vid: string, rid: string, ruleId: string, patch: { statusId?: string; sequenceNum?: number }) =>
    ({ url: `variations/${vid}/routings/${rid}/rules/${ruleId}`, method: "PUT", data: patch }),
  upsertInventoryCondition: (vid: string, rid: string, ruleId: string, cond: VariationConditionInput) =>
    ({ url: `variations/${vid}/routings/${rid}/rules/${ruleId}/inventoryConditions`, method: "POST", data: cond }),
  deleteInventoryCondition: (vid: string, rid: string, ruleId: string, seqId: string) =>
    ({ url: `variations/${vid}/routings/${rid}/rules/${ruleId}/inventoryConditions/${seqId}`, method: "DELETE" }),
  upsertAction: (vid: string, rid: string, ruleId: string, action: VariationActionInput) =>
    ({ url: `variations/${vid}/routings/${rid}/rules/${ruleId}/actions`, method: "POST", data: action }),
  deleteAction: (vid: string, rid: string, ruleId: string, seqId: string) =>
    ({ url: `variations/${vid}/routings/${rid}/rules/${ruleId}/actions/${seqId}`, method: "DELETE" }),
  runVariation: (vid: string, sampleCap?: number) =>
    ({ url: `variations/${vid}/simulation`, method: "POST", data: sampleCap != null ? { sampleCap } : {} }),
};

async function call(req: { url: string; method: string; params?: any; data?: any }, timeout?: number): Promise<any> {
  const { commonUtil } = await import("@common");
  const resp: any = await simApi({ ...req, baseURL: simRoutingApiBaseUrl(), ...(timeout ? { timeout } : {}) });
  if (commonUtil.hasError(resp)) {
    throw new Error(`sim-routing ${req.method} ${req.url} failed: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
  }
  return resp.data;
}

export async function listVariations(parentRoutingGroupId: string): Promise<VariationListItem[]> {
  const data = await call(variationRequests.listVariations(parentRoutingGroupId));
  return data?.variationList ?? [];
}
export async function createVariation(parentRoutingGroupId: string, variationName?: string): Promise<string> {
  const data = await call(variationRequests.createVariation(parentRoutingGroupId, variationName));
  if (!data?.variationGroupId) throw new Error(`createVariation returned no id: ${JSON.stringify(data)?.slice(0, 200)}`);
  return data.variationGroupId;
}
export async function getVariation(vid: string): Promise<VariationTree> {
  const data = await call(variationRequests.getVariation(vid));
  if (!data?.variation?.variationGroupId) throw new Error(`Variation ${vid} could not be loaded.`);
  return data.variation;
}
export const setRouting = (vid: string, rid: string, patch: { statusId?: string; sequenceNum?: number }) =>
  call(variationRequests.setRouting(vid, rid, patch));
export const upsertFilter = (vid: string, rid: string, cond: VariationConditionInput) =>
  call(variationRequests.upsertFilter(vid, rid, cond));
export const deleteFilter = (vid: string, rid: string, seqId: string) =>
  call(variationRequests.deleteFilter(vid, rid, seqId));
export const setRule = (vid: string, rid: string, ruleId: string, patch: { statusId?: string; sequenceNum?: number }) =>
  call(variationRequests.setRule(vid, rid, ruleId, patch));
export const upsertInventoryCondition = (vid: string, rid: string, ruleId: string, cond: VariationConditionInput) =>
  call(variationRequests.upsertInventoryCondition(vid, rid, ruleId, cond));
export const deleteInventoryCondition = (vid: string, rid: string, ruleId: string, seqId: string) =>
  call(variationRequests.deleteInventoryCondition(vid, rid, ruleId, seqId));
export const upsertAction = (vid: string, rid: string, ruleId: string, action: VariationActionInput) =>
  call(variationRequests.upsertAction(vid, rid, ruleId, action));
export const deleteAction = (vid: string, rid: string, ruleId: string, seqId: string) =>
  call(variationRequests.deleteAction(vid, rid, ruleId, seqId));

/** Run the variation. Synchronous, ~25–150s — long client timeout. Returns the GroupRunResult. */
export async function runVariation(vid: string, sampleCap?: number): Promise<GroupRunResult> {
  const data = await call(variationRequests.runVariation(vid, sampleCap), 200_000);
  if (!data?.groupRunResult) throw new Error(`Variation run returned no result: ${JSON.stringify(data)?.slice(0, 200)}`);
  return data.groupRunResult;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/variationService.test.ts`
Expected: PASS — prints `variationService tests passed`.

- [ ] **Step 5: Commit**

```bash
cd apps/order-routing
git add src/services/VariationService.ts tests/variationService.test.ts
git commit -m "feat(sim): VariationService REST layer + request builders"
```

---

### Task 6: `runParentLiveConfig` — parent group run via the existing job endpoint

**Files:**
- Modify: `src/services/SimulationService.ts` (append after `pollJob`, ~line 185)

- [ ] **Step 1: Add the helper**

The parent comparison run reuses the existing async job endpoint. Submitting an **empty** `variants` array yields the baseline `groupRun` (see the `JobStatusResponse.groupRun` contract note: "parsed Map when no variants were sent"). Append:

```typescript
/** Run the parent group's live config (no variants) via the existing job endpoint, returning its
 *  GroupRunResult. Reuses submitBatch (empty variants -> baseline groupRun) + pollJob for live
 *  progress. `onProgress` receives each progress tick for the parent-side progress bar. */
export async function runParentLiveConfig(
  parentRoutingGroupId: string,
  sampleCap: number | undefined,
  onProgress?: (progress: GroupRunProgress) => void,
): Promise<any> {
  const jobId = await submitBatch({ routingGroupId: parentRoutingGroupId, variants: [], sampleCap });
  const result = await pollJob(parentRoutingGroupId, jobId, undefined, onProgress);
  return (result as any).groupRun ?? (result as any).variation ?? result;
}
```

- [ ] **Step 2: Verify lint + type-check via tsx import**

Run: `cd apps/order-routing && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd apps/order-routing
git add src/services/SimulationService.ts
git commit -m "feat(sim): runParentLiveConfig for variation comparison baseline"
```

---

# Phase 2 — Store

### Task 7: `variationStore` — list, create, open

**Files:**
- Create: `src/store/variationStore.ts`

- [ ] **Step 1: Write the store scaffold with list/create/open actions**

```typescript
// src/store/variationStore.ts
import { acceptHMRUpdate, defineStore } from "pinia";
import { logger } from "@common";
import { productStore } from "./productStore";
import {
  listVariations, createVariation, getVariation, runVariation,
  setRouting, upsertFilter, deleteFilter, setRule,
  upsertInventoryCondition, deleteInventoryCondition, upsertAction, deleteAction,
  type VariationConditionInput, type VariationActionInput,
} from "../services/VariationService";
import { runParentLiveConfig, simProductStoreId } from "../services/SimulationService";
import { joinRoutingResults } from "../util/routingResultJoin";
import { buildRoutingNameMap, sortBySequence } from "../util/variationTree";
import type {
  CompareRow, GroupRunResult, VariationListItem, VariationTree, VariationRouting, VariationRule,
} from "../types/variation";

const deepClone = (o: any) => JSON.parse(JSON.stringify(o ?? {}));

export const variationStore = defineStore("variation", {
  state: () => ({
    parentRoutingGroupId: "" as string,
    variations: [] as VariationListItem[],
    listLoading: false,
    tree: null as VariationTree | null,
    loadError: null as string | null,
    // Per-node saving status keyed by a stable node key (routingId / routingId:ruleId / ...:seqId).
    saving: {} as Record<string, "saving" | "error">,
    // Run + compare state.
    isRunningVariation: false,
    isRunningParent: false,
    variationResult: null as GroupRunResult | null,
    parentResultByParentId: {} as Record<string, GroupRunResult>, // session cache, keyed by parent id
    runError: null as string | null,
    parentProgress: null as any,
  }),
  getters: {
    routingNameById: (s): Record<string, string> => (s.tree ? buildRoutingNameMap(s.tree) : {}),
    // Active routings first (sorted), then draft, then archived — matches editor grouping.
    sortedRoutings: (s): VariationRouting[] => (s.tree ? sortBySequence(s.tree.routings) : []),
    compareRows(s): CompareRow[] {
      const parent = s.parentResultByParentId[s.parentRoutingGroupId];
      if (!s.variationResult || !parent) return [];
      return joinRoutingResults({
        variationGroupId: s.variationResult.routingGroupId,
        parentResults: parent.routingResults,
        variationResults: s.variationResult.routingResults,
        routingNameById: this.routingNameById,
      });
    },
  },
  actions: {
    resolveProductStoreId(prefer?: string): string {
      return simProductStoreId() || prefer || productStore().getCurrentEComStore?.productStoreId || "";
    },
    async fetchVariations(parentRoutingGroupId: string) {
      this.parentRoutingGroupId = parentRoutingGroupId;
      this.listLoading = true;
      try {
        this.variations = await listVariations(parentRoutingGroupId);
      } catch (err) {
        logger.error(err);
        this.variations = [];
      } finally {
        this.listLoading = false;
      }
    },
    async createVariation(parentRoutingGroupId: string, variationName?: string): Promise<string | null> {
      try {
        const vid = await createVariation(parentRoutingGroupId, variationName);
        await this.fetchVariations(parentRoutingGroupId);
        return vid;
      } catch (err: any) {
        logger.error(err);
        this.loadError = err?.message ?? "Failed to create variation.";
        return null;
      }
    },
    async openVariation(vid: string) {
      this.loadError = null;
      this.tree = null;
      this.variationResult = null;
      this.runError = null;
      try {
        this.tree = await getVariation(vid);
        this.parentRoutingGroupId = this.tree.parentRoutingGroupId;
      } catch (e: any) {
        this.loadError = e?.message ?? "Failed to load variation.";
      }
    },
    // --- edit actions added in Task 8, run actions in Task 9 ---
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(variationStore, import.meta.hot));
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd apps/order-routing && npx tsx -e "import('./src/store/variationStore.ts').then(()=>console.log('ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `ok` (Pinia/`@common` import side-effects resolve under tsx; if `@common` cannot resolve in tsx, instead verify with `npm run lint` showing no errors in the file).

- [ ] **Step 3: Commit**

```bash
cd apps/order-routing
git add src/store/variationStore.ts
git commit -m "feat(sim): variationStore — list, create, open"
```

---

### Task 8: `variationStore` — optimistic edit actions

**Files:**
- Modify: `src/store/variationStore.ts` (add actions where the Task 7 comment marks)

- [ ] **Step 1: Add helper + edit actions**

Replace the `// --- edit actions ... ---` comment with these actions. They mutate the local tree first (optimistic), call the service, and on failure re-`GET` the tree to resync (simplest correct revert) and set an error flag.

```typescript
    _findRouting(rid: string): VariationRouting | undefined {
      return this.tree?.routings.find((r) => r.orderRoutingId === rid);
    },
    _findRule(rid: string, ruleId: string): VariationRule | undefined {
      return this._findRouting(rid)?.rules.find((x) => x.routingRuleId === ruleId);
    },
    async _withSave(key: string, optimistic: () => void, persist: () => Promise<any>) {
      const vid = this.tree?.variationGroupId;
      if (!vid) return;
      this.saving = { ...this.saving, [key]: "saving" };
      const snapshot = deepClone(this.tree);
      try {
        optimistic();
        await persist();
        const next = { ...this.saving }; delete next[key]; this.saving = next;
      } catch (err: any) {
        logger.error(err);
        this.tree = snapshot; // revert
        this.saving = { ...this.saving, [key]: "error" };
      }
    },

    setRoutingStatus(rid: string, statusId: string) {
      return this._withSave(`routing:${rid}`,
        () => { const r = this._findRouting(rid); if (r) r.statusId = statusId; },
        () => setRouting(this.tree!.variationGroupId, rid, { statusId }));
    },
    reorderRoutings(orderedIds: string[]) {
      const vid = this.tree!.variationGroupId;
      orderedIds.forEach((rid, i) => {
        const r = this._findRouting(rid); if (r) r.sequenceNum = i;
        void setRouting(vid, rid, { sequenceNum: i }).catch((e) => logger.error(e));
      });
    },
    upsertFilter(rid: string, cond: VariationConditionInput) {
      return this._withSave(`filter:${rid}:${cond.conditionSeqId}`,
        () => {
          const r = this._findRouting(rid); if (!r) return;
          const existing = r.filters.find((f) => f.conditionSeqId === cond.conditionSeqId);
          if (existing) Object.assign(existing, cond); else r.filters.push({ ...cond });
        },
        () => upsertFilter(this.tree!.variationGroupId, rid, cond));
    },
    removeFilter(rid: string, seqId: string) {
      return this._withSave(`filter:${rid}:${seqId}`,
        () => { const r = this._findRouting(rid); if (r) r.filters = r.filters.filter((f) => f.conditionSeqId !== seqId); },
        () => deleteFilter(this.tree!.variationGroupId, rid, seqId));
    },
    setRuleStatus(rid: string, ruleId: string, statusId: string) {
      return this._withSave(`rule:${ruleId}`,
        () => { const rl = this._findRule(rid, ruleId); if (rl) rl.statusId = statusId; },
        () => setRule(this.tree!.variationGroupId, rid, ruleId, { statusId }));
    },
    reorderRules(rid: string, orderedRuleIds: string[]) {
      const vid = this.tree!.variationGroupId;
      orderedRuleIds.forEach((ruleId, i) => {
        const rl = this._findRule(rid, ruleId); if (rl) rl.sequenceNum = i;
        void setRule(vid, rid, ruleId, { sequenceNum: i }).catch((e) => logger.error(e));
      });
    },
    upsertInventoryCondition(rid: string, ruleId: string, cond: VariationConditionInput) {
      return this._withSave(`invcond:${ruleId}:${cond.conditionSeqId}`,
        () => {
          const rl = this._findRule(rid, ruleId); if (!rl) return;
          const ex = rl.inventoryConditions.find((c) => c.conditionSeqId === cond.conditionSeqId);
          if (ex) Object.assign(ex, cond); else rl.inventoryConditions.push({ ...cond });
        },
        () => upsertInventoryCondition(this.tree!.variationGroupId, rid, ruleId, cond));
    },
    removeInventoryCondition(rid: string, ruleId: string, seqId: string) {
      return this._withSave(`invcond:${ruleId}:${seqId}`,
        () => { const rl = this._findRule(rid, ruleId); if (rl) rl.inventoryConditions = rl.inventoryConditions.filter((c) => c.conditionSeqId !== seqId); },
        () => deleteInventoryCondition(this.tree!.variationGroupId, rid, ruleId, seqId));
    },
    upsertAction(rid: string, ruleId: string, action: VariationActionInput) {
      return this._withSave(`action:${ruleId}:${action.actionSeqId}`,
        () => {
          const rl = this._findRule(rid, ruleId); if (!rl) return;
          const ex = rl.actions.find((a) => a.actionSeqId === action.actionSeqId);
          if (ex) Object.assign(ex, action); else rl.actions.push({ ...action });
        },
        () => upsertAction(this.tree!.variationGroupId, rid, ruleId, action));
    },
    removeAction(rid: string, ruleId: string, seqId: string) {
      return this._withSave(`action:${ruleId}:${seqId}`,
        () => { const rl = this._findRule(rid, ruleId); if (rl) rl.actions = rl.actions.filter((a) => a.actionSeqId !== seqId); },
        () => deleteAction(this.tree!.variationGroupId, rid, ruleId, seqId));
    },
```

- [ ] **Step 2: Verify lint passes**

Run: `cd apps/order-routing && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd apps/order-routing
git add src/store/variationStore.ts
git commit -m "feat(sim): variationStore optimistic edit actions"
```

---

### Task 9: `variationStore` — run + compare actions

**Files:**
- Modify: `src/store/variationStore.ts`

- [ ] **Step 1: Add run actions after the edit actions**

```typescript
    async runComparison(sampleCap = 500) {
      const tree = this.tree;
      if (!tree) return;
      this.runError = null;
      this.variationResult = null;
      this.isRunningVariation = true;
      // Parent run only if not already cached for this parent (it's stable).
      const needParent = !this.parentResultByParentId[tree.parentRoutingGroupId];
      if (needParent) { this.isRunningParent = true; this.parentProgress = null; }
      try {
        const [variation] = await Promise.all([
          runVariation(tree.variationGroupId, sampleCap).finally(() => { this.isRunningVariation = false; }),
          needParent
            ? runParentLiveConfig(tree.parentRoutingGroupId, sampleCap, (p) => { this.parentProgress = p; })
                .then((gr) => { this.parentResultByParentId[tree.parentRoutingGroupId] = gr; })
                .catch((e) => { logger.error(e); }) // parent failure -> variation-only view
                .finally(() => { this.isRunningParent = false; })
            : Promise.resolve(),
        ]);
        this.variationResult = variation;
      } catch (e: any) {
        this.runError = e?.message ?? "Simulation run failed.";
      } finally {
        this.isRunningVariation = false;
        this.isRunningParent = false;
      }
    },
    async rerunParent(sampleCap = 500) {
      const tree = this.tree;
      if (!tree) return;
      delete this.parentResultByParentId[tree.parentRoutingGroupId];
      this.isRunningParent = true;
      this.parentProgress = null;
      try {
        const gr = await runParentLiveConfig(tree.parentRoutingGroupId, sampleCap, (p) => { this.parentProgress = p; });
        this.parentResultByParentId[tree.parentRoutingGroupId] = gr;
      } catch (e) {
        logger.error(e);
      } finally {
        this.isRunningParent = false;
      }
    },
```

- [ ] **Step 2: Verify lint passes**

Run: `cd apps/order-routing && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd apps/order-routing
git add src/store/variationStore.ts
git commit -m "feat(sim): variationStore run + compare actions"
```

---

# Phase 3 — Editor UI

> Vue components below give a concrete skeleton (real Ionic components, real store bindings, exact handler→action wiring). The engineer fills visual detail to match sibling components (e.g. `PastSimulationsList.vue`) but must keep the named props/emits/handlers exactly as written so later tasks line up. Add every user-facing string to `src/locales/en.json` via `translate("...")`.

### Task 10: `VariationList.vue` — variations of a parent + create

**Files:**
- Create: `src/components/simulation/VariationList.vue`

- [ ] **Step 1: Implement the component**

```vue
<template>
  <ion-list>
    <ion-list-header>
      <ion-label>{{ translate("Variations of") }} {{ parentName || parentRoutingGroupId }}</ion-label>
      <ion-button size="small" @click="openCreate">{{ translate("New variation") }}</ion-button>
    </ion-list-header>

    <ion-note v-if="!store.listLoading && !store.variations.length" class="ion-padding">
      {{ translate("No variations yet. Create one to start a what-if.") }}
    </ion-note>
    <ion-spinner v-if="store.listLoading" name="dots" />

    <ion-item
      v-for="v in store.variations"
      :key="v.variationGroupId"
      button
      @click="open(v.variationGroupId)"
    >
      <ion-label>
        <h2>{{ v.variationName || v.variationGroupId }}</h2>
        <p>{{ v.variationGroupId }}</p>
      </ion-label>
    </ion-item>

    <ion-note class="ion-padding-horizontal note-accumulate">
      {{ translate("Variations can't be deleted yet, so they accumulate.") }}
    </ion-note>
  </ion-list>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { translate } from "@common";
import { alertController, IonButton, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSpinner } from "@ionic/vue";
import { variationStore } from "@/store/variationStore";
import router from "@/router";

const props = defineProps<{ parentRoutingGroupId: string; parentName?: string }>();
const store = variationStore();

onMounted(() => store.fetchVariations(props.parentRoutingGroupId));

function open(vid: string) {
  router.push(`/simulate/variation/${vid}`);
}

async function openCreate() {
  const alert = await alertController.create({
    header: translate("New variation"),
    inputs: [{ name: "variationName", type: "text", placeholder: translate("Name (optional)") }],
    buttons: [
      { text: translate("Cancel"), role: "cancel" },
      {
        text: translate("Create"),
        handler: async (data: any) => {
          const vid = await store.createVariation(props.parentRoutingGroupId, (data?.variationName || "").trim() || undefined);
          if (vid) open(vid);
        },
      },
    ],
  });
  await alert.present();
}
</script>

<style scoped>
.note-accumulate { display: block; color: var(--ion-color-medium); font-size: 0.8rem; }
</style>
```

- [ ] **Step 2: Add the new strings to `src/locales/en.json`**

Add keys (alphabetical position per the file's convention): `"Variations of"`, `"New variation"` (may already exist), `"No variations yet. Create one to start a what-if."`, `"Name (optional)"`, `"Create"`, `"Variations can't be deleted yet, so they accumulate."`. Run `npm run i18n:report` to confirm none are missing.

- [ ] **Step 3: Verify lint passes**

Run: `cd apps/order-routing && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd apps/order-routing
git add src/components/simulation/VariationList.vue src/locales/en.json
git commit -m "feat(sim): VariationList — variations of a parent + create"
```

---

### Task 11: `VariationCanvas.vue` — the editor

**Files:**
- Create: `src/components/simulation/VariationCanvas.vue`

This renders the loaded tree (`store.tree`) and wires each control to a store edit action. Reuse `simReferenceStore` for value dropdowns where the `fieldName` matches a known reference set; free-text otherwise.

- [ ] **Step 1: Implement the editor skeleton**

```vue
<template>
  <div v-if="store.tree" class="variation-canvas">
    <ion-list-header>
      <ion-label>
        <h2>{{ store.tree.variationName || store.tree.variationGroupId }}</h2>
        <p>{{ translate("Parent group") }}: {{ store.tree.parentRoutingGroupId }}</p>
      </ion-label>
    </ion-list-header>

    <!-- Routings (active + draft first; archived collapsed). Only ROUTING_ACTIVE run. -->
    <ion-reorder-group :disabled="false" @ionItemReorder="onRoutingReorder($event)">
      <ion-card v-for="routing in store.sortedRoutings" :key="routing.orderRoutingId">
        <ion-card-header>
          <div class="row">
            <ion-card-title>{{ routing.routingName }}</ion-card-title>
            <ion-toggle
              :checked="routing.statusId === 'ROUTING_ACTIVE'"
              @ionChange="onRoutingToggle(routing.orderRoutingId, $event.detail.checked)"
            >{{ translate("Active") }}</ion-toggle>
            <ion-spinner v-if="store.saving['routing:' + routing.orderRoutingId] === 'saving'" name="dots" />
            <ion-icon v-else-if="store.saving['routing:' + routing.orderRoutingId] === 'error'" :icon="alertCircleOutline" color="danger" />
            <ion-reorder />
          </div>
        </ion-card-header>
        <ion-card-content>
          <!-- Filters: which orders this routing considers -->
          <h3>{{ translate("Filters") }} <ion-note>{{ translate("which orders") }}</ion-note></h3>
          <variation-condition-rows
            kind="filter"
            :routing-id="routing.orderRoutingId"
            :conditions="routing.filters"
          />

          <!-- Rules: how the routing brokers -->
          <h3>{{ translate("Rules") }} <ion-note>{{ translate("how it brokers") }}</ion-note></h3>
          <div v-for="rule in sortRules(routing.rules)" :key="rule.routingRuleId" class="rule">
            <div class="row">
              <span>{{ rule.ruleName }}</span>
              <ion-toggle
                :checked="rule.statusId === 'RULE_ACTIVE'"
                @ionChange="onRuleToggle(routing.orderRoutingId, rule.routingRuleId, $event.detail.checked)"
              >{{ translate("Active") }}</ion-toggle>
            </div>
            <h4>{{ translate("Inventory conditions") }}</h4>
            <variation-condition-rows
              kind="invcond"
              :routing-id="routing.orderRoutingId"
              :rule-id="rule.routingRuleId"
              :conditions="rule.inventoryConditions"
            />
            <h4>{{ translate("Actions") }}</h4>
            <variation-action-rows
              :routing-id="routing.orderRoutingId"
              :rule-id="rule.routingRuleId"
              :actions="rule.actions"
            />
          </div>
        </ion-card-content>
      </ion-card>
    </ion-reorder-group>
  </div>
</template>

<script setup lang="ts">
import { translate } from "@common";
import { alertCircleOutline } from "ionicons/icons";
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonIcon, IonLabel, IonListHeader,
  IonNote, IonReorder, IonReorderGroup, IonSpinner, IonToggle,
} from "@ionic/vue";
import { variationStore } from "@/store/variationStore";
import { sortBySequence } from "@/util/variationTree";
import VariationConditionRows from "./VariationConditionRows.vue";
import VariationActionRows from "./VariationActionRows.vue";

const store = variationStore();
const sortRules = (rules: any[]) => sortBySequence(rules);

function onRoutingToggle(rid: string, checked: boolean) {
  store.setRoutingStatus(rid, checked ? "ROUTING_ACTIVE" : "ROUTING_DRAFT");
}
function onRuleToggle(rid: string, ruleId: string, checked: boolean) {
  store.setRuleStatus(rid, ruleId, checked ? "RULE_ACTIVE" : "RULE_DRAFT");
}
function onRoutingReorder(ev: CustomEvent) {
  const ids = store.sortedRoutings.map((r) => r.orderRoutingId);
  const moved = ev.detail.complete(ids) as string[];
  store.reorderRoutings(moved);
}
</script>

<style scoped>
.variation-canvas .row { display: flex; align-items: center; gap: var(--spacer-sm); justify-content: space-between; }
.rule { border-left: 2px solid var(--ion-color-light-shade); padding-left: var(--spacer-sm); margin: var(--spacer-sm) 0; }
</style>
```

- [ ] **Step 2: Add the new strings to `en.json`** (`"Parent group"`, `"Active"`, `"Filters"`, `"which orders"`, `"Rules"`, `"how it brokers"`, `"Inventory conditions"`, `"Actions"`) and run `npm run i18n:report`.

- [ ] **Step 3: Verify lint passes** (it will error on the two not-yet-created child components — that's expected; they're Task 12. To check this file in isolation, temporarily comment the two imports, lint, then restore. Do not commit with them commented.)

- [ ] **Step 4: Commit**

```bash
cd apps/order-routing
git add src/components/simulation/VariationCanvas.vue src/locales/en.json
git commit -m "feat(sim): VariationCanvas editor skeleton"
```

---

### Task 12: `VariationConditionRows.vue` + `VariationActionRows.vue`

**Files:**
- Create: `src/components/simulation/VariationConditionRows.vue`
- Create: `src/components/simulation/VariationActionRows.vue`

`VariationConditionRows` renders filters (kind `filter`) or inventory conditions (kind `invcond`) and routes upsert/remove to the right store action based on `kind`. Reuse `simReferenceStore` for value options.

- [ ] **Step 1: Implement `VariationConditionRows.vue`**

```vue
<template>
  <div class="cond-rows">
    <div v-for="c in conditions" :key="c.conditionSeqId" class="cond-row" :class="{ placeholder: isPlaceholder(c) }">
      <ion-input
        :value="c.fieldName"
        :placeholder="translate('field')"
        @ionBlur="commit(c, 'fieldName', $event)"
      />
      <ion-select :value="c.operator || 'equals'" interface="popover" @ionChange="commit(c, 'operator', $event)">
        <ion-select-option value="equals">=</ion-select-option>
        <ion-select-option value="in">in</ion-select-option>
        <ion-select-option value="not-equals">≠</ion-select-option>
        <ion-select-option value="not-in">not in</ion-select-option>
      </ion-select>
      <ion-input :value="c.fieldValue" :placeholder="translate('value')" @ionBlur="commit(c, 'fieldValue', $event)" />
      <ion-button fill="clear" color="danger" @click="remove(c.conditionSeqId)">
        <ion-icon :icon="trashOutline" />
      </ion-button>
      <ion-spinner v-if="saveStatus(c.conditionSeqId) === 'saving'" name="dots" />
    </div>
    <ion-button size="small" fill="outline" @click="add">{{ translate("Add condition") }}</ion-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";
import { trashOutline } from "ionicons/icons";
import { IonButton, IonIcon, IonInput, IonSelect, IonSelectOption, IonSpinner } from "@ionic/vue";
import { variationStore } from "@/store/variationStore";
import { isPlaceholder, nextSeqId } from "@/util/variationTree";
import type { VariationCondition } from "@/types/variation";

const props = defineProps<{
  kind: "filter" | "invcond";
  routingId: string;
  ruleId?: string;
  conditions: VariationCondition[];
}>();
const store = variationStore();

const keyPrefix = computed(() => (props.kind === "filter" ? `filter:${props.routingId}` : `invcond:${props.ruleId}`));
const saveStatus = (seqId: string) => store.saving[`${keyPrefix.value}:${seqId}`];

function buildInput(c: VariationCondition, field: string, ev: any): any {
  const value = ev?.target?.value ?? ev?.detail?.value ?? null;
  return {
    conditionSeqId: c.conditionSeqId,
    fieldName: field === "fieldName" ? value : (c.fieldName ?? ""),
    operator: field === "operator" ? value : (c.operator ?? "equals"),
    fieldValue: field === "fieldValue" ? value : (c.fieldValue ?? ""),
    sequenceNum: c.sequenceNum,
  };
}

function commit(c: VariationCondition, field: string, ev: any) {
  const input = buildInput(c, field, ev);
  if (props.kind === "filter") store.upsertFilter(props.routingId, input);
  else store.upsertInventoryCondition(props.routingId, props.ruleId!, input);
}

function remove(seqId: string) {
  if (props.kind === "filter") store.removeFilter(props.routingId, seqId);
  else store.removeInventoryCondition(props.routingId, props.ruleId!, seqId);
}

function add() {
  const seqId = nextSeqId(props.conditions, "conditionSeqId");
  const input = { conditionSeqId: seqId, fieldName: "", operator: "equals", fieldValue: "", sequenceNum: props.conditions.length };
  if (props.kind === "filter") store.upsertFilter(props.routingId, input);
  else store.upsertInventoryCondition(props.routingId, props.ruleId!, input);
}
</script>

<style scoped>
.cond-row { display: flex; align-items: center; gap: var(--spacer-sm); }
.cond-row.placeholder { opacity: 0.55; }
</style>
```

- [ ] **Step 2: Implement `VariationActionRows.vue`**

```vue
<template>
  <div class="action-rows">
    <div v-for="a in actions" :key="a.actionSeqId" class="action-row">
      <ion-input :value="a.actionTypeEnumId" :placeholder="translate('action type')" @ionBlur="commit(a, 'actionTypeEnumId', $event)" />
      <ion-input :value="a.actionValue" :placeholder="translate('value')" @ionBlur="commit(a, 'actionValue', $event)" />
      <ion-button fill="clear" color="danger" @click="remove(a.actionSeqId)"><ion-icon :icon="trashOutline" /></ion-button>
      <ion-spinner v-if="store.saving['action:' + ruleId + ':' + a.actionSeqId] === 'saving'" name="dots" />
    </div>
    <ion-button size="small" fill="outline" @click="add">{{ translate("Add action") }}</ion-button>
  </div>
</template>

<script setup lang="ts">
import { translate } from "@common";
import { trashOutline } from "ionicons/icons";
import { IonButton, IonIcon, IonInput, IonSpinner } from "@ionic/vue";
import { variationStore } from "@/store/variationStore";
import { nextSeqId } from "@/util/variationTree";
import type { VariationAction } from "@/types/variation";

const props = defineProps<{ routingId: string; ruleId: string; actions: VariationAction[] }>();
const store = variationStore();

function commit(a: VariationAction, field: string, ev: any) {
  const value = ev?.target?.value ?? ev?.detail?.value ?? null;
  store.upsertAction(props.routingId, props.ruleId, {
    actionSeqId: a.actionSeqId,
    actionTypeEnumId: field === "actionTypeEnumId" ? value : a.actionTypeEnumId,
    actionValue: field === "actionValue" ? value : a.actionValue,
  });
}
function remove(seqId: string) { store.removeAction(props.routingId, props.ruleId, seqId); }
function add() {
  const seqId = nextSeqId(props.actions, "actionSeqId");
  store.upsertAction(props.routingId, props.ruleId, { actionSeqId: seqId, actionTypeEnumId: "ORA_NEXT_RULE", actionValue: null });
}
</script>

<style scoped>
.action-row { display: flex; align-items: center; gap: var(--spacer-sm); }
</style>
```

- [ ] **Step 3: Add strings** (`"field"`, `"value"`, `"Add condition"`, `"action type"`, `"Add action"`) to `en.json`; run `npm run i18n:report`.

- [ ] **Step 4: Verify lint passes (now `VariationCanvas` resolves its children too)**

Run: `cd apps/order-routing && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd apps/order-routing
git add src/components/simulation/VariationConditionRows.vue src/components/simulation/VariationActionRows.vue src/locales/en.json
git commit -m "feat(sim): variation condition + action row editors"
```

---

# Phase 4 — Run + compare UI

### Task 13: `VariationCompareTable.vue`

**Files:**
- Create: `src/components/simulation/VariationCompareTable.vue`

- [ ] **Step 1: Implement the compare table**

```vue
<template>
  <ion-list>
    <ion-list-header><ion-label>{{ translate("Per-routing results") }}</ion-label></ion-list-header>
    <ion-item v-for="row in rows" :key="row.routingName + (row.variationRoutingId || row.parentRoutingId)">
      <ion-label>
        <h3>{{ row.routingName }}</h3>
        <div class="cmp">
          <span class="metric">
            <span class="lbl">{{ translate("Eligible") }}</span>
            <span class="val">{{ n(row.parent?.eligibleEntryCount) }} → <strong>{{ n(row.variation?.eligibleEntryCount) }}</strong></span>
          </span>
          <span class="metric">
            <span class="lbl">{{ translate("Brokered") }}</span>
            <span class="val">{{ n(row.parent?.brokeredItemCount) }} → {{ n(row.variation?.brokeredItemCount) }}</span>
          </span>
          <span class="metric">
            <span class="lbl">{{ translate("Queued") }}</span>
            <span class="val">{{ n(row.parent?.queuedItemCount) }} → {{ n(row.variation?.queuedItemCount) }}</span>
          </span>
        </div>
        <p v-if="signal(row)" :class="signalClass(row)">{{ signal(row) }}</p>
      </ion-label>
    </ion-item>
  </ion-list>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";
import { IonItem, IonLabel, IonList, IonListHeader } from "@ionic/vue";
import { variationStore } from "@/store/variationStore";
import type { CompareRow } from "@/types/variation";

const store = variationStore();
const rows = computed<CompareRow[]>(() => store.compareRows);
const n = (v: number | undefined) => (v == null ? "—" : String(v));

// Distinguish "filtered out" (0 eligible) from "no inventory" (N eligible, 0 brokered).
function signal(row: CompareRow): string {
  const v = row.variation;
  if (!v) return translate("Not run in this variation");
  if (v.eligibleEntryCount === 0) return translate("0 eligible — filter matched nothing");
  if (v.brokeredItemCount === 0) return translate("Eligible but nothing brokered — no available inventory");
  return "";
}
function signalClass(row: CompareRow) {
  return row.variation && row.variation.eligibleEntryCount === 0 ? "sig-warn" : "sig-info";
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

- [ ] **Step 2: Add strings** (`"Per-routing results"`, `"Eligible"`, `"Brokered"`, `"Queued"`, `"Not run in this variation"`, `"0 eligible — filter matched nothing"`, `"Eligible but nothing brokered — no available inventory"`); run `npm run i18n:report`.

- [ ] **Step 3: Lint + commit**

```bash
cd apps/order-routing && npm run lint
git add src/components/simulation/VariationCompareTable.vue src/locales/en.json
git commit -m "feat(sim): VariationCompareTable parent-vs-variation results"
```

---

### Task 14: `VariationRunPanel.vue`

**Files:**
- Create: `src/components/simulation/VariationRunPanel.vue`

- [ ] **Step 1: Implement the run panel**

```vue
<template>
  <div class="run-panel">
    <div class="controls">
      <ion-button :disabled="store.isRunningVariation" @click="store.runComparison(500)">
        {{ store.isRunningVariation ? translate("Running…") : translate("Run comparison") }}
      </ion-button>
      <ion-button fill="outline" :disabled="store.isRunningParent" @click="store.rerunParent(500)">
        {{ translate("Re-run parent") }}
      </ion-button>
    </div>

    <!-- Variation run: synchronous, no progress stream -> indeterminate + elapsed timer. -->
    <div v-if="store.isRunningVariation" class="prog">
      <ion-label>{{ translate("Simulating variation") }} ({{ elapsed }}s) — {{ translate("this can take 25–150s") }}</ion-label>
      <ion-progress-bar type="indeterminate" />
    </div>

    <!-- Parent run: streams real progress. -->
    <div v-if="store.isRunningParent" class="prog">
      <ion-label>{{ translate("Running parent group") }}</ion-label>
      <ion-progress-bar :value="parentRatio" />
    </div>

    <ion-note v-if="store.runError" color="danger">{{ store.runError }}</ion-note>

    <variation-compare-table v-if="store.variationResult" />
    <ion-note v-if="store.variationResult && !parentReady" color="medium">
      {{ translate("Parent run unavailable — showing variation results only.") }}
    </ion-note>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { translate } from "@common";
import { IonButton, IonLabel, IonNote, IonProgressBar } from "@ionic/vue";
import { variationStore } from "@/store/variationStore";
import VariationCompareTable from "./VariationCompareTable.vue";

const store = variationStore();
const elapsed = ref(0);
let timer: any = null;

watch(() => store.isRunningVariation, (running) => {
  if (running) { elapsed.value = 0; timer = setInterval(() => (elapsed.value += 1), 1000); }
  else if (timer) { clearInterval(timer); timer = null; }
});
onUnmounted(() => { if (timer) clearInterval(timer); });

const parentRatio = computed(() => {
  const p = store.parentProgress;
  if (!p || !p.ordersInScope) return 0;
  return Math.min(1, (p.ordersProcessed || 0) / p.ordersInScope);
});
const parentReady = computed(() => !!store.parentResultByParentId[store.parentRoutingGroupId]);
</script>

<style scoped>
.controls { display: flex; gap: var(--spacer-sm); margin-bottom: var(--spacer-base); }
.prog { margin: var(--spacer-sm) 0; }
</style>
```

- [ ] **Step 2: Add strings** (`"Running…"`, `"Run comparison"`, `"Re-run parent"`, `"Simulating variation"`, `"this can take 25–150s"`, `"Running parent group"`, `"Parent run unavailable — showing variation results only."`); run `npm run i18n:report`.

- [ ] **Step 3: Lint + commit**

```bash
cd apps/order-routing && npm run lint
git add src/components/simulation/VariationRunPanel.vue src/locales/en.json
git commit -m "feat(sim): VariationRunPanel run controls + progress"
```

---

# Phase 5 — Views + routing wiring

### Task 15: `VariationEditor.vue` page

**Files:**
- Create: `src/views/VariationEditor.vue`

- [ ] **Step 1: Implement the page**

```vue
<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>{{ translate("Variation") }}</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <div v-if="store.loadError" class="ion-padding">
        <p>{{ store.loadError }}</p>
        <ion-button fill="outline" @click="reload">{{ translate("Retry") }}</ion-button>
      </div>
      <div v-else-if="!store.tree" class="ion-padding">{{ translate("Loading variation…") }}</div>
      <template v-else>
        <ion-segment :value="view" @ionChange="view = String($event.detail.value) as 'editor' | 'results'" class="vbar">
          <ion-segment-button value="editor"><ion-label>{{ translate("Editor") }}</ion-label></ion-segment-button>
          <ion-segment-button value="results"><ion-label>{{ translate("Results") }}</ion-label></ion-segment-button>
        </ion-segment>
        <variation-canvas v-show="view === 'editor'" />
        <div v-show="view === 'results'" class="ion-padding">
          <variation-run-panel />
        </div>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { translate } from "@common";
import { IonButton, IonContent, IonHeader, IonLabel, IonPage, IonSegment, IonSegmentButton, IonTitle, IonToolbar } from "@ionic/vue";
import { variationStore } from "@/store/variationStore";
import VariationCanvas from "@/components/simulation/VariationCanvas.vue";
import VariationRunPanel from "@/components/simulation/VariationRunPanel.vue";

const props = defineProps<{ variationGroupId: string }>();
const store = variationStore();
const view = ref<"editor" | "results">("editor");

function reload() { return store.openVariation(String(props.variationGroupId)); }
onMounted(reload);
</script>

<style scoped>
.vbar { max-width: 360px; margin: var(--spacer-sm) auto; }
</style>
```

- [ ] **Step 2: Add strings** (`"Variation"`, `"Loading variation…"`); run `npm run i18n:report`.

- [ ] **Step 3: Lint + commit**

```bash
cd apps/order-routing && npm run lint
git add src/views/VariationEditor.vue src/locales/en.json
git commit -m "feat(sim): VariationEditor page"
```

---

### Task 16: Register the route + update `SimulationHome`

**Files:**
- Modify: `src/router/index.ts` (sim routes block, ~line 200-225)
- Modify: `src/views/SimulationHome.vue`

- [ ] **Step 1: Add the variation route**

In `src/router/index.ts`, after the existing `/simulate/:routingGroupId` route block (~line 217), add:

```typescript
  {
    path: "/simulate/variation/:variationGroupId",
    name: "VariationEditor",
    component: () => import("@/views/VariationEditor.vue"),
    beforeEnter: simulateGuard,
    props: true,
  },
```

Note: keep the existing `/simulate/:routingGroupId` route for now; it is removed in the retirement phase. The new path is more specific (`/simulate/variation/...`) so vue-router matches it correctly even though `:routingGroupId` is dynamic — verify by visiting both.

- [ ] **Step 2: Update `SimulationHome` so picking a group shows its variations inline**

Replace the `openGroup` push and the new-tab list section so selecting a group reveals `VariationList` for it (instead of routing to the old editor):

```vue
<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>{{ translate("Simulate") }}</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <ion-segment :value="tab" @ionChange="tab = String($event.detail.value) as 'new' | 'past'">
        <ion-segment-button value="new"><ion-label>{{ translate("New simulation") }}</ion-label></ion-segment-button>
        <ion-segment-button value="past"><ion-label>{{ translate("Past simulations") }}</ion-label></ion-segment-button>
      </ion-segment>

      <div v-show="tab === 'new'">
        <ion-list v-if="!selectedGroup">
          <ion-list-header><ion-label>{{ translate("Choose a routing group to simulate") }}</ion-label></ion-list-header>
          <ion-item v-for="group in groups" :key="group.routingGroupId" button @click="selectGroup(group)">
            <ion-label><h2>{{ group.groupName || group.routingGroupId }}</h2><p>{{ group.routingGroupId }}</p></ion-label>
          </ion-item>
        </ion-list>
        <div v-else>
          <ion-button fill="clear" @click="selectedGroup = null">{{ translate("← Choose a different group") }}</ion-button>
          <variation-list :parent-routing-group-id="selectedGroup.routingGroupId" :parent-name="selectedGroup.groupName" />
        </div>
      </div>

      <past-simulations-list v-if="tab === 'past'" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { translate } from "@common";
import { IonButton, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonPage, IonSegment, IonSegmentButton, IonTitle, IonToolbar } from "@ionic/vue";
import { simulationStore } from "@/store/simulationStore";
import PastSimulationsList from "@/components/simulation/PastSimulationsList.vue";
import VariationList from "@/components/simulation/VariationList.vue";

const simStore = simulationStore();
const groups = computed(() => simStore.getSimGroups);
const tab = ref<"new" | "past">("new");
const selectedGroup = ref<any | null>(null);

onMounted(async () => { await simStore.fetchSimGroups(); });
function selectGroup(group: any) { selectedGroup.value = group; }
</script>
```

Note: `SimulationHome` still imports `simulationStore` only for the **group list** (`fetchSimGroups`/`getSimGroups`). That part of `simulationStore` is retired last; until then this import is intentional. (In the retirement phase, move `fetchSimGroups`/`simGroups` into `variationStore` and drop this import.)

- [ ] **Step 3: Add strings** (`"← Choose a different group"`); run `npm run i18n:report`.

- [ ] **Step 4: Manual smoke test**

Run the dev server: `cd apps/order-routing && npm run serve`. With `VITE_SIMULATION_ENABLED` not "false", visit `/simulate`, pick a group, confirm the variations list loads, create a variation, open it, toggle a routing, add a filter, switch to Results, click "Run comparison". Confirm the per-routing table renders. (Requires a reachable sim-routing backend + env configured per `.env.example`.)

- [ ] **Step 5: Lint + commit**

```bash
cd apps/order-routing && npm run lint
git add src/router/index.ts src/views/SimulationHome.vue src/locales/en.json
git commit -m "feat(sim): wire variation route + group→variations landing"
```

---

# Phase 6 — Guarded retirement (deletion caution)

> Per the standing rule: before deleting anything, grep for importers and run the unit tests. Delete only what has zero remaining importers after the new flow is verified working end-to-end. Do each deletion as its own commit so it is easy to revert.

### Task 17: Remove the old client-side editor + diff/batch path

**Files (delete):** `src/store/simulationStore.ts`, `src/util/simulationDiff.ts`, `src/util/simulationBatch.ts`, `src/components/simulation/SimulationCanvas.vue`, `src/components/simulation/VariationRail.vue`, `src/components/simulation/SimulationResults.vue` (if comparison-only), `src/views/Simulation.vue`, and their tests (`tests/simulationDiff*.test.ts`, `tests/simulationBatch.test.ts`, etc.).

- [ ] **Step 1: Move the group-list logic `SimulationHome` still needs**

`SimulationHome` imports `simulationStore` for `fetchSimGroups`/`getSimGroups`. Add the same to `variationStore`:

```typescript
    // in variationStore state:
    simGroups: [] as any[],
    // in variationStore actions:
    async fetchSimGroups() {
      const { fetchRoutingGroupsList } = await import("../services/RoutingGroupService");
      const { simApi, simApiName, simMoquiUrl } = await import("../services/SimulationService");
      try {
        this.simGroups = await fetchRoutingGroupsList(this.resolveProductStoreId(), simApi, simMoquiUrl(), simApiName());
      } catch (e) { logger.error(e); this.simGroups = []; }
    },
```

Then update `SimulationHome.vue` to use `variationStore` for the group list and drop the `simulationStore` import.

- [ ] **Step 2: Grep for any remaining importers of each file to delete**

Run for each path, e.g.:
`cd apps/order-routing && grep -rn "simulationStore\|SimulationCanvas\|VariationRail\|simulationDiff\|simulationBatch\|views/Simulation\b" src/ tests/`
Expected: only the files being deleted reference each other. If anything else imports them, stop and resolve first.

- [ ] **Step 3: Delete the files and the now-unused routes**

Remove `/simulate/:routingGroupId` and its `/tabs/simulate/:routingGroupId` redirect from `src/router/index.ts`. Delete the files listed above.

- [ ] **Step 4: Run all unit tests + lint + build**

Run:
```
cd apps/order-routing
for t in tests/variationTree.test.ts tests/routingResultJoin.test.ts tests/variationService.test.ts; do npx tsx "$t"; done
npm run lint
npm run build
```
Expected: all tests print "... tests passed"; lint clean; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(sim): retire client-side diff/batch simulation flow"
```

### Task 18: Remove comparison-only outcome panels

**Files (delete):** `src/components/simulation/OutcomeHeadline.vue`, `TradeoffChart.vue`, `CompositeScorePanel.vue`, `ExpeditedPanel.vue`, `FulfillmentMixPanel.vue`, `StockoutPanel.vue`, `AdvancedDetails.vue` (if comparison-only), `src/util/outcomes.ts`, and their tests.

- [ ] **Step 1: Grep for importers**

Run: `cd apps/order-routing && grep -rn "OutcomeHeadline\|TradeoffChart\|CompositeScorePanel\|ExpeditedPanel\|FulfillmentMixPanel\|StockoutPanel\|util/outcomes" src/ tests/`
Expected: references only among the deletion set and `PastSimulationDetail`/`SimulationResults`. If `PastSimulationDetail.vue` (the kept history view) imports any, **keep** that panel — the history view still renders persisted outcomes. Adjust the deletion set accordingly.

- [ ] **Step 2: Delete the confirmed-unused files; run tests + lint + build**

Run:
```
cd apps/order-routing
npm run lint && npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(sim): remove comparison-only outcome panels with no data source"
```

---

## Self-review (completed during planning)

- **Spec coverage:** A (config)→Task 1; B (service/store/adapter)→Tasks 2–9 (adapter collapsed into `variationTree` per the documented deviation); C (editor)→Tasks 11–12; D (run+compare)→Tasks 6, 9, 13–14; E (views/routing)→Tasks 15–16; F (retirement)→Tasks 17–18; G (testing)→Tasks 3–5; H (API-fit gaps: sync run indeterminate progress→Task 14, no-delete note→Task 10, clone GET round-trip→Task 7 `createVariation`).
- **Type consistency:** store action names referenced by components (`setRoutingStatus`, `setRuleStatus`, `upsertFilter`, `removeFilter`, `upsertInventoryCondition`, `removeInventoryCondition`, `upsertAction`, `removeAction`, `reorderRoutings`, `reorderRules`, `runComparison`, `rerunParent`, `openVariation`, `fetchVariations`, `createVariation`) all defined in Tasks 7–9. Getters (`sortedRoutings`, `compareRows`, `routingNameById`) defined in Task 7. `VariationCondition`/`VariationAction`/`CompareRow`/`GroupRunResult` defined in Task 2 and used consistently. `variationRequests.*` builder names match between Task 5 test and impl.
- **Placeholder scan:** no TBD/TODO; every code step contains complete code. Vue components are full skeletons with exact bindings (visual polish is explicitly delegated, not logic).
- **Known gap surfaced (not a placeholder):** the parent run via empty `variants` relies on the documented `JobStatusResponse.groupRun` ("parsed Map when no variants were sent"); Task 16 Step 4 manual smoke test is where this is confirmed against the real backend. If empty variants is rejected, fall back to submitting one no-op variant `{ label: "baseline", parameterOverrides: {}, routingDeltas: [] }` and read `result.variation` — note left in Task 6.
