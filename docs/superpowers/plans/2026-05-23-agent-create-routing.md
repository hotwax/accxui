# Agent-driven sibling routing creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Circuit draft agent create a new routing inside the open brokering run, optionally populated with initial filters and inventory rules, reviewed in the existing draft-preview UX, without touching the backend until the user Saves.

**Architecture:** Add one optional `targetRouting: { action: "edit"|"create", routingKey?, name? }` discriminator to the existing `brokeringRouteDraftSchema`. The validator gates the create branch on manifest fields (`canCreateSiblingRoutings`, `availableSiblingRoutings`). On apply, a new `applyDraftProposal(proposal, manifest, ctx)` wrapper calls `routingStore.createOrderRouting(...)` (already local-only), `selectRouting(newId)`, then re-uses the existing `applyDraftOperations` against bindings rebuilt for the new routing.

**Tech Stack:** Mastra (zod/v4 schemas + agents), Ionic + Vue 3 PWA (Pinia stores, Vuex modules), `node:assert` + `tsx` for tests (no Jest), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-05-23-agent-create-routing-design.md`

---

## File map

**Mastra side (`apps/order-routing/mastra/`):**
- Modify `brokeringRouteDraftSchema.ts` — add `targetRouting` field + normalizer
- Modify `brokeringRouteDraftValidator.ts` — new pre-validation branch for `action="create"`
- Modify `index.ts` — append three instruction lines to `brokeringRouteDraftInstructions`

**PWA side (`apps/order-routing/src/`):**
- Modify `draftTargets/BrokeringRulesDraftTargets.ts` — populate `availableSiblingRoutings` + `canCreateSiblingRoutings` in the manifest
- Modify `services/DraftAssistantService.ts` — extend `BrokeringRouteDraft`, `DraftOperationSet`, `DraftProposal`; pass `targetRouting` through; add synthetic format section; add `applyDraftProposal` wrapper
- Modify `components/circuit/CircuitCanvas.vue` — pass `routings` into manifest input; update `prepareCircuitDraftProposal` gate; swap apply call to `applyDraftProposal`

**Tests (`apps/order-routing/tests/`):**
- Extend `brokeringRulesDraftTargets.test.ts` — manifest fields
- Extend `brokeringRouteDraftSchema.test.ts` — `targetRouting` normalize
- Extend `brokeringRouteDraftValidator.test.ts` — create-branch scenarios
- Extend `draftAssistantService.test.ts` — passthrough + proposal + applyDraftProposal

---

## Task 1: Add `availableSiblingRoutings` + `canCreateSiblingRoutings` to the manifest

**Files:**
- Modify: `apps/order-routing/src/draftTargets/BrokeringRulesDraftTargets.ts:53-83` (widen `ManifestInput`), `:345-393` (manifest body)
- Test: `apps/order-routing/tests/brokeringRulesDraftTargets.test.ts`

- [ ] **Step 1.1: Read the existing manifest test to see the fixture pattern**

Run: `cat apps/order-routing/tests/brokeringRulesDraftTargets.test.ts | head -80`

Expected: a fixture that calls `buildBrokeringRulesManifest(...)` with a `ManifestInput`-shaped object and asserts on the result.

- [ ] **Step 1.2: Add a failing test asserting the new manifest fields**

Append to `apps/order-routing/tests/brokeringRulesDraftTargets.test.ts` (after the existing test blocks):

```ts
// --- targetRouting/sibling-routing manifest fields ---
{
  const manifest = buildBrokeringRulesManifest({
    pageRoute: "/tabs/circuit",
    orderRoutingId: "ROUTING_A",
    routingName: "East Coast",
    routingStatus: "ROUTING_DRAFT",
    brokeringRun: {
      routingGroupId: "GROUP_1",
      groupName: "US Brokering",
      productStoreId: "STORE_1",
      schedule: null,
      routings: [
        { orderRoutingId: "ROUTING_A", routingName: "East Coast", statusId: "ROUTING_ACTIVE", sequenceNum: 20 },
        { orderRoutingId: "ROUTING_B", routingName: "West Coast", statusId: "ROUTING_DRAFT", sequenceNum: 25 }
      ]
    },
    selectedRoutingRule: {},
    isTestEnabled: false,
    orderRoutingFilterOptions: {},
    orderRoutingSortOptions: {},
    inventoryRuleFilterOptions: {},
    inventoryRuleSortOptions: {},
    inventoryRuleActions: {},
    inventoryRules: [],
    rulesInformation: {},
    ruleActionType: "",
    ruleEnums: {},
    conditionFilterEnums: {},
    conditionSortEnums: {},
    actionEnums: {},
    facilities: {},
    shippingMethods: {},
    salesChannels: {},
    facilityGroups: {},
    brokeringFacilityGroups: {}
  });

  const brokeringRun = (manifest.visibleEntities as any).brokeringRun;
  assert.equal(Array.isArray(brokeringRun.availableSiblingRoutings), true, "brokeringRun.availableSiblingRoutings must be an array");
  assert.equal(brokeringRun.availableSiblingRoutings.length, 2);
  assert.equal(brokeringRun.availableSiblingRoutings[0].orderRoutingId, "ROUTING_A");
  assert.equal(brokeringRun.availableSiblingRoutings[1].routingName, "West Coast");

  const route = (manifest.visibleEntities as any).route;
  assert.equal(route.draftLimitations.canCreateSiblingRoutings, true, "route.draftLimitations.canCreateSiblingRoutings must default to true");
}

// Sibling routings array must be empty (not undefined) when group has no routings
{
  const manifest = buildBrokeringRulesManifest({
    pageRoute: "/tabs/circuit",
    orderRoutingId: "ROUTING_A",
    routingName: "East Coast",
    routingStatus: "ROUTING_DRAFT",
    brokeringRun: {
      routingGroupId: "GROUP_1",
      groupName: "US Brokering",
      productStoreId: "STORE_1",
      schedule: null
      // routings omitted entirely
    },
    selectedRoutingRule: {},
    isTestEnabled: false,
    orderRoutingFilterOptions: {},
    orderRoutingSortOptions: {},
    inventoryRuleFilterOptions: {},
    inventoryRuleSortOptions: {},
    inventoryRuleActions: {},
    inventoryRules: [],
    rulesInformation: {},
    ruleActionType: "",
    ruleEnums: {},
    conditionFilterEnums: {},
    conditionSortEnums: {},
    actionEnums: {},
    facilities: {},
    shippingMethods: {},
    salesChannels: {},
    facilityGroups: {},
    brokeringFacilityGroups: {}
  });

  const brokeringRun = (manifest.visibleEntities as any).brokeringRun;
  assert.deepStrictEqual(brokeringRun.availableSiblingRoutings, []);
}
```

- [ ] **Step 1.3: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/brokeringRulesDraftTargets.test.ts`

