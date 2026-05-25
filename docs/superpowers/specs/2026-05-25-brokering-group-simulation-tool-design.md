# Brokering Group Simulation Tool — Design Spec

**Date:** 2026-05-25
**Author:** toaditi
**Status:** Approved — ready for implementation

---

## Context

The brokering assistant (`brokeringRunsListInquiryAgent`) already has three single-run simulation tools wired in:

- `runBrokeringSimulation` — sync submit + poll, single-rule what-if
- `submitBrokeringSimulation` — fire-and-forget submit for single-run
- `getBrokeringSimulationStatus` — status polling for submitted jobs

These cover `simulate#BrokeringWhatIf` (one rule, parameter overrides, optional sweep).

The backend has now exposed `simulate#BrokeringGroupRun` — a second simulation mode that runs the full routing group end-to-end through the real orchestrator. This design covers the Mastra tool and agent wiring for that mode.

---

## What group-run adds

| Capability | Single-run | Group-run |
|---|---|---|
| Scope | One rule, one FTL render | All active routings in a group, full fall-through chain |
| Structural changes | No | Yes — add/remove rules, reorder, change actions |
| Per-order traces | No | Yes — `finalReason` + `ruleAttempts[]` per order |
| Multi-config comparison | Sweep one parameter | Up to 5 variants, each changing any combination of parameters and structure |
| Distance aggregate | Yes | No |
| Facilities nearing limit | Yes | No (compute from `facilityAllocationDelta` if needed) |

---

## Files changed

### New

**`circuit/src/mastra/tools/runBrokeringGroupSimulation.ts`**

Exports `createRunBrokeringGroupSimulationTool(omsBaseUrl: string, authToken: string)`. Factory pattern matches the existing simulation tools.

### Modified

**`circuit/src/mastra/brokering/routes.ts`**

1. Import `createRunBrokeringGroupSimulationTool` alongside the existing simulation tool imports.
2. Add `runBrokeringGroupSimulation` to `toolsets.brokering` in the `/brokering-runs-list-inquiry` handler.
3. Append group-run agent instructions to `brokeringRunsListInquiryInstructions`.

---

## Tool design

### ID and description

```
id: "runBrokeringGroupSimulation"
description: "Simulate the full end-to-end brokering group run against a snapshot of today's
unrouted orders WITHOUT touching production data. Walks every active routing in the group in
sequence, applying each routing's order filters and running the full fall-through rule chain.
Returns a result tree (group → routings → order traces → rule attempts → final assignments).

Use when:
- The question needs orchestrator fidelity across multiple rules (e.g. 'what would today's
  run look like if...', 'how many items would end up in UNFILLABLE_PARKING?')
- The user wants per-order traces ('why didn't ORDER_X route?')
- The change is structural (add/remove a rule, reorder rules, change an action target)
- The user wants to compare 2–5 distinct configs against the same order snapshot

For single-rule parameter what-ifs, prefer runBrokeringSimulation — it is faster."
```

### Input schema

