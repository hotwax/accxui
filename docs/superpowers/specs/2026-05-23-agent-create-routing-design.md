# Agent-driven creation of a sibling routing inside a brokering run

**Status:** Design — pending review
**Date:** 2026-05-23
**Author:** brainstorming session
**Scope:** order-routing PWA + Mastra draft agent

## Goal

Let the Circuit chat agent create a new routing inside the currently open brokering run, optionally populated with initial order filters and inventory rules, with the user reviewing and applying the proposal in the existing draft-preview UX. The PWA continues to own persistence; nothing reaches the backend until the user hits the existing Save flow.

## Non-goals

- No agent-driven deletion or archival of sibling routings.
- No multi-routing batch creation in a single turn.
- No new embedded assistant on the `BrokeringRoute` page (the new routing becomes visible there automatically via the shared `orderRoutingStore.currentGroup`).
- No new agent endpoint or new agent. Single-agent, single-endpoint extension.
- No schema-version bump (additive, optional field).
- No new persistence boundary. `orderRoutingStore.createOrderRouting()` is already a purely local Vue/Pinia mutation; we reuse it as-is.

## Background

Today the Circuit draft pipeline operates on the **single currently open routing**:

- `brokeringRouteDraftSchema` has `route` (singular). The model can edit `route.orderSelection`, `route.statusId`, and `route.inventoryRules[]` — including creating new inventory rules with `ruleKey: "new:<slug>"` (handled locally by `ensureLocalRuleDraft` in `src/draftTargets/BrokeringRulesDraftTargets.ts:536-554`).
- The manifest exposes the open routing's state plus the brokering run's metadata (`routingGroupId`, `groupName`, schedule).
- The validator (`mastra/brokeringRouteDraftValidator.ts`) ensures the draft is consistent with that manifest.
- The proposal-preview UX in `CircuitCanvas.vue` renders the operations as "Proposed draft changes" and applies them on user confirmation. The PWA only hits the backend when the user clicks Save.

The manual "+ New Routing" flow (`src/composables/useCreateRouting.ts` and `routingStore.createOrderRouting` at `src/store/orderRoutingStore.ts:350-377`) already does the right thing locally: appends a new routing to `currentGroup.routings`, sets `hasUnsavedChanges = true`, and is reversible until Save. This design wires the agent to that same store action.

## Architecture

```
User prompt in Circuit chat
  │
  ▼
CircuitCanvas.buildCircuitDraftManifest()
  ├── (existing) open route, selectedRule, brokeringRun
  ├── (NEW) visibleEntities.brokeringRun.availableSiblingRoutings[]
  └── (NEW) visibleEntities.route.draftLimitations.canCreateSiblingRoutings = true
  │
  ▼
POST /brokering-route-draft   (unchanged endpoint, unchanged agent)
  │
  ▼
brokeringRouteDraftSchema  (extended)
  + targetRouting?: { action: "edit" | "create"; routingKey?: string; name?: string }
    └── default { action: "edit" } when omitted → fully back-compat
  │
  ▼
brokeringRouteDraftValidator  (one new branch)
  if targetRouting.action === "create":
    require canCreateSiblingRoutings = true
    require name (non-empty, ≤80 chars)
    require routingKey starts with "new:"
    require name not collide with any non-archived sibling
    require every inventoryRules[].ruleKey starts with "new:"
  │
  ▼
DraftAssistantService.createDraftProposal(plan, manifest)
  → DraftProposal { ..., newRouting?: { routingKey, name } }
  │
  ▼
CircuitCanvas renders the "Proposed draft changes" preview
  with a synthetic "Create new routing" section prepended
  │
  ▼ user clicks Apply
  ▼
DraftAssistantService.applyDraftProposal(proposal, manifest, ctx)
  if proposal.newRouting:
    ctx.createSiblingRouting(name) → newOrderRoutingId
    ctx.selectRouting(newOrderRoutingId)
  bindings = ctx.buildBindings()                              ← rebuilt against the now-selected routing
  applyDraftOperations(proposal.operations, manifest, bindings) ← unchanged
  hasUnsavedChanges = true
  │
  ▼
(later) user clicks Save → existing RoutingService → backend
```

**Invariant:** persistence is unchanged. Creation lives entirely inside `routingStore.createOrderRouting()` which only mutates `currentGroup.routings` and the in-memory `groups[]` array. The backend learns about the new routing only when the user explicitly Saves.