Expected: AssertionError on the first new block — `brokeringRun.availableSiblingRoutings` is undefined.

- [ ] **Step 1.4: Widen `ManifestInput` to accept sibling routings**

In `apps/order-routing/src/draftTargets/BrokeringRulesDraftTargets.ts:53-83`, change the `brokeringRun` field of `ManifestInput` from:

```ts
brokeringRun?: {
  routingGroupId?: string;
  groupName?: string;
  productStoreId?: string;
  schedule?: any;
};
```

to:

```ts
brokeringRun?: {
  routingGroupId?: string;
  groupName?: string;
  productStoreId?: string;
  schedule?: any;
  routings?: Array<{
    orderRoutingId: string;
    routingName: string;
    statusId: string;
    sequenceNum: number;
  }>;
};
```

- [ ] **Step 1.5: Populate the new manifest fields in `buildBrokeringRulesManifest`**

In the same file, find the `visibleEntities.brokeringRun` literal (around `:349-355`). Add `availableSiblingRoutings`:

```ts
brokeringRun: {
  routingGroupId: input.brokeringRun?.routingGroupId || "",
  groupName: input.brokeringRun?.groupName || "",
  productStoreId: input.brokeringRun?.productStoreId || "",
  schedule: input.brokeringRun?.schedule || null,
  availableSiblingRoutings: (input.brokeringRun?.routings || []).map((r) => ({
    orderRoutingId: r.orderRoutingId,
    routingName: r.routingName,
    statusId: r.statusId,
    sequenceNum: r.sequenceNum
  })),
  note: "This is the currently open Circuit brokering run/routing group. Use this groupName when answering questions about the current brokering run."
},
```

Then in the `route.draftLimitations` literal (around `:365-370`), add `canCreateSiblingRoutings: true`:

```ts
draftLimitations: {
  selectedRuleOnly: false,
  canCreateInventoryRules: true,
  canCreateSiblingRoutings: true,
  canRenameInventoryRules: false,
  note: "Circuit can draft changes across existing inventory rules and can create new local draft inventory rules. New rules and edits are persisted only when the user saves the route."
}
```

- [ ] **Step 1.6: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/brokeringRulesDraftTargets.test.ts`

Expected: prints the existing trailing `console.log` line ("brokering rules draft targets tests passed" or equivalent — confirm by re-reading the file's last line). No assertion failure.

- [ ] **Step 1.7: Commit**

```bash
git add apps/order-routing/src/draftTargets/BrokeringRulesDraftTargets.ts apps/order-routing/tests/brokeringRulesDraftTargets.test.ts
git commit -m "Added: availableSiblingRoutings and canCreateSiblingRoutings to Circuit draft manifest"
```

---

## Task 2: Thread `routings` from CircuitCanvas into the manifest builder

**Files:**
- Modify: `apps/order-routing/src/components/circuit/CircuitCanvas.vue:832-859`

This task has no unit test (Vue SFC); correctness is covered by Task 1 + the manual verification at the end of the plan.

- [ ] **Step 2.1: Pass `routings` into `buildBrokeringRulesManifest`**

In `apps/order-routing/src/components/circuit/CircuitCanvas.vue`, find the `buildCircuitDraftManifest` function around `:827-859`. Update the `brokeringRun` arg to include the group's routings:

```ts
brokeringRun: {
  routingGroupId: group.value.routingGroupId || routingGroupId.value || "",
  groupName: groupName.value || group.value.groupName || "",
  productStoreId: group.value.productStoreId || "",
  schedule: job.value || null,
  routings: (group.value?.routings || []).map((r: any) => ({
    orderRoutingId: r.orderRoutingId,
    routingName: r.routingName,
    statusId: r.statusId,
    sequenceNum: r.sequenceNum
  }))
},
```

- [ ] **Step 2.2: Manually verify the manifest in the dev server**

Start the dev environment (two terminals):

```bash
# Terminal A — Mastra server
cd apps/order-routing && npm run mastra:dev

# Terminal B — PWA
cd apps/order-routing && ionic serve
```

Open Circuit on a brokering run with two routings. Open the browser devtools network tab. Send any prompt (e.g. "what does this routing do?"). Expected: the POST to `/brokering-route-assistant` body includes `pageCapabilityManifest.visibleEntities.brokeringRun.availableSiblingRoutings` as a populated array, and `pageCapabilityManifest.visibleEntities.route.draftLimitations.canCreateSiblingRoutings === true`.

- [ ] **Step 2.3: Commit**

```bash
git add apps/order-routing/src/components/circuit/CircuitCanvas.vue
git commit -m "Added: pass group routings into Circuit draft manifest"
```

---

## Task 3: Add `targetRouting` field to draft schema + normalizer

**Files:**
- Modify: `apps/order-routing/mastra/brokeringRouteDraftSchema.ts`
- Test: `apps/order-routing/tests/brokeringRouteDraftSchema.test.ts`

- [ ] **Step 3.1: Read the existing schema test file to understand its pattern**

Run: `cat apps/order-routing/tests/brokeringRouteDraftSchema.test.ts | head -40`

Expected: tests use `normalizeBrokeringRouteDraft` and `brokeringRouteDraftSchema.parse` directly.

- [ ] **Step 3.2: Add failing tests for `targetRouting` shape and defaulting**

Append to `apps/order-routing/tests/brokeringRouteDraftSchema.test.ts`:

```ts
// --- targetRouting discriminator ---
import { normalizeBrokeringRouteDraft as _normalize, brokeringRouteDraftSchema as _schema } from "../mastra/brokeringRouteDraftSchema";
// (skip the import if these symbols are already imported at the top of the file — keep one import)

{
  // Default: when targetRouting is omitted, normalize fills { action: "edit" }
  const normalized = _normalize({ summary: "x" });
  assert.deepStrictEqual(normalized.targetRouting, { action: "edit" });
}

{
  // action="create" with a name passes through and routingKey is prefixed
  const normalized = _normalize({
    summary: "x",
    targetRouting: { action: "create", routingKey: "west-coast", name: "West Coast" }
  });
  assert.equal(normalized.targetRouting?.action, "create");
  assert.equal(normalized.targetRouting?.name, "West Coast");
  assert.equal(normalized.targetRouting?.routingKey, "new:west-coast", "routingKey should be normalized to a new: prefix on create");
}

