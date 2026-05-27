# Brokering Group Simulation Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PWA screen that mirrors the circuit/group editor but, instead of saving to the backend, lets a user build any number of in-memory "variations" of a routing group, submit them to the group-run brokering simulation, and compare the results.

**Architecture:** A new "Simulate" tab loads a routing group as an immutable **baseline**; a forked `SimulationCanvas` edits an in-memory copy and captures each edited state as a full-snapshot **variation**. At submit, a pure diff engine turns each snapshot into the backend's `variants[]` (changes-only) shape, chunks them into batches of ≤5, submits each batch to an async job endpoint, polls to completion, and merges the per-variant results into a comparison view. No backend mutation ever happens.

**Tech Stack:** Vue 3 + Ionic 8, Pinia stores (`src/store/*.ts`), `api` helper + `commonUtil.hasError` from `@common`, standalone `tests/*.test.ts` run with `npx tsx` (`import assert from "assert"`).

---

## Reference: actual data shapes (verified in `src/store/orderRoutingStore.ts`)

The in-memory `orderRoutingStore().currentGroup` hierarchy:

```
currentGroup = {
  routingGroupId: string,
  routings: [{
    orderRoutingId: string,
    routingName: string,
    statusId: string,                 // e.g. "ROUTING_ACTIVE"
    sequenceNum: number,
    orderFilters: [{ orderRoutingId, conditionTypeEnumId, fieldName, fieldValue, ... }],
    rules: [{
      routingRuleId: string,
      orderRoutingId: string,
      ruleName: string,
      sequenceNum: number,
      inventoryFilters: [{ routingRuleId, fieldName, fieldValue, ... }],
      actions:          [{ routingRuleId, actionTypeEnumId, actionValue, ... }],
    }],
  }],
}
```

Store facts used by this plan:
- `orderRoutingStore().fetchOrderRoutingGroups()` → populates `groups[]` (metadata). Getter `getRoutingGroups`.
- `orderRoutingStore().fetchCurrentRoutingGroup(routingGroupId)` → loads the FULL hierarchy into `currentGroup` (and returns nothing; read getter `getCurrentRoutingGroup`).
- API calls: `api({ url, method, params?, data? })` from `@common`; check `commonUtil.hasError(resp)`.

Backend contract this screen targets (from the design spec, async job variant — **a backend dependency that may not exist yet**; Tasks 7 and 14 are gated on it and can be exercised against the mock from Task 7a until it lands):

```
POST /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs
  body: { variants: [{ label, parameterOverrides?, routingDeltas? }], routingConfigDeltas?, sampleCap?,
          changeReasonEnumId?, simUser?, simNow?, entityGroupName? }   → 200 { jobId }
GET  /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}
  → { jobId, status: 'running'|'complete'|'failed'|'not_found', groupRun?, variation?, error? }
```

The `api` helper prefixes `/rest/s1/order-routing` differently per existing calls (they use `url: "order-routing/..."`), so this plan uses `url: \`order-routing/routingGroups/${id}/brokeringSimulation/jobs\``.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types/simulation.ts` (create) | All shared types: delta ops, override keys, `Variation`, `SimVariant`, result envelopes, job status. Pure TS, no imports. |
| `src/util/simulationDiff.ts` (create) | Pure `diff(baseline, snapshot) → { parameterOverrides, routingDeltas }`. No Vue/@common imports. |
| `src/util/simulationBatch.ts` (create) | Pure `chunkVariants()` + `mergeVariationResults()`. |
| `src/services/SimulationService.ts` (create) | `submitBatch()`, `pollJob()`, pure `interpretJobStatus()`. Uses `api` from `@common`. |
| `src/store/simulationStore.ts` (create) | Pinia store: `baseline`, `variations[]`, `activeVariationId`, `run`, `results`; CRUD + run orchestration. |
| `src/views/SimulationHome.vue` (create) | Group picker. |
| `src/views/Simulation.vue` (create) | Tab shell: picker vs canvas+rail vs results. |
| `src/components/simulation/SimulationCanvas.vue` (create, fork of `CircuitCanvas.vue`) | In-memory editor gated to the delta vocabulary; Save = capture variation. |
| `src/components/simulation/VariationRail.vue` (create) | Baseline + variations list; add/dup/rename/delete/load; Submit button. |
| `src/components/simulation/SimulationProgress.vue` (create) | Per-batch/per-variation live status. |
| `src/components/simulation/SimulationResults.vue` (create) | Scorecard + drill-downs. |
| `src/views/Tabs.vue` (modify) | Add 4th "Simulate" tab + `showFooter()` path. |
| `src/router/index.ts` (modify) | Add `simulate` and `simulate/:routingGroupId` routes. |
| `tests/simulationDiff.test.ts` (create) | Diff engine tests. |
| `tests/simulationBatch.test.ts` (create) | Batching/merge tests. |
| `tests/simulationService.test.ts` (create) | `interpretJobStatus` tests. |

---

## Task 1: Shared simulation types

**Files:**
- Create: `src/types/simulation.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/types/simulation.ts
// Shared types for the brokering group simulation screen. Pure TS — no runtime imports
// so this module is safe to import from tests run with `npx tsx`.

/** The flat parameter/data override vocabulary accepted inside variants[].parameterOverrides.
 *  Mirrors simulationConfigSchema in circuit/src/mastra/tools/runBrokeringGroupSimulation.ts. */
export interface SimulationConfig {
  distance?: number;
  brokeringSafetyStock?: number;
  weekOfSupplyFilterEnabled?: boolean;
  weekOfSupplyThreshold?: number;
  facilityGroupId?: string;
  ignoreFacilityOrderLimit?: boolean;
  facilityOrderLimitOverride?: string;
  splitOrderItemGroup?: boolean;
  assignmentEnumId?: "ORA_SINGLE" | "ORA_MULTI";
  inventorySortByList?: string[];
  modelInventoryConsumption?: boolean;
  minimumStockOverrides?: Record<string, number>;
  inventoryCountOverrides?: Record<string, number>;
  allowBrokeringOverrides?: Record<string, boolean>;
  maximumOrderLimitOverrides?: Record<string, number>;
  facilitiesToSimulateAtLimit?: string[];
  facilitiesToAddToGroup?: string[];
  facilitiesToRemoveFromGroup?: string[];
}

/** The 11 scalar parameter keys we diff on currentGroup. Data-override maps are handled separately. */
export const SCALAR_PARAM_KEYS: (keyof SimulationConfig)[] = [
  "distance",
  "brokeringSafetyStock",
  "weekOfSupplyFilterEnabled",
  "weekOfSupplyThreshold",
  "facilityGroupId",
  "ignoreFacilityOrderLimit",
  "facilityOrderLimitOverride",
  "splitOrderItemGroup",
  "assignmentEnumId",
  "inventorySortByList",
  "modelInventoryConsumption",
];