## Changes by file

### `apps/order-routing/mastra/brokeringRouteDraftSchema.ts`

Add a top-level optional discriminator:

```ts
const targetRoutingSchema = z.object({
  action: z.enum(["edit", "create"]),
  routingKey: z.string().min(1).optional(),
  name: z.string().min(1).max(80).optional()
}).strict();

export const brokeringRouteDraftSchema = z.object({
  schemaVersion: z.literal("brokering-route-draft.v1"),
  applyMode: z.enum(["merge", "replace"]),
  targetRouting: targetRoutingSchema.optional(),   // NEW
  route: z.object({ /* unchanged */ }).strict(),
  questions: z.array(z.string()),
  summary: z.string().min(1)
}).strict();
```

`normalizeBrokeringRouteDraft()` gains a `normalizeTargetRouting()` helper that:
- returns `{ action: "edit" }` when the field is missing or malformed,
- strips `name` when `action === "edit"` (avoids stale names leaking through),
- normalizes `routingKey` to a `new:` prefix when `action === "create"` and the model emitted a plain slug.

### `apps/order-routing/mastra/pageCapabilitySchema.ts`

Two additions:

- `visibleEntities.brokeringRun.availableSiblingRoutings: Array<{ orderRoutingId: string; routingName: string; statusId: "ROUTING_DRAFT" | "ROUTING_ACTIVE" | "ROUTING_ARCHIVED"; sequenceNum: number }>`
- `visibleEntities.route.draftLimitations.canCreateSiblingRoutings: boolean`

Both are required (so the validator can rely on them) but the second defaults to `true` for the Circuit page and can be set to `false` elsewhere (e.g. a future read-only context).

### `apps/order-routing/src/draftTargets/BrokeringRulesDraftTargets.ts`

`buildBrokeringRulesManifest()` populates the two new manifest fields. Source data is already adjacent in `currentGroup.routings`:

```ts
availableSiblingRoutings: (input.brokeringRun?.routings || []).map((r: any) => ({
  orderRoutingId: r.orderRoutingId,
  routingName: r.routingName,
  statusId: r.statusId,
  sequenceNum: r.sequenceNum
})),
draftLimitations: {
  ...existing,
  canCreateSiblingRoutings: true
}
```

`ManifestInput` is widened with `brokeringRun.routings?: any[]` so the caller (`CircuitCanvas.buildCircuitDraftManifest`) can pass it through.

### `apps/order-routing/mastra/brokeringRouteDraftValidator.ts`

One new branch evaluated before the existing route-level checks:

```ts
if (draft.targetRouting?.action === "create") {
  if (!manifest.visibleEntities.route.draftLimitations?.canCreateSiblingRoutings) {
    throw new BrokeringRouteDraftValidationError([
      "Creating a sibling routing is not permitted in this context."
    ]);
  }
  const name = draft.targetRouting.name?.trim();
  if (!name) {
    throw new BrokeringRouteDraftValidationError([
      "Sibling routing requires a non-empty name."
    ]);
  }
  if (!draft.targetRouting.routingKey?.startsWith("new:")) {
    throw new BrokeringRouteDraftValidationError([
      'targetRouting.routingKey must start with "new:" when creating a sibling routing.'
    ]);
  }
  const taken = manifest.visibleEntities.brokeringRun.availableSiblingRoutings
    .filter((r) => r.statusId !== "ROUTING_ARCHIVED")
    .some((r) => r.routingName.trim().toLowerCase() === name.toLowerCase());
  if (taken) {
    throw new BrokeringRouteDraftValidationError([
      `A routing named "${name}" already exists in this group.`
    ]);
  }
  for (const rule of draft.route.inventoryRules) {
    if (!rule.ruleKey.startsWith("new:")) {
      throw new BrokeringRouteDraftValidationError([
        `On a new sibling routing every inventoryRules[].ruleKey must start with "new:" (got "${rule.ruleKey}").`
      ]);
    }
  }
}
```

The rest of the validator runs unchanged. When `action === "edit"` (the default), behaviour is exactly as today.

### `apps/order-routing/mastra/index.ts`

Three new lines appended to `brokeringRouteDraftInstructions`:

1. "To create a sibling routing inside the current brokering run, set `targetRouting.action='create'`, pick a `routingKey` like `'new:west-coast-warehouse'`, and supply a short human `name` derived from the user's intent. Never propose a `name` that already appears in `pageCapabilityManifest.visibleEntities.brokeringRun.availableSiblingRoutings` for a non-archived routing."
2. "When creating a sibling routing, the draft's `route.orderSelection` and `route.inventoryRules[]` describe that NEW routing — not the currently open one. All `inventoryRules[].ruleKey` values must start with `new:` because the new routing has no existing rules."
3. "Only set `targetRouting.action='create'` when the user explicitly asks to add another routing. If they describe edits to the currently open route, omit `targetRouting` entirely (or use `action='edit'`)."

### `apps/order-routing/src/services/DraftAssistantService.ts`

`DraftProposal` gains an optional field:

```ts
type DraftProposal = {
  intent: "draft" | "inquiry";
  operations: DraftOperation[];
  unansweredQuestions: string[];
  summary: string;
  providerSummary: string;
  newRouting?: { routingKey: string; name: string };   // NEW
};
```

`createDraftProposal()` reads `plan.targetRouting`. When `action === "create"`, it sets `proposal.newRouting = { routingKey, name }`. Otherwise `newRouting` stays undefined.

`formatDraftProposalSections(operations, manifest, newRouting?)` accepts an optional third arg. When `newRouting` is set, it prepends one synthetic section:

```
Create new routing
  - Name: West Coast Warehouse
  - Sequence: 25 (after "East Coast")
  - Status: Draft (unsaved)
```

A new exported function `applyDraftProposal(proposal, manifest, ctx)`:

```ts
export async function applyDraftProposal(
  proposal: DraftProposal,
  manifest: PageCapabilityManifest,
  ctx: ApplyContext
): Promise<DraftApplyResult> {
  if (proposal.newRouting) {
    const newId = await ctx.createSiblingRouting(proposal.newRouting.name);
    if (!newId) {
      return { appliedCount: 0, skipped: ["Failed to create sibling routing"], unansweredQuestions: [] };
    }
    ctx.selectRouting(newId);
  }
  const bindings = ctx.buildBindings();
  return applyDraftOperations(proposal.operations || [], manifest, bindings);
}
```

`ctx` shape:
```ts
interface ApplyContext {
  createSiblingRouting: (name: string) => Promise<string>;   // returns new orderRoutingId, or "" on failure
  selectRouting: (orderRoutingId: string) => void;
  buildBindings: () => DraftTargetBindings;
}
```

`applyDraftOperations(operations, manifest, bindings)` itself is unchanged. The manifest is the original one the proposal was generated against — it is used for enum/target lookups, not to identify which routing is open, so it remains valid after `selectRouting` swaps the active routing underneath.

### `apps/order-routing/src/components/circuit/CircuitCanvas.vue`

Two small adjustments in `prepareCircuitDraftProposal`:

- The "did we get something to apply" gate at line 694 changes from `proposal.operations.length` to `proposal.operations.length || proposal.newRouting`, so a create-only proposal (empty initial contents) still produces a `pendingProposal`.
- `formatDraftProposalMessage(pendingProposal, manifest)` is updated to pass `pendingProposal.newRouting` through to `formatDraftProposalSections` so the "Create new routing" section renders in the preview.

In `applyCircuitDraftProposal`, replace the existing `applyDraftOperations(proposal.operations || [], manifest, buildCircuitDraftBindings())` call at `CircuitCanvas.vue:744` with a call to `applyDraftProposal(...)`, passing the same manifest plus a context built inline:

```ts
await applyDraftProposal(proposal, manifest, {
  createSiblingRouting: async (name) => {
    const existing = group.value?.routings || [];
    const tail = existing[existing.length - 1];
    const sequenceNum = tail?.sequenceNum >= 0 ? tail.sequenceNum + 5 : 0;
    return routingStore.createOrderRouting({
      orderRoutingId: "",
      routingGroupId: routingGroupId.value!,
      statusId: "ROUTING_DRAFT",
      routingName: name,
      sequenceNum,
      description: "",
      createdDate: DateTime.now().toMillis()
    });
  },
  selectRouting: (id) => {
    group.value = routingStore.currentGroup;
    const created = group.value.routings?.find((r: any) => r.orderRoutingId === id);
    if (created) selectRouting(created);          // existing Canvas helper at line 1021
  },
  buildBindings: () => buildCircuitDraftBindings()  // existing helper at line 771
});
hasUnsavedChanges.value = true;
```