{
  // action="create" with already-prefixed routingKey is left alone
  const normalized = _normalize({
    summary: "x",
    targetRouting: { action: "create", routingKey: "new:already-prefixed", name: "Foo" }
  });
  assert.equal(normalized.targetRouting?.routingKey, "new:already-prefixed");
}

{
  // action="edit" strips any stray name (avoid leaking model mistakes downstream)
  const normalized = _normalize({
    summary: "x",
    targetRouting: { action: "edit", name: "ignored" }
  });
  assert.equal(normalized.targetRouting?.action, "edit");
  assert.equal(normalized.targetRouting?.name, undefined);
}

{
  // Malformed targetRouting falls back to edit default
  const normalized = _normalize({
    summary: "x",
    targetRouting: { action: "garbage" }
  });
  assert.deepStrictEqual(normalized.targetRouting, { action: "edit" });
}
```

If the imports at the top of the file already cover `normalizeBrokeringRouteDraft`, drop the inline import line and use the existing names.

- [ ] **Step 3.3: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/brokeringRouteDraftSchema.test.ts`

Expected: failure on the first new block — `normalized.targetRouting` is undefined.

- [ ] **Step 3.4: Add the schema field**

In `apps/order-routing/mastra/brokeringRouteDraftSchema.ts`, just above `export const brokeringRouteDraftSchema`, add:

```ts
const targetRoutingSchema = z.object({
  action: z.enum(["edit", "create"]),
  routingKey: z.string().min(1).optional(),
  name: z.string().min(1).max(80).optional()
}).strict();
```

Then modify the `brokeringRouteDraftSchema` definition to include `targetRouting`:

```ts
export const brokeringRouteDraftSchema = z.object({
  schemaVersion: z.literal("brokering-route-draft.v1"),
  applyMode: z.enum(["merge", "replace"]),
  targetRouting: targetRoutingSchema.optional(),
  route: z.object({
    statusId: routeStatusSchema,
    orderSelection: orderSelectionSchema,
    inventoryRules: z.array(inventoryRuleSchema)
  }).strict(),
  questions: z.array(z.string()),
  summary: z.string().min(1)
}).strict();
```

- [ ] **Step 3.5: Add a normalize helper**

In the same file, just before `function normalizeApplyMode` (around line 115), add:

```ts
function normalizeTargetRouting(value: unknown): BrokeringRouteDraft["targetRouting"] {
  if (!value || typeof value !== "object") return { action: "edit" };
  const v = value as Record<string, unknown>;
  if (v.action === "create") {
    const name = typeof v.name === "string" && v.name.trim() ? v.name.trim() : undefined;
    const rawKey = typeof v.routingKey === "string" && v.routingKey.trim() ? v.routingKey.trim() : "";
    const routingKey = rawKey
      ? (rawKey.startsWith("new:") ? rawKey : `new:${rawKey}`)
      : undefined;
    return { action: "create", routingKey, name };
  }
  // Any value other than "create" — including unknown strings — falls back to edit.
  // Edit branch never carries a name.
  return { action: "edit" };
}
```

And wire it into the existing `normalizeBrokeringRouteDraft` (around line 97):

```ts
export function normalizeBrokeringRouteDraft(value: any): BrokeringRouteDraft {
  return brokeringRouteDraftSchema.parse({
    schemaVersion: "brokering-route-draft.v1",
    applyMode: normalizeApplyMode(value?.applyMode),
    targetRouting: normalizeTargetRouting(value?.targetRouting),
    route: {
      statusId: normalizeRouteStatus(value?.route?.statusId),
      orderSelection: normalizeOrderSelection(value?.route?.orderSelection),
      inventoryRules: Array.isArray(value?.route?.inventoryRules)
        ? value.route.inventoryRules.map(normalizeInventoryRule)
        : []
    },
    questions: Array.isArray(value?.questions) ? value.questions.map(String).filter(Boolean) : [],
    summary: typeof value?.summary === "string" && value.summary.trim()
      ? value.summary.trim()
      : "Drafted brokering route changes."
  });
}
```

- [ ] **Step 3.6: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/brokeringRouteDraftSchema.test.ts`

Expected: existing trailing `console.log` line, no assertion failure.

- [ ] **Step 3.7: Commit**

```bash
git add apps/order-routing/mastra/brokeringRouteDraftSchema.ts apps/order-routing/tests/brokeringRouteDraftSchema.test.ts
git commit -m "Added: targetRouting discriminator to brokering route draft schema"
```

---

## Task 4: Mirror `targetRouting` into the PWA-side draft types and request layer

**Files:**
- Modify: `apps/order-routing/src/services/DraftAssistantService.ts:25-30` (`DraftOperationSet`), `:32-58` (`BrokeringRouteDraft` mirror type), `:280-323` (`requestBrokeringRouteDraftOperations` + `convertBrokeringRouteDraftToOperations`)
- Test: `apps/order-routing/tests/draftAssistantService.test.ts`

- [ ] **Step 4.1: Add a failing test that `convertBrokeringRouteDraftToOperations` carries `targetRouting` through**

Append to `apps/order-routing/tests/draftAssistantService.test.ts`:

```ts
// --- targetRouting passthrough ---
import {
  convertBrokeringRouteDraftToOperations as _convert,
  type BrokeringRouteDraft as _Draft
} from "../src/services/DraftAssistantService";

{
  const minimalManifest: any = {
    pageId: "order-routing.rules",
    route: "/tabs/circuit",
    visibleEntities: {
      brokeringRun: { availableSiblingRoutings: [] },
      route: { draftLimitations: { canCreateSiblingRoutings: true } }
    },
    editableTargets: [],
    outputContract: {}
  };

  const draft: _Draft = {
    schemaVersion: "brokering-route-draft.v1",
    applyMode: "merge",
    targetRouting: { action: "create", routingKey: "new:foo", name: "Foo" },
    route: {
      statusId: "ROUTING_DRAFT",
      orderSelection: {
        filters: {
          queues: { include: [], exclude: [] },
          shippingMethods: { include: [], exclude: [] },
          priorities: { include: [], exclude: [] },
          promiseDateDays: { max: null, excludeMax: null },
          salesChannels: { include: [], exclude: [] },
          originFacilityGroups: { include: [], exclude: [] }
        },
        sorts: []
      },
      inventoryRules: []
    },
    questions: [],
    summary: "Create Foo"
  };

  const set = _convert(draft, minimalManifest);
  assert.deepStrictEqual(set.targetRouting, { action: "create", routingKey: "new:foo", name: "Foo" });
}
```

If the imports at the top of the file already cover those names, drop the inline import.

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/draftAssistantService.test.ts`