export type RoutingConfigDelta =
  | { op: "ADD_RULE"; orderRoutingId: string; ruleSeed: Record<string, unknown> }
  | { op: "REMOVE_RULE"; routingRuleId: string }
  | { op: "SET_RULE_ACTION"; routingRuleId: string; actionTypeEnumId: string; actionValue: string }
  | { op: "SET_RULE_INV_COND"; routingRuleId: string; fieldName: string; fieldValue: unknown }
  | { op: "SET_ROUTING_FILTER"; orderRoutingId: string; fieldName: string; fieldValue: unknown }
  | { op: "SET_ROUTING_SEQUENCE_NUM"; orderRoutingId: string; sequenceNum: number }
  | { op: "SET_RULE_SEQUENCE_NUM"; routingRuleId: string; sequenceNum: number };

/** Output of diff(baseline, snapshot). */
export interface VariantPayload {
  parameterOverrides: Partial<SimulationConfig>;
  routingDeltas: RoutingConfigDelta[];
}

/** One backend variant: label + the diff payload. */
export interface SimVariant extends VariantPayload {
  label: string;
}

/** A user-saved variation: a full snapshot plus UI metadata. `group` is a deep clone of currentGroup. */
export interface Variation {
  id: string;            // client uuid
  label: string;         // user-editable
  group: any;            // full snapshot of the group hierarchy
}

export type JobStatus = "running" | "complete" | "failed" | "not_found";

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  groupRun?: any;        // parsed Map when no variants were sent
  variation?: any;       // parsed Map when variants were sent
  error?: string;
}

/** Per-variation run state shown in the progress panel. */
export type RunPhase = "pending" | "submitted" | "running" | "done" | "failed";

export interface VariationRunState {
  variationId: string;
  label: string;
  phase: RunPhase;
  error?: string;
}
```

- [ ] **Step 2: Type-check the file**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors referencing `src/types/simulation.ts`). If pre-existing unrelated errors appear, confirm none mention this new file.

- [ ] **Step 3: Commit**

```bash
git add src/types/simulation.ts
git commit -m "feat(simulation): add shared simulation types"
```

---

## Task 2: Parameter diff (pure)

**Files:**
- Create: `src/util/simulationDiff.ts`
- Test: `tests/simulationDiff.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/simulationDiff.test.ts
import assert from "assert";
import { diffParameters } from "../src/util/simulationDiff";

// changed scalar is included; unchanged is omitted
{
  const baseline = { distance: 50, brokeringSafetyStock: 5 };
  const snapshot = { distance: 100, brokeringSafetyStock: 5 };
  const out = diffParameters(baseline, snapshot);
  assert.deepStrictEqual(out, { distance: 100 }, "only changed scalar included");
}

// array param compared by value, not reference
{
  const baseline = { inventorySortByList: ["A", "B"] };
  const snapshot = { inventorySortByList: ["A", "B"] };
  assert.deepStrictEqual(diffParameters(baseline, snapshot), {}, "equal arrays produce no override");
}
{
  const baseline = { inventorySortByList: ["A", "B"] };
  const snapshot = { inventorySortByList: ["B", "A"] };
  assert.deepStrictEqual(diffParameters(baseline, snapshot), { inventorySortByList: ["B", "A"] }, "reordered array is a change");
}