```typescript
z.object({
  routingGroupId: z.string().describe(
    "The routing group to simulate. Always read from pageCapabilityManifest — never ask the user."
  ),

  simulationConfig: z.object({
    // --- parameter overrides (FTL context) ---
    distance: z.number().int().nullish(),
    brokeringSafetyStock: z.number().int().nullish(),
    weekOfSupplyFilterEnabled: z.boolean().nullish(),
    weekOfSupplyThreshold: z.number().int().nullish(),
    facilityGroupId: z.string().nullish(),
    ignoreFacilityOrderLimit: z.boolean().nullish(),
    splitOrderItemGroup: z.boolean().nullish(),
    assignmentEnumId: z.enum(["ORA_SINGLE", "ORA_MULTI"]).nullish(),
    inventorySortByList: z.array(z.string()).nullish(),
    modelInventoryConsumption: z.boolean().nullish(),

    // --- data overrides (write to sim_* snapshot; reverted after run) ---
    minimumStockOverrides: z.record(z.string(), z.number().int()).nullish(),
    inventoryCountOverrides: z.record(z.string(), z.number().int()).nullish(),
    allowBrokeringOverrides: z.record(z.string(), z.boolean()).nullish(),
    maximumOrderLimitOverrides: z.record(z.string(), z.number().int()).nullish(),
    facilitiesToSimulateAtLimit: z.array(z.string()).nullish(),
    facilitiesToAddToGroup: z.array(z.string()).nullish().describe(
      "Requires facilityGroupId to also be set."
    ),
    facilitiesToRemoveFromGroup: z.array(z.string()).nullish().describe(
      "Requires facilityGroupId to also be set."
    ),
  }).nullish().describe(
    "Parameter and data overrides applied to the baseline and shared across all variants as the starting point."
  ),

  routingConfigDeltas: z.array(
    z.discriminatedUnion("op", [
      z.object({ op: z.literal("ADD_RULE"),               orderRoutingId: z.string(), ruleSeed: z.record(z.string(), z.any()) }),
      z.object({ op: z.literal("REMOVE_RULE"),            routingRuleId: z.string() }),
      z.object({ op: z.literal("SET_RULE_ACTION"),        routingRuleId: z.string(), actionTypeEnumId: z.string(), actionValue: z.string() }),
      z.object({ op: z.literal("SET_RULE_INV_COND"),      routingRuleId: z.string(), fieldName: z.string(), fieldValue: z.any() }),
      z.object({ op: z.literal("SET_ROUTING_FILTER"),     orderRoutingId: z.string(), fieldName: z.string(), fieldValue: z.any() }),
      z.object({ op: z.literal("SET_ROUTING_SEQUENCE_NUM"), orderRoutingId: z.string(), sequenceNum: z.number().int() }),
      z.object({ op: z.literal("SET_RULE_SEQUENCE_NUM"),  routingRuleId: z.string(), sequenceNum: z.number().int() }),
    ])
  ).nullish().describe(
    "Structural mutations applied to the routing-config snapshot before the run. Applied on top of simulationConfig. " +
    "Can also appear inside variants[].routingDeltas for per-variant structural changes."
  ),

  variants: z.array(
    z.object({
      label: z.string().describe("Short human label for this variant, e.g. 'Tighter distance + smaller buffer'."),
      parameterOverrides: z.object({
        // Same fields as simulationConfig — see simulationConfig definition above.
        // Partial — only include the fields this variant changes.
      }).passthrough().nullish().describe(
        "Per-variant parameter and data overrides. Same field names as simulationConfig. Merged on top of simulationConfig."
      ),
      routingDeltas: z.array(z.any()).nullish().describe(
        "Per-variant structural deltas. Same shape as routingConfigDeltas."
      ),
    })
  ).max(5).nullish().describe(
    "When present, runs baseline + one round per variant against the same order snapshot. " +
    "Returns GroupRunVariationResult envelope. Capped at 5 variants."
  ),

  sampleCap: z.number().int().nullish().describe(
    "Per-routing eligible-orders limit (default 500)."
  ),
})
```

### Execution model

**Endpoint (inferred from single-run pattern — confirm with backend team):**

```
POST /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs
GET  /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}
```

**Timing constants:**

```typescript
const INITIAL_DELAY_MS     = 2_000;
const POLL_INTERVAL_MS     = 5_000;
const MAX_POLL_DURATION_MS = 45 * 60_000;  // 45 min — group-run is significantly slower than single-run
```

**Flow:**

1. POST body (routingGroupId stripped from URL, rest of fields in body).
2. Extract `jobId` from submit response. Throw if missing.
3. Sleep `INITIAL_DELAY_MS`, then poll GET every `POLL_INTERVAL_MS`.
4. On `complete`: return `{ groupRun: payload.groupRun }` (single-shot) or `{ variation: payload.variation }` (variants path). Backend populates whichever key applies.
5. On `failed`: throw with `payload.error`.
6. On `not_found`: throw with expired-job message.
7. On deadline exceeded: throw with timeout message.

The body sent to the backend is the full input object minus `routingGroupId` (which moves to the URL). Null/undefined fields are stripped before sending.

---

## Agent instructions additions

Appended to `brokeringRunsListInquiryInstructions` as three blocks:

### Block 1 — when to use group-run vs single-run