Expected: TS error or assertion failure — `DraftOperationSet` does not have `targetRouting`.

- [ ] **Step 4.3: Extend `BrokeringRouteDraft` mirror type with `targetRouting`**

In `apps/order-routing/src/services/DraftAssistantService.ts:32-58`, modify the `BrokeringRouteDraft` type:

```ts
export type BrokeringRouteDraft = {
  schemaVersion: "brokering-route-draft.v1";
  applyMode: "merge" | "replace";
  targetRouting?: {
    action: "edit" | "create";
    routingKey?: string;
    name?: string;
  };
  route: {
    statusId: "ROUTING_DRAFT" | "ROUTING_ACTIVE" | "ROUTING_ARCHIVED";
    // ...rest unchanged
  };
  questions: string[];
  summary: string;
};
```

- [ ] **Step 4.4: Extend `DraftOperationSet` with `targetRouting`**

In the same file at `:25-30`, modify:

```ts
export type DraftOperationSet = {
  operations: DraftOperation[];
  unansweredQuestions: string[];
  summary: string;
  intent?: "edit" | "inquiry";
  targetRouting?: {
    action: "edit" | "create";
    routingKey?: string;
    name?: string;
  };
};
```

- [ ] **Step 4.5: Pass `targetRouting` through `convertBrokeringRouteDraftToOperations`**

In the same file around `:325-345`, modify the function's return value:

```ts
export function convertBrokeringRouteDraftToOperations(draft: BrokeringRouteDraft, manifest: PageCapabilityManifest): DraftOperationSet {
  const operations: DraftOperation[] = [];

  addOperation(operations, manifest, "route.statusId", draft.route.statusId, { skipUnchanged: true });
  addOptionSelectionOperations(operations, manifest, draft.route.orderSelection.filters.queues, orderFilterTargets.queues);
  addOptionSelectionOperations(operations, manifest, draft.route.orderSelection.filters.shippingMethods, orderFilterTargets.shippingMethods);
  addOptionSelectionOperations(operations, manifest, draft.route.orderSelection.filters.priorities, orderFilterTargets.priorities);
  addOperation(operations, manifest, "route.orderFilters.PROMISE_DATE", draft.route.orderSelection.filters.promiseDateDays.max, { skipEmpty: true });
  addOperation(operations, manifest, "route.orderFilters.PROMISE_DATE_EXCLUDED", draft.route.orderSelection.filters.promiseDateDays.excludeMax, { skipEmpty: true });
  addOptionSelectionOperations(operations, manifest, draft.route.orderSelection.filters.salesChannels, orderFilterTargets.salesChannels);
  addOptionSelectionOperations(operations, manifest, draft.route.orderSelection.filters.originFacilityGroups, orderFilterTargets.originFacilityGroups);
  draft.route.orderSelection.sorts.forEach((sort) => addOperation(operations, manifest, orderSortTargets[sort.field], true, { skipUnchanged: true }));

  draft.route.inventoryRules.forEach((rule) => addSelectedRuleOperations(operations, manifest, rule));

  return {
    operations,
    unansweredQuestions: [...(draft.questions || [])],
    summary: draft.summary || "Draft updated",
    targetRouting: draft.targetRouting
  };
}
```

- [ ] **Step 4.6: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/draftAssistantService.test.ts`

Expected: existing trailing log, no failure.

- [ ] **Step 4.7: Commit**

```bash
git add apps/order-routing/src/services/DraftAssistantService.ts apps/order-routing/tests/draftAssistantService.test.ts
git commit -m "Added: targetRouting passthrough on PWA-side draft types"
```

---

## Task 5: Validator branch for `action="create"`

**Files:**
- Modify: `apps/order-routing/mastra/brokeringRouteDraftValidator.ts:145-159` (`validateBrokeringRouteDraftAgainstManifest`)
- Test: `apps/order-routing/tests/brokeringRouteDraftValidator.test.ts`

- [ ] **Step 5.1: Add failing tests for the create branch**

Append to `apps/order-routing/tests/brokeringRouteDraftValidator.test.ts` (the file already has `validDraft()` and `validationError()` helpers + the `manifest` fixture):

```ts
// --- targetRouting.action="create" validation ---

// Helper: extend the existing manifest with sibling-routing fields for create tests.
function manifestWithSiblings(siblings: Array<{ orderRoutingId: string; routingName: string; statusId: string; sequenceNum: number }>, allow = true): PageCapabilityManifest {
  return {
    ...manifest,
    visibleEntities: {
      ...(manifest.visibleEntities as any),
      brokeringRun: { availableSiblingRoutings: siblings },
      route: { draftLimitations: { canCreateSiblingRoutings: allow } }
    }
  };
}

// Happy path: create with new: ruleKey, unique name
{
  const draft = validDraft({
    targetRouting: { action: "create", routingKey: "new:west-coast", name: "West Coast" }
  });
  const result = validateBrokeringRouteDraftJson(draft, manifestWithSiblings([
    { orderRoutingId: "ROUTING_A", routingName: "East Coast", statusId: "ROUTING_ACTIVE", sequenceNum: 20 }
  ]));
  assert.equal(result.targetRouting?.action, "create");
  assert.equal(result.targetRouting?.routingKey, "new:west-coast");
}

// Reject: canCreateSiblingRoutings = false blocks creation
{
  const draft = validDraft({
    targetRouting: { action: "create", routingKey: "new:x", name: "X" }
  });
  let caught: any;
  try {
    validateBrokeringRouteDraftJson(draft, manifestWithSiblings([], false));
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof BrokeringRouteDraftValidationError, "must throw when creation is disallowed");
  assert.match(String(caught.issues?.[0] ?? caught.message), /not permitted/i);
}

// Reject: missing name
{
  const draft = validDraft({
    targetRouting: { action: "create", routingKey: "new:x" }
  });
  let caught: any;
  try {
    validateBrokeringRouteDraftJson(draft, manifestWithSiblings([]));
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof BrokeringRouteDraftValidationError, "must throw when name is missing");
  assert.match(String(caught.issues?.[0] ?? caught.message), /non-empty name/i);
}

// Reject: routingKey without new: prefix
{
  const draft = validDraft({
    targetRouting: { action: "create", routingKey: "west-coast", name: "West Coast" }
  });
  // Build the draft directly (bypassing normalize) so we can test the validator's own gate.
  // Because normalize adds the prefix, simulate a raw draft via JSON round-trip:
  const raw = JSON.parse(JSON.stringify(draft));
  raw.targetRouting.routingKey = "west-coast"; // re-strip after normalize would have added it
  let caught: any;
  try {
    validateBrokeringRouteDraftJson(raw, manifestWithSiblings([]));
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof BrokeringRouteDraftValidationError, "must throw when routingKey is missing the new: prefix");
  assert.match(String(caught.issues?.[0] ?? caught.message), /new:/);
}