console.log("simulationDiff parameter tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/simulationDiff.test.ts`
Expected: FAIL — `Cannot find module '../src/util/simulationDiff'` (or `diffParameters is not a function`).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/util/simulationDiff.ts
import { SCALAR_PARAM_KEYS, SimulationConfig } from "../types/simulation";

function valueEquals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Compare the scalar/array parameter fields. Returns only the keys that changed. */
export function diffParameters(baseline: any, snapshot: any): Partial<SimulationConfig> {
  const out: Partial<SimulationConfig> = {};
  for (const key of SCALAR_PARAM_KEYS) {
    if (!valueEquals(baseline?.[key], snapshot?.[key])) {
      (out as any)[key] = snapshot?.[key];
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/simulationDiff.test.ts`
Expected: PASS — prints `simulationDiff parameter tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/util/simulationDiff.ts tests/simulationDiff.test.ts
git commit -m "feat(simulation): parameter diff"
```

---

## Task 3: Structural (routing/rule) diff (pure)

**Files:**
- Modify: `src/util/simulationDiff.ts`
- Test: `tests/simulationDiff.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
// append to tests/simulationDiff.test.ts (before any final console.log; keep only one final log line)
import { diffRoutings } from "../src/util/simulationDiff";

const baseRouting = () => ({
  orderRoutingId: "R1", routingName: "First", sequenceNum: 1,
  orderFilters: [{ fieldName: "salesChannelEnumId", fieldValue: "WEB" }],
  rules: [{
    routingRuleId: "RULE1", orderRoutingId: "R1", sequenceNum: 1,
    inventoryFilters: [{ fieldName: "atp", fieldValue: 0 }],
    actions: [{ actionTypeEnumId: "ORA_MV_TO_QUEUE", actionValue: "QUEUE_FAC" }],
  }],
});

// no change → no deltas
{
  const baseline = { routings: [baseRouting()] };
  const snapshot = { routings: [baseRouting()] };
  assert.deepStrictEqual(diffRoutings(baseline, snapshot), [], "identical routings → no deltas");
}

// changed action
{
  const baseline = { routings: [baseRouting()] };
  const snap = { routings: [baseRouting()] };
  snap.routings[0].rules[0].actions[0] = { actionTypeEnumId: "ORA_BROKER", actionValue: "FAC_A" };
  assert.deepStrictEqual(diffRoutings(baseline, snap), [
    { op: "SET_RULE_ACTION", routingRuleId: "RULE1", actionTypeEnumId: "ORA_BROKER", actionValue: "FAC_A" },
  ], "action change");
}

// removed rule
{
  const baseline = { routings: [baseRouting()] };
  const snap = { routings: [baseRouting()] };
  snap.routings[0].rules = [];
  assert.deepStrictEqual(diffRoutings(baseline, snap), [
    { op: "REMOVE_RULE", routingRuleId: "RULE1" },
  ], "removed rule");
}

// added rule (no routingRuleId → ADD_RULE with ruleSeed)
{
  const baseline = { routings: [baseRouting()] };
  const snap = { routings: [baseRouting()] };
  snap.routings[0].rules.push({
    orderRoutingId: "R1", sequenceNum: 2,
    inventoryFilters: [], actions: [{ actionTypeEnumId: "ORA_BROKER", actionValue: "FAC_B" }],
  });
  const deltas = diffRoutings(baseline, snap);
  assert.strictEqual(deltas.length, 1);
  assert.strictEqual(deltas[0].op, "ADD_RULE");
  assert.strictEqual((deltas[0] as any).orderRoutingId, "R1");
  assert.ok((deltas[0] as any).ruleSeed.actions, "ruleSeed carries the new rule body");
}

// changed inventory condition
{
  const baseline = { routings: [baseRouting()] };
  const snap = { routings: [baseRouting()] };
  snap.routings[0].rules[0].inventoryFilters[0].fieldValue = 10;
  assert.deepStrictEqual(diffRoutings(baseline, snap), [
    { op: "SET_RULE_INV_COND", routingRuleId: "RULE1", fieldName: "atp", fieldValue: 10 },
  ], "inventory condition change");
}

// changed routing filter
{
  const baseline = { routings: [baseRouting()] };
  const snap = { routings: [baseRouting()] };
  snap.routings[0].orderFilters[0].fieldValue = "POS";
  assert.deepStrictEqual(diffRoutings(baseline, snap), [
    { op: "SET_ROUTING_FILTER", orderRoutingId: "R1", fieldName: "salesChannelEnumId", fieldValue: "POS" },
  ], "routing filter change");
}

// reordered routing sequence
{
  const baseline = { routings: [baseRouting()] };
  const snap = { routings: [baseRouting()] };
  snap.routings[0].sequenceNum = 5;
  assert.deepStrictEqual(diffRoutings(baseline, snap), [
    { op: "SET_ROUTING_SEQUENCE_NUM", orderRoutingId: "R1", sequenceNum: 5 },
  ], "routing sequence change");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/simulationDiff.test.ts`
Expected: FAIL — `diffRoutings is not a function`.

- [ ] **Step 3: Implement `diffRoutings`**

Append to `src/util/simulationDiff.ts`:

```typescript
import { RoutingConfigDelta } from "../types/simulation";

function byId<T extends Record<string, any>>(arr: T[] | undefined, idKey: string): Map<string, T> {
  const m = new Map<string, T>();
  (arr ?? []).forEach((item) => { if (item?.[idKey]) m.set(item[idKey], item); });
  return m;
}

function firstFilterChange(
  baseFilters: any[] | undefined,
  snapFilters: any[] | undefined,
): { fieldName: string; fieldValue: unknown } | null {
  const b = baseFilters ?? [];
  const s = snapFilters ?? [];
  // match filters positionally by fieldName; report the first differing fieldValue.
  for (const sf of s) {
    const bf = b.find((x) => x.fieldName === sf.fieldName);
    if (!bf || !valueEquals(bf.fieldValue, sf.fieldValue)) {
      return { fieldName: sf.fieldName, fieldValue: sf.fieldValue };
    }
  }
  return null;
}

/** Diff the routing/rule hierarchy. Routings and rules are matched by id; new rules (no
 *  routingRuleId) become ADD_RULE; rules missing from the snapshot become REMOVE_RULE. */
export function diffRoutings(baseline: any, snapshot: any): RoutingConfigDelta[] {
  const deltas: RoutingConfigDelta[] = [];
  const baseRoutings = byId<any>(baseline?.routings, "orderRoutingId");

  for (const snapRouting of snapshot?.routings ?? []) {
    const baseRouting = baseRoutings.get(snapRouting.orderRoutingId);

    // routing-level: sequence + filters
    if (baseRouting) {
      if (baseRouting.sequenceNum !== snapRouting.sequenceNum) {
        deltas.push({ op: "SET_ROUTING_SEQUENCE_NUM", orderRoutingId: snapRouting.orderRoutingId, sequenceNum: snapRouting.sequenceNum });
      }
      const filterChange = firstFilterChange(baseRouting.orderFilters, snapRouting.orderFilters);
      if (filterChange) {
        deltas.push({ op: "SET_ROUTING_FILTER", orderRoutingId: snapRouting.orderRoutingId, ...filterChange });
      }
    }

    const baseRules = byId<any>(baseRouting?.rules, "routingRuleId");
    const seenRuleIds = new Set<string>();

    for (const snapRule of snapRouting.rules ?? []) {
      if (!snapRule.routingRuleId) {
        // new rule
        deltas.push({ op: "ADD_RULE", orderRoutingId: snapRouting.orderRoutingId, ruleSeed: { ...snapRule } });
        continue;
      }
      seenRuleIds.add(snapRule.routingRuleId);
      const baseRule = baseRules.get(snapRule.routingRuleId);
      if (!baseRule) continue; // a rule with an id not in baseline: treat as new only if no id (handled above)

      if (baseRule.sequenceNum !== snapRule.sequenceNum) {
        deltas.push({ op: "SET_RULE_SEQUENCE_NUM", routingRuleId: snapRule.routingRuleId, sequenceNum: snapRule.sequenceNum });
      }
      const baseAction = (baseRule.actions ?? [])[0];
      const snapAction = (snapRule.actions ?? [])[0];
      if (snapAction && (!baseAction || baseAction.actionTypeEnumId !== snapAction.actionTypeEnumId || baseAction.actionValue !== snapAction.actionValue)) {
        deltas.push({ op: "SET_RULE_ACTION", routingRuleId: snapRule.routingRuleId, actionTypeEnumId: snapAction.actionTypeEnumId, actionValue: snapAction.actionValue });
      }
      const invChange = firstFilterChange(baseRule.inventoryFilters, snapRule.inventoryFilters);
      if (invChange) {
        deltas.push({ op: "SET_RULE_INV_COND", routingRuleId: snapRule.routingRuleId, ...invChange });
      }
    }

    // rules present in baseline but gone from snapshot → REMOVE_RULE
    for (const baseRuleId of baseRules.keys()) {
      if (!seenRuleIds.has(baseRuleId)) {
        deltas.push({ op: "REMOVE_RULE", routingRuleId: baseRuleId });
      }
    }
  }
  return deltas;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/simulationDiff.test.ts`
Expected: PASS — prints the final `simulationDiff parameter tests passed` line and no assertion throws.

- [ ] **Step 5: Commit**

```bash
git add src/util/simulationDiff.ts tests/simulationDiff.test.ts
git commit -m "feat(simulation): structural routing/rule diff"
```

---

## Task 4: Top-level `buildVariant` + no-op detection (pure)

**Files:**
- Modify: `src/util/simulationDiff.ts`
- Test: `tests/simulationDiff.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
import { buildVariant, isNoOp } from "../src/util/simulationDiff";

{
  const baseline = { distance: 50, routings: [baseRouting()] };
  const snap = { distance: 100, routings: [baseRouting()] };
  const v = buildVariant("Tighter distance", baseline, snap);
  assert.strictEqual(v.label, "Tighter distance");
  assert.deepStrictEqual(v.parameterOverrides, { distance: 100 });
  assert.deepStrictEqual(v.routingDeltas, []);
  assert.strictEqual(isNoOp(v), false);
}
{
  const baseline = { distance: 50, routings: [baseRouting()] };
  const snap = { distance: 50, routings: [baseRouting()] };
  const v = buildVariant("No change", baseline, snap);
  assert.strictEqual(isNoOp(v), true, "empty overrides + empty deltas is a no-op");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/simulationDiff.test.ts`
Expected: FAIL — `buildVariant is not a function`.

- [ ] **Step 3: Implement**

Append to `src/util/simulationDiff.ts`:

```typescript
import { SimVariant } from "../types/simulation";

export function buildVariant(label: string, baseline: any, snapshot: any): SimVariant {
  return {
    label,
    parameterOverrides: diffParameters(baseline, snapshot),
    routingDeltas: diffRoutings(baseline, snapshot),
  };
}

export function isNoOp(variant: SimVariant): boolean {
  return Object.keys(variant.parameterOverrides).length === 0 && variant.routingDeltas.length === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/simulationDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/util/simulationDiff.ts tests/simulationDiff.test.ts
git commit -m "feat(simulation): buildVariant + no-op detection"
```

---

## Task 5: Batching + result merge (pure)

**Files:**
- Create: `src/util/simulationBatch.ts`
- Test: `tests/simulationBatch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/simulationBatch.test.ts
import assert from "assert";
import { chunkVariants, mergeVariationResults } from "../src/util/simulationBatch";

// chunk into batches of 5
{
  const variants = Array.from({ length: 12 }, (_, i) => ({ label: `v${i}`, parameterOverrides: {}, routingDeltas: [] }));
  const batches = chunkVariants(variants, 5);
  assert.strictEqual(batches.length, 3);
  assert.deepStrictEqual(batches.map((b) => b.length), [5, 5, 2]);
}

// merge: keep one baseline, concat variants in order
{
  const r1 = { variation: { baseline: { brokeredItemCount: 800 }, variants: [{ label: "a" }, { label: "b" }] } };
  const r2 = { variation: { baseline: { brokeredItemCount: 800 }, variants: [{ label: "c" }] } };
  const merged = mergeVariationResults([r1, r2]);
  assert.deepStrictEqual(merged.baseline, { brokeredItemCount: 800 });
  assert.deepStrictEqual(merged.variants.map((v: any) => v.label), ["a", "b", "c"]);
}

// merge tolerates a failed batch (null result)
{
  const ok = { variation: { baseline: { brokeredItemCount: 1 }, variants: [{ label: "a" }] } };
  const merged = mergeVariationResults([ok, null]);
  assert.deepStrictEqual(merged.variants.map((v: any) => v.label), ["a"]);
}

console.log("simulationBatch tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/simulationBatch.test.ts`
Expected: FAIL — `Cannot find module '../src/util/simulationBatch'`.

- [ ] **Step 3: Implement**

```typescript
// src/util/simulationBatch.ts
import { SimVariant } from "../types/simulation";

export function chunkVariants(variants: SimVariant[], size = 5): SimVariant[][] {
  const batches: SimVariant[][] = [];
  for (let i = 0; i < variants.length; i += size) batches.push(variants.slice(i, i + size));
  return batches;
}

/** Merge per-batch `{ variation }` envelopes into one. Baseline is identical across batches —
 *  keep the first non-null one. Variants are concatenated in batch order. Null entries
 *  (failed/timed-out batches) are skipped; the caller tracks those failures separately. */
export function mergeVariationResults(results: (any | null)[]): { baseline: any; variants: any[]; partial: boolean } {
  let baseline: any = null;
  const variants: any[] = [];
  let partial = false;
  for (const r of results) {
    if (!r || !r.variation) { partial = true; continue; }
    if (baseline === null) baseline = r.variation.baseline ?? null;
    if (r.variation.partial) partial = true;
    for (const v of r.variation.variants ?? []) variants.push(v);
  }
  return { baseline, variants, partial };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/simulationBatch.test.ts`
Expected: PASS — prints `simulationBatch tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/util/simulationBatch.ts tests/simulationBatch.test.ts
git commit -m "feat(simulation): batching + result merge"
```

---

## Task 6: Job-status interpretation (pure)

**Files:**
- Create: `src/services/SimulationService.ts` (pure part only in this task)
- Test: `tests/simulationService.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/simulationService.test.ts
import assert from "assert";
import { interpretJobStatus } from "../src/services/SimulationService";

assert.deepStrictEqual(interpretJobStatus({ jobId: "j", status: "running" }), { done: false });
assert.deepStrictEqual(
  interpretJobStatus({ jobId: "j", status: "complete", variation: { baseline: {}, variants: [] } }),
  { done: true, result: { variation: { baseline: {}, variants: [] } } },
);
assert.deepStrictEqual(
  interpretJobStatus({ jobId: "j", status: "failed", error: "boom" }),
  { done: true, error: "boom" },
);
assert.deepStrictEqual(
  interpretJobStatus({ jobId: "j", status: "not_found" }),
  { done: true, error: "Simulation job expired before it completed. Please re-run." },
);

console.log("simulationService tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/simulationService.test.ts`
Expected: FAIL — `Cannot find module '../src/services/SimulationService'`.

- [ ] **Step 3: Implement the pure interpreter (file also gets the network fns in Task 7)**

```typescript
// src/services/SimulationService.ts
import { JobStatusResponse } from "../types/simulation";

export interface JobOutcome {
  done: boolean;
  result?: { groupRun?: any; variation?: any };
  error?: string;
}

/** Pure: turn a poll response into a terminal/continue decision. */
export function interpretJobStatus(resp: JobStatusResponse): JobOutcome {
  switch (resp.status) {
    case "running":
      return { done: false };
    case "complete":
      return { done: true, result: { groupRun: resp.groupRun, variation: resp.variation } };
    case "failed":
      return { done: true, error: resp.error || "Simulation failed." };
    case "not_found":
      return { done: true, error: "Simulation job expired before it completed. Please re-run." };
    default:
      return { done: true, error: `Unknown job status: ${(resp as any).status}` };
  }
}
```

Note: `interpretJobStatus` returns both `groupRun` and `variation` keys (one will be undefined); callers read whichever is set.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/simulationService.test.ts`
Expected: PASS — prints `simulationService tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/services/SimulationService.ts tests/simulationService.test.ts
git commit -m "feat(simulation): pure job-status interpreter"
```

---

## Task 7: Submit + poll network functions

**Files:**
- Modify: `src/services/SimulationService.ts`

> **Backend dependency:** this targets the async job endpoint from the design spec, which may not exist yet. The functions are written against the agreed contract; verify against a real or mocked backend before relying on them.

- [ ] **Step 1: Add submit + poll using the `api` helper**

Append to `src/services/SimulationService.ts`. **Do not add a top-level `import … from "@common"`** — that would force `tsx` to resolve the `@common` path alias when the Task 6 test imports this module, which it cannot. Import `@common` *dynamically inside* the functions instead; the pure test never calls them, so the dynamic import never executes during tests.

```typescript
import { SimVariant, JobStatusResponse } from "../types/simulation";

const POLL_INTERVAL_MS = 7_000;
const MAX_POLL_DURATION_MS = 30 * 60_000; // group runs are slow; generous cap

export interface SubmitBatchArgs {
  routingGroupId: string;
  variants: SimVariant[];
  sampleCap?: number;
}

/** POST one batch (≤5 variants). Returns the jobId. Throws on non-2xx. */
export async function submitBatch({ routingGroupId, variants, sampleCap }: SubmitBatchArgs): Promise<string> {
  const { api, commonUtil } = await import("@common");
  const resp: any = await api({
    url: `order-routing/routingGroups/${routingGroupId}/brokeringSimulation/jobs`,
    method: "POST",
    data: { variants, ...(sampleCap != null ? { sampleCap } : {}) },
  });
  if (commonUtil.hasError(resp) || !resp.data?.jobId) {
    throw new Error(`Failed to submit simulation batch: ${JSON.stringify(resp?.data ?? resp)?.slice(0, 300)}`);
  }
  return resp.data.jobId;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a job to completion. Resolves with { groupRun?, variation? } on success; throws on failure/timeout.
 *  `onPhase` is called with the raw status string after each poll so the UI can show progress. */
export async function pollJob(
  routingGroupId: string,
  jobId: string,
  onPhase?: (status: string) => void,
): Promise<{ groupRun?: any; variation?: any }> {
  const { api, commonUtil } = await import("@common");
  const deadline = Date.now() + MAX_POLL_DURATION_MS;
  while (Date.now() < deadline) {
    const resp: any = await api({
      url: `order-routing/routingGroups/${routingGroupId}/brokeringSimulation/jobs/${jobId}`,
      method: "GET",
    });
    if (commonUtil.hasError(resp)) throw new Error(`Polling failed: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
    const status = resp.data as JobStatusResponse;
    onPhase?.(status.status);
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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no new errors in `SimulationService.ts`).

- [ ] **Step 3: Re-run the pure test to confirm no regression**

Run: `npx tsx tests/simulationService.test.ts`
Expected: PASS — `simulationService tests passed`.

- [ ] **Step 4: Commit**

```bash
git add src/services/SimulationService.ts
git commit -m "feat(simulation): submit + poll network functions"
```

---

## Task 8: Simulation Pinia store

**Files:**
- Create: `src/store/simulationStore.ts`

- [ ] **Step 1: Write the store**

```typescript
// src/store/simulationStore.ts
import { defineStore } from "pinia";
import { v4 as uuidv4 } from "uuid";
import { orderRoutingStore } from "./orderRoutingStore";
import { buildVariant, isNoOp } from "../util/simulationDiff";
import { chunkVariants, mergeVariationResults } from "../util/simulationBatch";
import { submitBatch, pollJob } from "../services/SimulationService";
import { Variation, VariationRunState } from "../types/simulation";

const deepClone = (o: any) => JSON.parse(JSON.stringify(o ?? {}));

export const simulationStore = defineStore("simulation", {
  state: () => ({
    routingGroupId: "" as string,
    baseline: null as any,                  // immutable snapshot of the loaded group
    working: null as any,                   // the group the canvas edits
    variations: [] as Variation[],
    activeVariationId: "" as string,
    runStates: [] as VariationRunState[],
    results: null as { baseline: any; variants: any[]; partial: boolean } | null,
    isRunning: false,
  }),
  getters: {
    canSubmit: (s) => s.variations.length > 0 && !s.isRunning,
  },
  actions: {
    /** Load a group as baseline; reset working copy and variations. */
    async loadGroup(routingGroupId: string) {
      await orderRoutingStore().fetchCurrentRoutingGroup(routingGroupId);
      const group = orderRoutingStore().getCurrentRoutingGroup;
      this.routingGroupId = routingGroupId;
      this.baseline = deepClone(group);
      this.working = deepClone(group);
      this.variations = [];
      this.activeVariationId = "";
      this.results = null;
      this.runStates = [];
    },
    /** Capture the current working copy as a new variation. */
    saveAsVariation(label: string) {
      const variation: Variation = { id: uuidv4(), label: label || `Variation ${this.variations.length + 1}`, group: deepClone(this.working) };
      this.variations.push(variation);
      this.activeVariationId = variation.id;
    },
    loadVariation(id: string) {
      const v = this.variations.find((x) => x.id === id);
      if (v) { this.working = deepClone(v.group); this.activeVariationId = id; }
    },
    resetWorkingToBaseline() {
      this.working = deepClone(this.baseline);
      this.activeVariationId = "";
    },
    renameVariation(id: string, label: string) {
      const v = this.variations.find((x) => x.id === id);
      if (v) v.label = label;
    },
    deleteVariation(id: string) {
      this.variations = this.variations.filter((x) => x.id !== id);
      if (this.activeVariationId === id) this.resetWorkingToBaseline();
    },
    /** Diff every variation, drop no-ops, batch, submit, poll, merge. */
    async submit() {
      const built = this.variations.map((v) => ({ variation: v, variant: buildVariant(v.label, this.baseline, v.group) }));
      const live = built.filter((b) => !isNoOp(b.variant));
      // initialise run states (no-ops marked failed with a clear reason)
      this.runStates = built.map((b) => isNoOp(b.variant)
        ? { variationId: b.variation.id, label: b.variation.label, phase: "failed", error: "No changes vs baseline — skipped." }
        : { variationId: b.variation.id, label: b.variation.label, phase: "pending" });
      if (live.length === 0) return;

      this.isRunning = true;
      this.results = null;
      const setPhase = (id: string, phase: VariationRunState["phase"], error?: string) => {
        const rs = this.runStates.find((r) => r.variationId === id);
        if (rs) { rs.phase = phase; if (error) rs.error = error; }
      };

      const batches = chunkVariants(live.map((b) => b.variant), 5);
      // keep a parallel id map so phase updates target the right variations
      const idBatches = chunkVariants(live.map((b) => b.variation.id) as any, 5) as unknown as string[][];

      const batchResults = await Promise.all(batches.map(async (variants, i) => {
        const ids = idBatches[i];
        ids.forEach((id) => setPhase(id, "submitted"));
        try {
          const jobId = await submitBatch({ routingGroupId: this.routingGroupId, variants });
          const result = await pollJob(this.routingGroupId, jobId, (status) => {
            if (status === "running") ids.forEach((id) => setPhase(id, "running"));
          });
          ids.forEach((id) => setPhase(id, "done"));
          return result;
        } catch (err: any) {
          ids.forEach((id) => setPhase(id, "failed", err?.message ?? "Batch failed."));
          return null;
        }
      }));

      this.results = mergeVariationResults(batchResults);
      this.isRunning = false;
    },
  },
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no new errors in `simulationStore.ts`). The group getter is `getCurrentRoutingGroup` (verified in `orderRoutingStore.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/store/simulationStore.ts
git commit -m "feat(simulation): pinia store with variation CRUD + submit orchestration"
```

---

## Task 9: Navigation — tab + routes + group picker

**Files:**
- Modify: `src/views/Tabs.vue`
- Modify: `src/router/index.ts`
- Create: `src/views/SimulationHome.vue`
- Create: `src/views/Simulation.vue` (shell only in this task)

- [ ] **Step 1: Add the routes**

In `src/router/index.ts`, add inside the `/tabs` children array (after the `circuit` entry):

```typescript
      {
        path: "simulate",
        component: () => import("@/views/SimulationHome.vue")
      },
      {
        path: "simulate/:routingGroupId",
        component: () => import("@/views/Simulation.vue")
      },
```

- [ ] **Step 2: Add the tab button**

In `src/views/Tabs.vue`, add a tab button after the `circuit` one:

```html
        <ion-tab-button tab="simulate" href="/tabs/simulate">
          <ion-icon :icon="flaskOutline" />
          <ion-label>{{ translate("Simulate") }}</ion-label>
        </ion-tab-button>
```

Update the `flaskOutline` import:

```typescript
import { flaskOutline, settingsOutline, shuffleOutline, terminalOutline } from "ionicons/icons";
```

And extend `showFooter()` to include the simulate paths:

```typescript
function showFooter() {
  const p = router.currentRoute.value.path;
  if (['/tabs/settings', '/tabs/brokering', '/tabs/circuit'].includes(p)) return true;
  if (p.startsWith('/tabs/simulate')) return true;
  return false;
}
```

- [ ] **Step 3: Create the group picker**

```html
<!-- src/views/SimulationHome.vue -->
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Simulate") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
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
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { translate } from "@common";
import { IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonPage, IonTitle, IonToolbar } from "@ionic/vue";
import { orderRoutingStore } from "@/store/orderRoutingStore";
import router from "@/router";

const routingStore = orderRoutingStore();
const groups = computed(() => routingStore.getRoutingGroups);

onMounted(async () => { await routingStore.fetchOrderRoutingGroups(); });

function openGroup(routingGroupId: string) {
  router.push(`/tabs/simulate/${routingGroupId}`);
}
</script>
```

- [ ] **Step 4: Create the shell**

```html
<!-- src/views/Simulation.vue -->
<template>
  <ion-page>
    <ion-content>
      <div v-if="!sim.baseline">{{ translate("Loading group…") }}</div>
      <template v-else>
        <simulation-results v-if="sim.results || sim.isRunning" />
        <div v-else class="sim-editor">
          <simulation-canvas />
          <variation-rail />
        </div>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import { translate } from "@common";
import { IonContent, IonPage } from "@ionic/vue";
import { simulationStore } from "@/store/simulationStore";
import SimulationCanvas from "@/components/simulation/SimulationCanvas.vue";
import VariationRail from "@/components/simulation/VariationRail.vue";
import SimulationResults from "@/components/simulation/SimulationResults.vue";

const sim = simulationStore();
const route = useRoute();

onMounted(async () => { await sim.loadGroup(String(route.params.routingGroupId)); });
</script>

<style scoped>
.sim-editor { display: flex; gap: var(--spacer-base); }
</style>
```

Note: `SimulationCanvas`, `VariationRail`, and `SimulationResults` are created in later tasks. To keep this task independently runnable, create **temporary stubs** now (each a single `<template><div /></template>` SFC at the listed paths) and replace them in their tasks.

- [ ] **Step 5: Verify the app boots and the tab loads**

Run: `npm run serve` (note the port). With the app running, use the Chrome DevTools MCP server (per repo convention) to open `/tabs/simulate` and confirm: the tab appears, the group list renders, clicking a group navigates to `/tabs/simulate/:id` and shows "Loading group…" then the empty editor stubs. Confirm no console errors.

- [ ] **Step 6: Commit**

```bash
git add src/router/index.ts src/views/Tabs.vue src/views/SimulationHome.vue src/views/Simulation.vue src/components/simulation/
git commit -m "feat(simulation): tab, routes, group picker, screen shell"
```

---

## Task 10: Fork CircuitCanvas → SimulationCanvas

**Files:**
- Create: `src/components/simulation/SimulationCanvas.vue` (replaces the Task 9 stub)

This is a fork of `src/components/circuit/CircuitCanvas.vue`. Do not modify the original.

- [ ] **Step 1: Copy the file**

```bash
cp src/components/circuit/CircuitCanvas.vue src/components/simulation/SimulationCanvas.vue
```

- [ ] **Step 2: Repoint state to the simulation store's working copy**

In `SimulationCanvas.vue`:
- Replace the data source so the editor reads/writes `simulationStore().working` instead of `orderRoutingStore().currentGroup`. Concretely: import `simulationStore`, and set the local `group` ref from `simulationStore().working` (the original sets `group.value = routingStore.currentGroup` around line 762 — point it at `simulationStore().working`).
- Remove the `routingGroupId` prop dependency; read `simulationStore().routingGroupId`.

- [ ] **Step 3: Strip every persistence / backend mutation**

Search the copied file for calls that mutate the backend and remove them or the controls that trigger them. Grep to find them:

```bash
grep -nE "saveRoutingGroupRaw|scheduleBrokering|updateGroupStatus|runNow|createRoutingGroup|cloneGroup|\.save|RoutingService" src/components/simulation/SimulationCanvas.vue
```

For each hit: delete the handler body and the button/control that invokes it (Save, Run now, Clone, schedule editing, status active/draft toggle, group rename-save). The canvas in sim mode is for shaping config, not operating the group.

- [ ] **Step 4: Gate editing to the delta vocabulary**

Keep interactive only the edits the diff engine can express (see Reference shapes):
- Parameter fields (distance, brokeringSafetyStock, weekOfSupply*, facilityGroupId, ignoreFacilityOrderLimit, facilityOrderLimitOverride, splitOrderItemGroup, assignmentEnumId, inventorySortByList, modelInventoryConsumption, and the data-override maps).
- Add/remove rule, set rule action, set rule inventory condition, set routing filter, reorder routing, reorder rule.

Make any other editable control read-only (e.g. `:disabled="true"` or `readonly`) in this fork. New rules added here must NOT be assigned a `routingRuleId` (so the diff emits `ADD_RULE`); rely on the store's deep-cloned working copy.

- [ ] **Step 5: Replace "Save" with "Save as variation"**

Add a primary action that calls `simulationStore().saveAsVariation(label)`. Prompt for a label (an `ion-alert`/`ion-input` is fine), defaulting to `Variation N`. After saving, leave the working copy as-is (the user may keep editing toward another variation) — the rail (Task 11) offers "reset to baseline".

- [ ] **Step 6: Verify in the running app**

With `npm run serve` running, via Chrome DevTools MCP: open a group, change `distance`, change a rule action, click "Save as variation"; confirm a variation appears in the store (check it shows up in the rail after Task 11, or inspect `simulationStore().variations` via the Vue devtools). Confirm no network POST to `order-routing/groups` fires (Network tab) — nothing should persist.

- [ ] **Step 7: Commit**

```bash
git add src/components/simulation/SimulationCanvas.vue
git commit -m "feat(simulation): fork CircuitCanvas into read-only SimulationCanvas"
```

---

## Task 11: VariationRail

**Files:**
- Create: `src/components/simulation/VariationRail.vue` (replaces stub)

- [ ] **Step 1: Implement the rail**

```html
<!-- src/components/simulation/VariationRail.vue -->
<template>
  <ion-card class="variation-rail">
    <ion-list-header>
      <ion-label>{{ translate("Variations") }}</ion-label>
      <ion-button fill="clear" @click="sim.resetWorkingToBaseline()">
        <ion-icon slot="start" :icon="refreshOutline" />
        {{ translate("Reset to baseline") }}
      </ion-button>
    </ion-list-header>

    <ion-item :color="sim.activeVariationId === '' ? 'light' : undefined" button @click="sim.resetWorkingToBaseline()">
      <ion-label>{{ translate("Baseline (live config)") }}</ion-label>
    </ion-item>

    <ion-item v-for="v in sim.variations" :key="v.id" :color="sim.activeVariationId === v.id ? 'light' : undefined">
      <ion-label button @click="sim.loadVariation(v.id)">{{ v.label }}</ion-label>
      <ion-button slot="end" fill="clear" @click="rename(v.id, v.label)"><ion-icon slot="icon-only" :icon="pencilOutline" /></ion-button>
      <ion-button slot="end" fill="clear" color="danger" @click="sim.deleteVariation(v.id)"><ion-icon slot="icon-only" :icon="trashOutline" /></ion-button>
    </ion-item>

    <div class="ion-padding">
      <ion-button expand="block" :disabled="!sim.canSubmit" @click="sim.submit()">
        {{ translate("Submit") }} ({{ sim.variations.length }})
      </ion-button>
    </div>
  </ion-card>
</template>

<script setup lang="ts">
import { translate } from "@common";
import { alertController, IonButton, IonCard, IonIcon, IonItem, IonLabel, IonListHeader } from "@ionic/vue";
import { pencilOutline, refreshOutline, trashOutline } from "ionicons/icons";
import { simulationStore } from "@/store/simulationStore";

const sim = simulationStore();

async function rename(id: string, current: string) {
  const alert = await alertController.create({
    header: translate("Rename variation"),
    inputs: [{ name: "label", value: current }],
    buttons: [
      { text: translate("Cancel"), role: "cancel" },
      { text: translate("Save"), handler: (data) => sim.renameVariation(id, data.label) },
    ],
  });
  await alert.present();
}
</script>

<style scoped>
.variation-rail { min-width: 280px; }
</style>
```

- [ ] **Step 2: Verify in the running app**

With the app running (Chrome DevTools MCP): save two variations, confirm both list; rename one; delete one; click a variation and confirm the canvas reloads that snapshot; click "Baseline" / "Reset to baseline" and confirm the canvas returns to the live config. Submit is disabled with 0 variations, enabled with ≥1.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulation/VariationRail.vue
git commit -m "feat(simulation): variation rail (list, rename, delete, submit)"
```

---

## Task 12: SimulationProgress

**Files:**
- Create: `src/components/simulation/SimulationProgress.vue`

- [ ] **Step 1: Implement**

```html
<!-- src/components/simulation/SimulationProgress.vue -->
<template>
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
</template>

<script setup lang="ts">
import { translate } from "@common";
import { IonBadge, IonItem, IonLabel, IonList, IonListHeader, IonSpinner } from "@ionic/vue";
import { simulationStore } from "@/store/simulationStore";

const sim = simulationStore();

function phaseLabel(phase: string) {
  return { pending: translate("Queued"), done: translate("Done"), failed: translate("Failed") }[phase] || phase;
}
function badgeColor(phase: string) {
  return phase === "done" ? "success" : phase === "failed" ? "danger" : "medium";
}
</script>

<style scoped>
.error { color: var(--ion-color-danger); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/simulation/SimulationProgress.vue
git commit -m "feat(simulation): per-variation progress panel"
```

---

## Task 13: SimulationResults

**Files:**
- Create: `src/components/simulation/SimulationResults.vue` (replaces stub)

Result shape consumed (from design spec — parsed `variation` Map): `results.baseline` has headline counts (`attemptedItemCount`, `brokeredItemCount`, `queuedItemCount`); each `results.variants[i]` has `label`, a `groupRun` with the same counts, and a `diff` with `finalReasonTransitions`, `routingBrokeredDelta`, `facilityAllocationDelta`, plus optional `failed`.

- [ ] **Step 1: Implement**

```html
<!-- src/components/simulation/SimulationResults.vue -->
<template>
  <div class="ion-padding">
    <simulation-progress v-if="sim.isRunning" />

    <ion-button fill="clear" @click="sim.results = null"><ion-icon slot="start" :icon="arrowBackOutline" />{{ translate("Back to editor") }}</ion-button>

    <ion-card v-if="sim.results">
      <ion-card-header><ion-card-title>{{ translate("Comparison") }}</ion-card-title></ion-card-header>
      <ion-card-content>
        <table class="scorecard">
          <thead>
            <tr><th></th><th>{{ translate("Baseline") }}</th><th v-for="v in sim.results.variants" :key="v.label" :class="{ winner: v.label === winnerLabel }">{{ v.label }}</th></tr>
          </thead>
          <tbody>
            <tr><td>{{ translate("Brokered") }}</td><td>{{ sim.results.baseline?.brokeredItemCount ?? '—' }}</td><td v-for="v in sim.results.variants" :key="v.label">{{ v.groupRun?.brokeredItemCount ?? '—' }}</td></tr>
            <tr><td>{{ translate("Queued") }}</td><td>{{ sim.results.baseline?.queuedItemCount ?? '—' }}</td><td v-for="v in sim.results.variants" :key="v.label">{{ v.groupRun?.queuedItemCount ?? '—' }}</td></tr>
            <tr><td>{{ translate("Attempted") }}</td><td>{{ sim.results.baseline?.attemptedItemCount ?? '—' }}</td><td v-for="v in sim.results.variants" :key="v.label">{{ v.groupRun?.attemptedItemCount ?? '—' }}</td></tr>
          </tbody>
        </table>
        <p v-if="sim.results.partial" class="warn">{{ translate("Some variations did not complete — results are partial.") }}</p>
      </ion-card-content>
    </ion-card>

    <ion-accordion-group v-if="sim.results">
      <ion-accordion v-for="v in sim.results.variants" :key="v.label" :value="v.label">
        <ion-item slot="header"><ion-label>{{ v.label }} {{ v.failed ? '⚠︎' : '' }}</ion-label></ion-item>
        <div slot="content" class="ion-padding">
          <h4>{{ translate("Orders that changed outcome") }}</h4>
          <ion-list>
            <ion-item v-for="(t, i) in (v.diff?.finalReasonTransitions ?? [])" :key="i">
              <ion-label>{{ t.orderId }}: {{ t.from }} → {{ t.to }}</ion-label>
            </ion-item>
          </ion-list>
          <h4>{{ translate("Per-routing delta") }}</h4>
          <ion-list>
            <ion-item v-for="(d, name) in (v.diff?.routingBrokeredDelta ?? {})" :key="name">
              <ion-label>{{ name }}: {{ d[0] }} → {{ d[1] }}</ion-label>
            </ion-item>
          </ion-list>
          <h4>{{ translate("Per-facility delta") }}</h4>
          <ion-list>
            <ion-item v-for="(d, name) in (v.diff?.facilityAllocationDelta ?? {})" :key="name">
              <ion-label>{{ name }}: {{ d[0] }} → {{ d[1] }}</ion-label>
            </ion-item>
          </ion-list>
        </div>
      </ion-accordion>
    </ion-accordion-group>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";
import { IonAccordion, IonAccordionGroup, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonIcon, IonItem, IonLabel, IonList } from "@ionic/vue";
import { arrowBackOutline } from "ionicons/icons";
import { simulationStore } from "@/store/simulationStore";
import SimulationProgress from "./SimulationProgress.vue";

const sim = simulationStore();

const winnerLabel = computed(() => {
  const vs = sim.results?.variants ?? [];
  let best: any = null;
  for (const v of vs) {
    if (v.failed) continue;
    if (!best || (v.groupRun?.brokeredItemCount ?? -1) > (best.groupRun?.brokeredItemCount ?? -1)) best = v;
  }
  return best?.label;
});
</script>

<style scoped>
.scorecard { width: 100%; border-collapse: collapse; }
.scorecard th, .scorecard td { padding: 8px; text-align: left; border-bottom: 1px solid var(--ion-color-light-shade); }
.scorecard th.winner { color: var(--ion-color-success); }
.warn { color: var(--ion-color-warning-shade); }
</style>
```

- [ ] **Step 2: Verify in the running app**

With the app running and the backend (or mock) returning a `variation` envelope: submit ≥1 variation; confirm the progress panel shows phases, then the scorecard renders baseline vs variations with the winner highlighted, and each accordion shows the three delta sections. Confirm "Back to editor" returns to the canvas.

- [ ] **Step 3: Commit**

```bash
git add src/components/simulation/SimulationResults.vue
git commit -m "feat(simulation): results scorecard + drill-downs"
```

---

## Task 14: End-to-end verification

**Files:** none (verification only)

> Gated on the backend async endpoint (or a mock). If the endpoint is not yet available, stand up a temporary mock that returns `{ jobId }` then a `complete` `variation` payload, and verify against it.

- [ ] **Step 1: Full flow check**

With `npm run serve` running, via Chrome DevTools MCP:
1. Open `/tabs/simulate`, pick a group.
2. Edit distance + an action; "Save as variation" (label "A").
3. Reset to baseline; remove a rule; "Save as variation" (label "B").
4. Create enough variations to exceed 5 (e.g. 6) to exercise batching.
5. Submit. Confirm: progress shows per-variation phases; results merge into one scorecard with all 6 variations; a no-op variation (if any) is marked "skipped"; winner highlighted.
6. Network tab: confirm POSTs hit `order-routing/routingGroups/{id}/brokeringSimulation/jobs` and GposTs poll the job; confirm NO POST to `order-routing/groups` (nothing persisted).

- [ ] **Step 2: Run the full pure-test suite**

Run: `npx tsx tests/simulationDiff.test.ts && npx tsx tests/simulationBatch.test.ts && npx tsx tests/simulationService.test.ts`
Expected: all three print their `… tests passed` lines.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (fix any new lint errors in the created files).

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "chore(simulation): end-to-end verification fixes"
```

---

## Notes for the implementer

- **Backend dependency:** Tasks 7 and 14 assume the async job endpoint from the design spec. If it is not live, mock it; do not change the agreed contract without updating `docs/superpowers/specs/2026-05-27-brokering-simulation-screen-design.md`.
- **No Vue unit tests:** this repo has no wired Vue test runner; component tasks verify in the running app via the Chrome DevTools MCP server (repo convention). All pure logic (diff, batching, merge, status interpretation) IS unit-tested with `tsx`.
- **Fork, don't refactor:** never edit `CircuitCanvas.vue`. The duplication in `SimulationCanvas.vue` is intentional and accepted.
- **Session-scoped:** the simulation store is not added to any persisted-state config; variations are lost on reload by design (v1 non-goal).