The sequence-number calculation matches `useCreateRouting.ts:38-40`. The `selectRouting(created)` call reuses the existing flow that sets `activeRouting`, `initialActiveRouting`, `routeName`, rule state, etc., so the user lands on the new routing exactly as if they had clicked "+ New Routing" manually.

## Edge cases

| Case | Behaviour |
|------|-----------|
| Model emits `action="create"` without `name` | Validator throws → 422 → Circuit shows the validator's message. No state change. |
| Model picks a colliding name | Validator throws with a specific message naming the conflict. User can rephrase. |
| Model emits empty `route.inventoryRules` and empty `route.orderSelection` filters | Valid. New routing lands empty (name + sequence + ROUTING_DRAFT). User can iterate. Equivalent to manual button outcome. |
| `routingStore.createOrderRouting` returns falsy (existing code shows a toast on internal error) | `applyDraftProposal` short-circuits before applying any ops. No orphan ops applied to the wrong routing. |
| User had unsaved changes on the open routing | New routing is appended; open routing's draft state is untouched. `hasUnsavedChanges` was already true; stays true. |
| Circuit not bound to a `routingGroupId` or no active routing is open | Existing guards at `CircuitCanvas.vue:684-689` and `:736-740` block the entire flow with "Select a routing context before asking Circuit to draft changes." Unchanged. To create a sibling routing the user must first open an existing routing in the group; the agent then creates a sibling of it. A completely empty group is out of scope for this design. |
| Existing flow that doesn't emit `targetRouting` at all | Treated as `action="edit"`. Fully back-compat. |
| Inquiry intent in same response | `targetRouting` is ignored on the inquiry branch; the inquiry agent never sets it. |

## Testing strategy

Add three `node:assert` test files matching the existing pattern under `apps/order-routing/tests/`:

1. **`brokeringRouteDraftValidator.createRouting.test.ts`** — exercises the new validator branch:
   - happy path (create + initial rules)
   - missing `name`
   - missing `new:` prefix on `routingKey`
   - name collision with active sibling
   - name collision with archived sibling (should NOT throw)
   - non-`new:` rule key inside a create draft
   - `canCreateSiblingRoutings: false` blocks creation

2. **`brokeringRouteDraftSchema.targetRouting.test.ts`** — `normalizeBrokeringRouteDraft()`:
   - default fills `{ action: "edit" }`
   - `action="edit"` with stray `name` → `name` stripped
   - malformed `targetRouting` falls back to edit
   - `action="create"` with no `routingKey` is left unchanged (validator handles the rejection)

3. **`draftAssistantService.applyDraftProposal.test.ts`** — mocks `ctx`:
   - with `newRouting` set: `createSiblingRouting` then `selectRouting` are called before `buildBindings`, exactly once each
   - without `newRouting`: the create/select path is skipped entirely
   - `createSiblingRouting` returns `""` → no ops applied, returns `{ appliedCount: 0 }`

Run each with `npx tsx tests/<name>.test.ts` per the project convention.

No new Jest/Cypress wiring; no UI snapshot tests (the Canvas integration is exercised manually).

## Manual verification checklist

Before declaring done, in `ionic serve`:

1. Open Circuit on a brokering run with at least one existing routing.
2. Ask the agent to "add a new routing for west-coast warehouse fulfillment that ships from CA/OR/WA warehouses". Confirm:
   - The proposal preview shows a "Create new routing" section AND the inventory-rule changes.
   - Apply lands on the new routing.
   - The new routing has the requested filters/rules.
   - `hasUnsavedChanges` is true; nothing has been sent to the backend.
3. Save the group and confirm the routing persists.
4. In a second session, ask the agent to "add a routing called <name of existing routing>". Confirm the validator's name-collision message reaches the chat.
5. In a third session, ask the agent to "change the proximity filter on the open routing" (no create). Confirm `targetRouting` is omitted and the existing edit flow still works (regression check).
6. On the `BrokeringRoute` page (group detail), confirm the agent-created routing is visible in the routing list before and after Save.

## Rollout / migration

- Additive schema change; no migration.
- No env/config changes.
- No backend changes.
- Feature works the moment the PWA build and Mastra rebuild ship together. The Mastra agent is the source of `targetRouting`; the PWA is the only consumer. They live in the same repo and ship together.

## Open questions

None at design time. If real usage reveals demand for multi-routing batch creation, that is the moment to revisit Approach B (group-scoped agent endpoint) — at which point the `targetRouting` discriminator here generalizes cleanly into a `routings[]` array.