// Reject: name collision with non-archived sibling (case-insensitive)
{
  const draft = validDraft({
    targetRouting: { action: "create", routingKey: "new:east-coast", name: "east COAST" }
  });
  let caught: any;
  try {
    validateBrokeringRouteDraftJson(draft, manifestWithSiblings([
      { orderRoutingId: "ROUTING_A", routingName: "East Coast", statusId: "ROUTING_ACTIVE", sequenceNum: 20 }
    ]));
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof BrokeringRouteDraftValidationError, "must throw on case-insensitive name collision");
  assert.match(String(caught.issues?.[0] ?? caught.message), /already exists/i);
}

// Allow: archived sibling with the same name does NOT collide
{
  const draft = validDraft({
    targetRouting: { action: "create", routingKey: "new:east-coast", name: "East Coast" }
  });
  const result = validateBrokeringRouteDraftJson(draft, manifestWithSiblings([
    { orderRoutingId: "ROUTING_OLD", routingName: "East Coast", statusId: "ROUTING_ARCHIVED", sequenceNum: 10 }
  ]));
  assert.equal(result.targetRouting?.action, "create");
}

// Reject: inventory rule with non-new: key on a create draft
{
  const draft = validDraft({
    targetRouting: { action: "create", routingKey: "new:x", name: "X" }
  });
  // Mutate the first inventory rule's ruleKey so it's not "new:"
  draft.route.inventoryRules[0].ruleKey = "EXISTING_RULE_ID";
  let caught: any;
  try {
    validateBrokeringRouteDraftJson(draft, manifestWithSiblings([]));
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof BrokeringRouteDraftValidationError, "must throw when a create draft references a non-new rule");
  assert.match(String(caught.issues?.[0] ?? caught.message), /new:/);
}

// Edit path with sibling fields present must still validate (back-compat)
{
  const draft = validDraft(); // no targetRouting
  const result = validateBrokeringRouteDraftJson(draft, manifestWithSiblings([
    { orderRoutingId: "ROUTING_A", routingName: "East Coast", statusId: "ROUTING_ACTIVE", sequenceNum: 20 }
  ]));
  assert.equal(result.targetRouting?.action, "edit");
}
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/brokeringRouteDraftValidator.test.ts`

Expected: assertion failures on each new block — the validator currently accepts everything (or asserts `result.targetRouting?.action` which is undefined when the field is missing).

- [ ] **Step 5.3: Add the validator branch**

In `apps/order-routing/mastra/brokeringRouteDraftValidator.ts:145-159`, replace `validateBrokeringRouteDraftAgainstManifest` with:

```ts
function validateBrokeringRouteDraftAgainstManifest(draft: BrokeringRouteDraft, manifest: PageCapabilityManifest) {
  const context: ValidationContext = {
    issues: [],
    targets: new Map((manifest.editableTargets as DraftTargetCapability[]).map((target) => [target.target, target])),
    currentValues: new Map(
      (manifest.editableTargets as DraftTargetCapability[]).map((target) => [target.target, target.currentValue])
    )
  };

  validateTargetRoutingForCreate(context, draft, manifest);

  validateTargetChange(context, "route.statusId", draft.route.statusId, "route.statusId");
  validateOrderSelection(context, draft.route.orderSelection);
  draft.route.inventoryRules.forEach((rule, index) => validateInventoryRule(context, rule, `route.inventoryRules[${index}]`));

  return context.issues;
}