```
SIMULATION MODE SELECTION:
- Use runBrokeringGroupSimulation when:
    - The question needs the full fall-through chain across multiple rules
      (e.g. 'what would today's run look like?', 'how many items go to UNFILLABLE_PARKING?')
    - The user wants per-order traces ('why didn't ORDER_X route?')
    - The proposed change is structural (add/remove/reorder a rule, change an action target)
    - The user wants to compare 2–5 distinct configs (use variants[])
- Use runBrokeringSimulation (single-run) when:
    - The question is a single-parameter what-if against one rule
    - The user asks to sweep a parameter across a range
    Prefer single-run: it is cheaper and faster. Escalate to group-run only when
    the question cannot be answered with single-rule fidelity.
```

### Block 2 — how to call the tool

```
CALLING runBrokeringGroupSimulation:
- routingGroupId: always read from pageCapabilityManifest.visibleEntities — never ask the user.
- simulationConfig: optional; carry over the same override fields as runBrokeringSimulation.
  simulationConfig applies to the baseline and is the shared starting point for all variants.
- routingConfigDeltas: each delta's op dictates which other fields are required:
    ADD_RULE           → orderRoutingId + ruleSeed (map of new-rule fields)
    REMOVE_RULE        → routingRuleId
    SET_RULE_ACTION    → routingRuleId + actionTypeEnumId + actionValue
    SET_RULE_INV_COND  → routingRuleId + fieldName + fieldValue
    SET_ROUTING_FILTER → orderRoutingId + fieldName + fieldValue
    SET_ROUTING_SEQUENCE_NUM → orderRoutingId + sequenceNum
    SET_RULE_SEQUENCE_NUM    → routingRuleId + sequenceNum
- variants[]: max 5. Give each a short descriptive label. Each variant can have its own
  parameterOverrides (merged on top of simulationConfig) and routingDeltas. When variants[]
  is present the tool returns the variation envelope, not the single-shot tree.
- Do NOT call this tool in parallel with itself for the same group — one call at a time.
  The tool blocks for the full simulation duration (up to 45 minutes).
```

### Block 3 — reading the result

```
READING runBrokeringGroupSimulation RESULTS:

Single-shot path (no variants) — result.groupRun:
  - Headline fill rate: brokeredItemCount / attemptedItemCount
  - queuedItemCount: items moved to a queue facility (ORA_MV_TO_QUEUE action) — NOT the same
    as unrouted. Do not count these as "routed to a fulfillment location."
  - Per-order diagnosis: find the orderId in routingResults[].orderTraces[]. Read finalReason
    ('FULLY_BROKERED', 'PARTIALLY_BROKERED', 'QUEUED', 'NO_INVENTORY', 'ERROR'), then walk
    ruleAttempts[] in order — first attempt with outcome 'ROUTED' or 'ROUTED_TO_QUEUE' ended
    the chain. For 'why didn't X route?', narrate each attempt's outcome in plain English.
  - simulationRan: false → simulator was unavailable; do not fabricate numbers.

Variants path (variants[] was passed) — result.variation:
  - variation.baseline: the live-config numbers (same shape as single-shot groupRun).
  - variation.variants[i].diff.finalReasonTransitions: orders whose outcome changed between
    baseline and this variant. Lead with these in the answer — they are the headline.
  - variation.variants[i].diff.routingBrokeredDelta: per-routing [baseline, variant] counts.
  - variation.variants[i].diff.facilityAllocationDelta: per-facility [baseline, variant] counts.
  - variation.partial: true → mid-loop rollback failed; some variants are missing. Tell the user.
  - variation.variants[i].failed: true → that specific variant errored; others are still valid.
  - Lead the answer with which variant won (highest brokeredItemCount) and why, then list
    each variant's headline numbers.

Always state the simulation mode used ('I ran a full-group simulation' vs 'I ran a
single-rule what-if') so the user understands the scope of the result.
```

---

## Assumptions and open questions

1. **Endpoint URL** — `POST /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs` is inferred from the single-run pattern. Confirm with the backend team before implementation.
2. **`routingConfigDeltas` inside `variants`** — the input schema uses `z.array(z.any())` for per-variant deltas to avoid duplicating the full discriminated union. Implementation should validate these on the backend; the tool passes them through as-is.
3. **Result envelope key** — the tool returns `{ groupRun }` or `{ variation }` based on whichever the backend populates. If the backend uses a different top-level key, only the return statement in the execute function needs updating.
4. **45-minute poll cap** — group-run simulations with large order pools and 5 variants can be slow. If jobs routinely exceed 45 minutes, increase `MAX_POLL_DURATION_MS` further.