function validateTargetRoutingForCreate(context: ValidationContext, draft: BrokeringRouteDraft, manifest: PageCapabilityManifest) {
  if (draft.targetRouting?.action !== "create") return;

  const visible = manifest.visibleEntities as any;
  const allow = Boolean(visible?.route?.draftLimitations?.canCreateSiblingRoutings);
  if (!allow) {
    context.issues.push("Creating a sibling routing is not permitted in this context.");
    return;
  }

  const name = draft.targetRouting.name?.trim();
  if (!name) {
    context.issues.push("Sibling routing requires a non-empty name.");
    return;
  }

  const key = draft.targetRouting.routingKey || "";
  if (!key.startsWith("new:")) {
    context.issues.push('targetRouting.routingKey must start with "new:" when creating a sibling routing.');
    return;
  }

  const siblings: Array<{ routingName: string; statusId: string }> = Array.isArray(visible?.brokeringRun?.availableSiblingRoutings)
    ? visible.brokeringRun.availableSiblingRoutings
    : [];
  const collision = siblings.some((sibling) =>
    sibling.statusId !== "ROUTING_ARCHIVED" &&
    String(sibling.routingName || "").trim().toLowerCase() === name.toLowerCase()
  );
  if (collision) {
    context.issues.push(`A routing named "${name}" already exists in this group.`);
    return;
  }

  draft.route.inventoryRules.forEach((rule, index) => {
    if (!rule.ruleKey.startsWith("new:")) {
      context.issues.push(`On a new sibling routing, every inventoryRules[${index}].ruleKey must start with "new:" (got "${rule.ruleKey}").`);
    }
  });
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/brokeringRouteDraftValidator.test.ts`

Expected: trailing `console.log`, no assertion failure.

- [ ] **Step 5.5: Commit**

```bash
git add apps/order-routing/mastra/brokeringRouteDraftValidator.ts apps/order-routing/tests/brokeringRouteDraftValidator.test.ts
git commit -m "Added: validator branch for targetRouting.action=create"
```

---

## Task 6: Add `newRouting` to `DraftProposal`, populate from `createDraftProposal`, render in proposal sections

**Files:**
- Modify: `apps/order-routing/src/services/DraftAssistantService.ts:102-108` (`DraftProposal`), `:347-359` (`createDraftProposal`), `:916+` (`formatDraftProposalSections`)
- Test: `apps/order-routing/tests/draftAssistantService.test.ts`

- [ ] **Step 6.1: Add a failing test that `createDraftProposal` reads `plan.targetRouting`**

Append to `apps/order-routing/tests/draftAssistantService.test.ts`:

```ts
// --- createDraftProposal surfaces newRouting when targetRouting.action=create ---
import { createDraftProposal as _createProposal, formatDraftProposalSections as _formatSections } from "../src/services/DraftAssistantService";

{
  const minimalManifest: any = {
    pageId: "order-routing.rules",
    route: "/tabs/circuit",
    visibleEntities: {
      brokeringRun: { availableSiblingRoutings: [] },
      route: { draftLimitations: { canCreateSiblingRoutings: true } }
    },
    editableTargets: [],
    outputContract: {}
  };

  const proposal = _createProposal({
    operations: [],
    unansweredQuestions: [],
    summary: "Create West Coast",
    intent: "edit",
    targetRouting: { action: "create", routingKey: "new:west-coast", name: "West Coast" }
  }, minimalManifest);

  assert.deepStrictEqual(proposal.newRouting, { routingKey: "new:west-coast", name: "West Coast" });
}

{
  // Edit path: no newRouting on the proposal
  const minimalManifest: any = {
    pageId: "order-routing.rules",
    route: "/tabs/circuit",
    visibleEntities: { brokeringRun: { availableSiblingRoutings: [] }, route: { draftLimitations: { canCreateSiblingRoutings: true } } },
    editableTargets: [],
    outputContract: {}
  };
  const proposal = _createProposal({
    operations: [],
    unansweredQuestions: [],
    summary: "Edited",
    intent: "edit"
  }, minimalManifest);
  assert.equal(proposal.newRouting, undefined);
}

{
  // formatDraftProposalSections prepends a "Create new routing" section when newRouting is set
  const minimalManifest: any = {
    pageId: "order-routing.rules",
    route: "/tabs/circuit",
    visibleEntities: {},
    editableTargets: [],
    outputContract: {}
  };
  const rendered = _formatSections([], minimalManifest, { routingKey: "new:west-coast", name: "West Coast" });
  assert.match(rendered, /Create new routing/);
  assert.match(rendered, /West Coast/);
}
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/draftAssistantService.test.ts`

Expected: TS error / assertion failure — `newRouting` is not a property on `DraftProposal`, and `formatDraftProposalSections` does not accept a third arg.

- [ ] **Step 6.3: Extend `DraftProposal` with `newRouting`**

In `apps/order-routing/src/services/DraftAssistantService.ts:102-108`:

```ts
export type DraftProposal = {
  operations: DraftOperation[];
  unansweredQuestions: string[];
  summary: string;
  providerSummary: string;
  intent?: "edit" | "inquiry";
  newRouting?: { routingKey: string; name: string };
};
```

- [ ] **Step 6.4: Populate `newRouting` from `createDraftProposal`**

In the same file at `:347-359`, modify `createDraftProposal`:

```ts
export function createDraftProposal(plan: DraftOperationSet, manifest: PageCapabilityManifest): DraftProposal {
  const validation = validateDraftOperations(plan.operations || [], manifest);
  const unansweredProviderQuestions = plan.intent === "inquiry"
    ? filterAnsweredInquiryQuestions(plan.unansweredQuestions || [], plan.summary || "", manifest)
    : filterAnsweredQuestions(plan.unansweredQuestions || [], validation.operations, manifest);

  const newRouting = plan.targetRouting?.action === "create" && plan.targetRouting.routingKey && plan.targetRouting.name
    ? { routingKey: plan.targetRouting.routingKey, name: plan.targetRouting.name }
    : undefined;

  return {
    operations: validation.operations,
    unansweredQuestions: [...unansweredProviderQuestions, ...validation.unansweredQuestions],
    summary: summarizeDraftOperations(validation.operations, manifest) || plan.summary || "Draft updated",
    providerSummary: plan.summary || "",
    intent: plan.intent,
    newRouting
  };
}
```

- [ ] **Step 6.5: Extend `formatDraftProposalSections` with an optional `newRouting` arg**

In the same file at `:916-951` (the `formatDraftProposalSections` declaration), replace the entire function body with the version below. The change is purely additive: same logic, then a new branch that prepends a "Create new routing" header.

```ts
export function formatDraftProposalSections(
  operations: DraftOperation[],
  manifest: PageCapabilityManifest,
  newRouting?: { routingKey: string; name: string }
) {
  const validation = validateDraftOperations(operations, manifest);
  const targetCapabilities = new Map(manifest.editableTargets.map((target) => [target.target, target]));
  const sections: Array<{ key: string; title: string; lines: string[] }> = [];
  const sectionIndexes = new Map<string, number>();

  validation.operations.forEach((operation) => {
    const target = targetCapabilities.get(operation.target);
    if (!target) {
      return;
    }

    const line = formatDraftOperationLine(operation, target);
    if (!line) {
      return;
    }

    const section = getDraftOperationSection(operation);
    let sectionIndex = sectionIndexes.get(section.key);
    if (sectionIndex === undefined) {
      sectionIndex = sections.length;
      sectionIndexes.set(section.key, sectionIndex);
      sections.push({
        ...section,
        lines: []
      });
    }

    sections[sectionIndex].lines.push(line);
  });

  const body = sections
    .filter((section) => section.lines.length)
    .map((section) => [section.title, ...section.lines].join("\n"))
    .join("\n\n");

  if (!newRouting) return body;

  const header = [
    "Create new routing",
    `- Name: ${newRouting.name}`,
    "- Status: Draft (unsaved)"
  ].join("\n");

  return body ? `${header}\n\n${body}` : header;
}
```

- [ ] **Step 6.6: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/draftAssistantService.test.ts`

Expected: trailing log, no failure.

- [ ] **Step 6.7: Commit**

```bash
git add apps/order-routing/src/services/DraftAssistantService.ts apps/order-routing/tests/draftAssistantService.test.ts
git commit -m "Added: newRouting field on DraftProposal and proposal section rendering"
```

---

## Task 7: Add `applyDraftProposal(proposal, manifest, ctx)` wrapper

**Files:**
- Modify: `apps/order-routing/src/services/DraftAssistantService.ts:865+` (after `applyDraftOperations`)
- Test: `apps/order-routing/tests/draftAssistantService.test.ts`

- [ ] **Step 7.1: Add failing tests for the wrapper**

Append to `apps/order-routing/tests/draftAssistantService.test.ts`:

```ts
// --- applyDraftProposal wrapper ---
import { applyDraftProposal as _applyProposal, type DraftProposal as _Proposal } from "../src/services/DraftAssistantService";

{
  // With newRouting: createSiblingRouting → selectRouting → buildBindings, in that order
  const callOrder: string[] = [];
  const ctx = {
    createSiblingRouting: async (name: string) => {
      callOrder.push(`create:${name}`);
      return "NEW_ID";
    },
    selectRouting: (id: string) => {
      callOrder.push(`select:${id}`);
    },
    buildBindings: () => {
      callOrder.push("buildBindings");
      return {};
    }
  };
  const proposal: _Proposal = {
    operations: [],
    unansweredQuestions: [],
    summary: "",
    providerSummary: "",
    newRouting: { routingKey: "new:x", name: "X" }
  };
  const minimalManifest: any = { pageId: "x", route: "/x", visibleEntities: {}, editableTargets: [], outputContract: {} };
  await _applyProposal(proposal, minimalManifest, ctx);
  assert.deepStrictEqual(callOrder, ["create:X", "select:NEW_ID", "buildBindings"]);
}

{
  // Without newRouting: create/select are skipped entirely
  const callOrder: string[] = [];
  const ctx = {
    createSiblingRouting: async () => { callOrder.push("create"); return ""; },
    selectRouting: () => { callOrder.push("select"); },
    buildBindings: () => { callOrder.push("buildBindings"); return {}; }
  };
  const proposal: _Proposal = {
    operations: [],
    unansweredQuestions: [],
    summary: "",
    providerSummary: ""
  };
  const minimalManifest: any = { pageId: "x", route: "/x", visibleEntities: {}, editableTargets: [], outputContract: {} };
  await _applyProposal(proposal, minimalManifest, ctx);
  assert.deepStrictEqual(callOrder, ["buildBindings"]);
}

{
  // createSiblingRouting returning "" short-circuits; bindings are never built
  const callOrder: string[] = [];
  const ctx = {
    createSiblingRouting: async () => { callOrder.push("create"); return ""; },
    selectRouting: () => { callOrder.push("select"); },
    buildBindings: () => { callOrder.push("buildBindings"); return {}; }
  };
  const proposal: _Proposal = {
    operations: [],
    unansweredQuestions: [],
    summary: "",
    providerSummary: "",
    newRouting: { routingKey: "new:x", name: "X" }
  };
  const minimalManifest: any = { pageId: "x", route: "/x", visibleEntities: {}, editableTargets: [], outputContract: {} };
  const result = await _applyProposal(proposal, minimalManifest, ctx);
  assert.deepStrictEqual(callOrder, ["create"], "select and buildBindings must NOT run when create fails");
  assert.equal(result.appliedCount, 0);
}
```

- [ ] **Step 7.2: Run the test to verify it fails**

Run: `cd apps/order-routing && npx tsx tests/draftAssistantService.test.ts`

Expected: TS error — `applyDraftProposal` not exported.

- [ ] **Step 7.3: Implement `applyDraftProposal`**

In `apps/order-routing/src/services/DraftAssistantService.ts`, immediately after `applyDraftOperations` (around `:865-896`), add:

```ts
export interface ApplyDraftProposalContext {
  createSiblingRouting: (name: string) => Promise<string>;
  selectRouting: (orderRoutingId: string) => void;
  buildBindings: () => DraftTargetBindings;
}

export async function applyDraftProposal(
  proposal: DraftProposal,
  manifest: PageCapabilityManifest,
  ctx: ApplyDraftProposalContext
): Promise<DraftApplyResult> {
  if (proposal.newRouting) {
    const newId = await ctx.createSiblingRouting(proposal.newRouting.name);
    if (!newId) {
      return {
        appliedCount: 0,
        skipped: ["Failed to create sibling routing"],
        unansweredQuestions: []
      };
    }
    ctx.selectRouting(newId);
  }
  const bindings = ctx.buildBindings();
  return applyDraftOperations(proposal.operations || [], manifest, bindings);
}
```

- [ ] **Step 7.4: Run the test to verify it passes**

Run: `cd apps/order-routing && npx tsx tests/draftAssistantService.test.ts`

Expected: trailing log, no failure.

- [ ] **Step 7.5: Commit**

```bash
git add apps/order-routing/src/services/DraftAssistantService.ts apps/order-routing/tests/draftAssistantService.test.ts
git commit -m "Added: applyDraftProposal wrapper handling sibling routing creation"
```

---

## Task 8: Wire `CircuitCanvas` to `applyDraftProposal`

**Files:**
- Modify: `apps/order-routing/src/components/circuit/CircuitCanvas.vue:683-732` (`prepareCircuitDraftProposal`), `:735-755` (`applyCircuitDraftProposal`)

No unit test (Vue SFC); manual verification at Task 10 covers this.

- [ ] **Step 8.1: Update the `pendingProposal` gate in `prepareCircuitDraftProposal` so a create-only proposal is still a proposal**

In `apps/order-routing/src/components/circuit/CircuitCanvas.vue`, find the `pendingProposal` literal around `:694-701`. Change the conditional from `proposal.operations.length` to `proposal.operations.length || proposal.newRouting`:

```ts
const pendingProposal: CircuitDraftProposal | null = (proposal.operations.length || proposal.newRouting)
  ? {
    ...proposal,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourcePrompt: prompt,
    createdAt: Date.now()
  }
  : null;
```

- [ ] **Step 8.2: Pass `newRouting` into `formatDraftProposalSections` via `formatDraftProposalMessage`**

In the same file find `formatDraftProposalMessage` (around `:793-813`). Update the call to `formatDraftProposalSections(...)` to pass `proposal.newRouting`:

```ts
function formatDraftProposalMessage(proposal: CircuitDraftProposal, manifest: any) {
  const formattedSections = formatDraftProposalSections(proposal.operations || [], manifest, proposal.newRouting);
  // ... rest of the function body unchanged
}
```

- [ ] **Step 8.3: Replace `applyDraftOperations` with `applyDraftProposal` in `applyCircuitDraftProposal`**

In the same file, find `applyCircuitDraftProposal` around `:735-755`. Replace its body:

```ts
async function applyCircuitDraftProposal(proposal: CircuitDraftProposal) {
  if (!activeRouting.value?.orderRoutingId) {
    return {
      appliedCount: 0,
      message: translate("Select a routing context before asking Circuit to draft changes.")
    };
  }

  const manifest = await buildCircuitDraftManifest();

  const result = await applyDraftProposal(proposal, manifest, {
    createSiblingRouting: async (name: string) => {
      const existing = group.value?.routings || [];
      const tail = existing[existing.length - 1];
      const sequenceNum = tail?.sequenceNum >= 0 ? tail.sequenceNum + 5 : 0;
      const newId = await routingStore.createOrderRouting({
        orderRoutingId: "",
        routingGroupId: routingGroupId.value!,
        statusId: "ROUTING_DRAFT",
        routingName: name,
        sequenceNum,
        description: "",
        createdDate: DateTime.now().toMillis()
      });
      return newId || "";
    },
    selectRouting: (id: string) => {
      group.value = routingStore.currentGroup;
      const created = group.value.routings?.find((r: any) => r.orderRoutingId === id);
      if (created) selectRouting(created);
    },
    buildBindings: () => buildCircuitDraftBindings()
  });

  hasUnsavedChanges.value = true;

  const unansweredQuestions = [...(proposal.unansweredQuestions || []), ...result.unansweredQuestions];

  if (unansweredQuestions.length) {
    commonUtil.showToast(unansweredQuestions[0]);
    return {
      appliedCount: result.appliedCount,
      message: unansweredQuestions[0]
    };
  }

  return {
    appliedCount: result.appliedCount,
    message: proposal.summary || translate("No matching UI values found"),
    intent: proposal.intent
  };
}
```

- [ ] **Step 8.4: Update the import line**

Near the top of the same file (`:602`), change the existing import:

```ts
import { applyDraftOperations, createDraftProposal, DraftConversationMessage, DraftProposal, formatDraftProposalSections, requestBrokeringRouteDraftOperations, summarizeDraftOperations } from "@/services/DraftAssistantService";
```

to:

```ts
import { applyDraftProposal, createDraftProposal, DraftConversationMessage, DraftProposal, formatDraftProposalSections, requestBrokeringRouteDraftOperations, summarizeDraftOperations } from "@/services/DraftAssistantService";
```

(Drop `applyDraftOperations` — the wrapper is the only caller now.)

If `DateTime` isn't already imported in this SFC, add `import { DateTime } from "luxon";` near the other imports — `useCreateRouting.ts` shows the same pattern.

- [ ] **Step 8.5: Type-check / lint**

Run: `cd apps/order-routing && npm run lint`

Expected: no new errors in `CircuitCanvas.vue` or `DraftAssistantService.ts`.

- [ ] **Step 8.6: Commit**

```bash
git add apps/order-routing/src/components/circuit/CircuitCanvas.vue
git commit -m "Added: Circuit canvas wires applyDraftProposal for sibling routing creation"
```

---

## Task 9: Append three instruction lines to the draft agent

**Files:**
- Modify: `apps/order-routing/mastra/index.ts:50-76` (`brokeringRouteDraftInstructions`)

No unit test for instruction strings; manual verification covers it.

- [ ] **Step 9.1: Append the three lines to `brokeringRouteDraftInstructions`**

In `apps/order-routing/mastra/index.ts`, find the `brokeringRouteDraftInstructions` array (declared around `:50-76`). Append these three strings to the array, before the existing trailing entry `"Return only data that fits the structured output schema."`:

```ts
"To create a sibling routing inside the current brokering run, set targetRouting.action='create', pick a routingKey like 'new:west-coast-warehouse', and supply a short human name derived from the user's intent. Never propose a name that already appears in pageCapabilityManifest.visibleEntities.brokeringRun.availableSiblingRoutings for a non-archived routing.",
"When creating a sibling routing, the draft's route.orderSelection and route.inventoryRules[] describe that NEW routing — not the currently open one. All inventoryRules[].ruleKey values must start with 'new:' because the new routing has no existing rules.",
"Only set targetRouting.action='create' when the user explicitly asks to add another routing. If they describe edits to the currently open route, omit targetRouting entirely (or use action='edit').",
```

- [ ] **Step 9.2: Restart the Mastra dev server so the new instructions are loaded**

If `npm run mastra:dev` is running, stop it and restart:

```bash
cd apps/order-routing && npm run mastra:dev
```

Expected: server logs show it bound to `MASTRA_PORT` (default 4111) without parse errors.

- [ ] **Step 9.3: Commit**

```bash
git add apps/order-routing/mastra/index.ts
git commit -m "Added: draft agent instructions for sibling routing creation"
```

---

## Task 10: End-to-end manual verification

**Files:** none. Verification only.

Pre-reqs: `npm run mastra:dev` and `ionic serve` both running. `OPENAI_API_KEY` (or `VITE_OPENAI_API_KEY`) set; otherwise the assistant returns a "provider unavailable" payload and these checks won't exercise the new code.

- [ ] **Step 10.1: Happy path — create routing with initial contents**

1. Open Circuit on a brokering run with at least one existing routing.
2. Select that existing routing so Circuit has an active routing context.
3. In the chat, send: "Add a new routing for west-coast warehouse fulfillment that ships from CA, OR, and WA warehouses, with proximity sorting ascending."

Expected:
- Circuit returns a proposal preview.
- The preview's first section reads "Create new routing" with name "West Coast …" (exact wording depends on model output).
- Following sections describe the inventory rule(s) and filters.
- Click Apply.
- The routing list (left panel of Circuit) shows the new routing.
- Circuit auto-selects the new routing; its rule(s) are visible in the right panel.
- `hasUnsavedChanges` is true (Save button enabled, breadcrumb shows the unsaved state).
- The network tab shows zero requests to the routing REST API since the prompt was sent.

- [ ] **Step 10.2: Save the group**

Click the Save button in the brokering run.

Expected: a POST to the routing API. Reload the page. The new routing persists.

- [ ] **Step 10.3: Name-collision rejection**

In Circuit, send: "Add a routing called <name of an existing non-archived routing>".

Expected: the chat surfaces an error message containing "already exists in this group". No state mutation.

- [ ] **Step 10.4: Edit-path regression**

In Circuit, select an existing routing. Send: "Set the proximity filter on this rule to 50 miles."

Expected: existing edit flow still works. The proposal preview does NOT include a "Create new routing" section. After Apply, the edited filter is visible on the currently selected routing.

- [ ] **Step 10.5: Cross-page visibility**

Without leaving Circuit, navigate to the `BrokeringRoute` page for the same group (use the tab or back arrow).

Expected: the new routing is visible in the routing list. `hasUnsavedChanges` is still true. Save here also persists.

- [ ] **Step 10.6: Final commit (only if any manual fix was needed)**

If verification revealed a bug and you patched it:

```bash
git add <files>
git commit -m "Fixed: <specific issue> uncovered during sibling-routing manual verification"
```

If everything passed, no commit is needed.

---

## Verification summary

After all tasks:

```bash
cd apps/order-routing
npx tsx tests/brokeringRulesDraftTargets.test.ts
npx tsx tests/brokeringRouteDraftSchema.test.ts
npx tsx tests/brokeringRouteDraftValidator.test.ts
npx tsx tests/draftAssistantService.test.ts
npm run lint
```

Expected: every test prints its trailing success log; lint emits no new errors. The manual checklist in Task 10 must all be passing.
