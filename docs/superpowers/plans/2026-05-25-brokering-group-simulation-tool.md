# Brokering Group Simulation Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `runBrokeringGroupSimulation` Mastra tool to the brokering assistant that runs the full routing-group end-to-end simulation (including structural config deltas and multi-variant comparison), and wire it into the `brokeringRunsListInquiryAgent` with agent instructions covering when to use it and how to read its results.

**Architecture:** One new tool file (`circuit/src/mastra/tools/runBrokeringGroupSimulation.ts`) follows the existing factory pattern — `createRunBrokeringGroupSimulationTool(omsBaseUrl, authToken)` submits a job then polls until complete (max 45 min). The tool is added to the `toolsets.brokering` map in `routes.ts` alongside the existing three simulation tools, and three instruction blocks are appended to `brokeringRunsListInquiryInstructions`.

**Tech Stack:** TypeScript, `@mastra/core/tools`, `zod/v4`, `node:assert` + `tsx` for tests.

---

## File map

| Status | Path | Responsibility |
|---|---|---|
| **Create** | `circuit/src/mastra/tools/runBrokeringGroupSimulation.ts` | Tool factory: schemas, submit + poll execute logic |
| **Create** | `circuit/src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts` | Schema validation + execute behaviour tests |
| **Modify** | `circuit/src/mastra/brokering/routes.ts` | Import tool, add to toolsets, append agent instructions |

---

## Task 1: Schemas and schema validation tests

**Files:**
- Create: `circuit/src/mastra/tools/runBrokeringGroupSimulation.ts`
- Create: `circuit/src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts`

- [ ] **Step 1.1 — Create the tool file with schemas only (no execute yet)**

Create `circuit/src/mastra/tools/runBrokeringGroupSimulation.ts`:

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

// ---- shared sub-schemas ----

export const simulationConfigSchema = z.object({
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
});

export const routingConfigDeltaSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("ADD_RULE"),
    orderRoutingId: z.string(),
    ruleSeed: z.record(z.string(), z.any()),
  }),
  z.object({
    op: z.literal("REMOVE_RULE"),
    routingRuleId: z.string(),
  }),
  z.object({
    op: z.literal("SET_RULE_ACTION"),
    routingRuleId: z.string(),
    actionTypeEnumId: z.string(),
    actionValue: z.string(),
  }),
  z.object({
    op: z.literal("SET_RULE_INV_COND"),
    routingRuleId: z.string(),
    fieldName: z.string(),
    fieldValue: z.any(),
  }),
  z.object({
    op: z.literal("SET_ROUTING_FILTER"),
    orderRoutingId: z.string(),
    fieldName: z.string(),
    fieldValue: z.any(),
  }),
  z.object({
    op: z.literal("SET_ROUTING_SEQUENCE_NUM"),
    orderRoutingId: z.string(),
    sequenceNum: z.number().int(),
  }),
  z.object({
    op: z.literal("SET_RULE_SEQUENCE_NUM"),
    routingRuleId: z.string(),
    sequenceNum: z.number().int(),
  }),
]);

export const groupSimulationInputSchema = z.object({
  routingGroupId: z.string().describe(
    "The routing group to simulate. Always read from pageCapabilityManifest.visibleEntities — never ask the user."
  ),
  simulationConfig: simulationConfigSchema.nullish().describe(
    "Parameter and data overrides applied to the baseline and shared as the starting point for all variants."
  ),
  routingConfigDeltas: z.array(routingConfigDeltaSchema).nullish().describe(
    "Structural mutations applied to the routing-config snapshot before the run."
  ),
  variants: z.array(
    z.object({
      label: z.string().describe("Short human label, e.g. 'Tighter distance + smaller buffer'."),
      parameterOverrides: simulationConfigSchema.nullish().describe(
        "Per-variant overrides merged on top of simulationConfig."
      ),
      routingDeltas: z.array(routingConfigDeltaSchema).nullish().describe(
        "Per-variant structural deltas."
      ),
    })
  ).max(5).nullish().describe(
    "When present, runs baseline + one round per variant. Returns GroupRunVariationResult envelope. Capped at 5."
  ),
  sampleCap: z.number().int().nullish().describe(
    "Per-routing eligible-orders limit (default 500)."
  ),
});

// Placeholder — execute implemented in Task 2
export function createRunBrokeringGroupSimulationTool(
  _omsBaseUrl: string,
  _authToken: string,
  _options?: { initialDelayMs?: number; pollIntervalMs?: number; maxPollDurationMs?: number }
) {
  return createTool({
    id: "runBrokeringGroupSimulation",
    description: "placeholder",
    inputSchema: groupSimulationInputSchema,
    execute: async () => { throw new Error("not implemented"); },
  });
}
```

- [ ] **Step 1.2 — Write schema validation tests**

Create `circuit/src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts`:

```typescript
import assert from "assert";
import {
  groupSimulationInputSchema,
  simulationConfigSchema,
  routingConfigDeltaSchema,
} from "../../tools/runBrokeringGroupSimulation";

// routingGroupId is required
{
  const result = groupSimulationInputSchema.safeParse({});
  assert.equal(result.success, false, "should reject missing routingGroupId");
}

// minimal valid input
{
  const result = groupSimulationInputSchema.safeParse({ routingGroupId: "GRP_NYC" });
  assert.equal(result.success, true, "should accept routingGroupId only");
  if (result.success) {
    assert.equal(result.data.routingGroupId, "GRP_NYC");
    assert.equal(result.data.simulationConfig, undefined);
    assert.equal(result.data.variants, undefined);
  }
}

// variants capped at 5
{
  const variants = Array.from({ length: 6 }, (_, i) => ({ label: `v${i}` }));
  const result = groupSimulationInputSchema.safeParse({ routingGroupId: "GRP_NYC", variants });
  assert.equal(result.success, false, "should reject more than 5 variants");
}

// exactly 5 variants is valid
{
  const variants = Array.from({ length: 5 }, (_, i) => ({ label: `v${i}` }));
  const result = groupSimulationInputSchema.safeParse({ routingGroupId: "GRP_NYC", variants });
  assert.equal(result.success, true, "should accept exactly 5 variants");
}

// routingConfigDelta — ADD_RULE requires orderRoutingId + ruleSeed
{
  const ok = routingConfigDeltaSchema.safeParse({
    op: "ADD_RULE",
    orderRoutingId: "OR_1",
    ruleSeed: { ruleName: "Late fallback", sequenceNum: 90, statusId: "RULE_ACTIVE" },
  });
  assert.equal(ok.success, true, "ADD_RULE should be valid");
}

// routingConfigDelta — REMOVE_RULE requires routingRuleId, not orderRoutingId
{
  const missing = routingConfigDeltaSchema.safeParse({
    op: "REMOVE_RULE",
    orderRoutingId: "bad-field",
  });
  assert.equal(missing.success, false, "REMOVE_RULE without routingRuleId should fail");

  const ok = routingConfigDeltaSchema.safeParse({ op: "REMOVE_RULE", routingRuleId: "RULE_1" });
  assert.equal(ok.success, true, "REMOVE_RULE with routingRuleId should pass");
}

// routingConfigDelta — SET_RULE_ACTION requires actionTypeEnumId + actionValue
{
  const ok = routingConfigDeltaSchema.safeParse({
    op: "SET_RULE_ACTION",
    routingRuleId: "RULE_X",
    actionTypeEnumId: "ORA_MV_TO_QUEUE",
    actionValue: "BACKORDER_QUEUE",
  });
  assert.equal(ok.success, true, "SET_RULE_ACTION should be valid");
}

// SET_ROUTING_SEQUENCE_NUM requires sequenceNum as integer
{
  const badFloat = routingConfigDeltaSchema.safeParse({
    op: "SET_ROUTING_SEQUENCE_NUM",
    orderRoutingId: "OR_1",
    sequenceNum: 10.5,
  });
  assert.equal(badFloat.success, false, "fractional sequenceNum should fail");

  const ok = routingConfigDeltaSchema.safeParse({
    op: "SET_ROUTING_SEQUENCE_NUM",
    orderRoutingId: "OR_1",
    sequenceNum: 10,
  });
  assert.equal(ok.success, true, "integer sequenceNum should pass");
}

// simulationConfig — assignmentEnumId only accepts ORA_SINGLE or ORA_MULTI
{
  const bad = simulationConfigSchema.safeParse({ assignmentEnumId: "ORA_WHATEVER" });
  assert.equal(bad.success, false, "unknown assignmentEnumId should fail");

  const ok = simulationConfigSchema.safeParse({ assignmentEnumId: "ORA_MULTI" });
  assert.equal(ok.success, true, "ORA_MULTI should be valid");
}

// full valid payload with simulationConfig + routingConfigDeltas + variants
{
  const result = groupSimulationInputSchema.safeParse({
    routingGroupId: "GRP_NYC",
    simulationConfig: { distance: 75, brokeringSafetyStock: 2 },
    routingConfigDeltas: [
      { op: "SET_RULE_SEQUENCE_NUM", routingRuleId: "RULE_X", sequenceNum: 1 },
    ],
    variants: [
      {
        label: "Add fallback rule",
        routingDeltas: [
          {
            op: "ADD_RULE",
            orderRoutingId: "OR_MAIN",
            ruleSeed: { ruleName: "Fallback", sequenceNum: 90, statusId: "RULE_ACTIVE" },
          },
        ],
      },
    ],
    sampleCap: 200,
  });
  assert.equal(result.success, true, "full valid payload should parse");
}

console.log("runBrokeringGroupSimulation schema tests passed");
```

- [ ] **Step 1.3 — Run schema tests and confirm they pass**

```bash
cd /Users/aditipatel/sandbox/circuit
npx tsx src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
```

Expected output:
```
runBrokeringGroupSimulation schema tests passed
```

- [ ] **Step 1.4 — Commit**

```bash
cd /Users/aditipatel/sandbox/circuit
git add src/mastra/tools/runBrokeringGroupSimulation.ts \
        src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
git commit -m "Added: runBrokeringGroupSimulation schemas and schema validation tests"
```

---

## Task 2: Execute — submit and immediate-complete path

**Files:**
- Modify: `circuit/src/mastra/tools/runBrokeringGroupSimulation.ts`
- Modify: `circuit/src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts`

- [ ] **Step 2.1 — Write failing test for the happy-path execute (immediate complete)**

Append to `circuit/src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts` **above** the final `console.log` line:

```typescript
// ---- execute behaviour tests ----
// Helpers
function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(responses: Response[]) {
  let i = 0;
  (globalThis as any).fetch = async (_url: string, _opts?: RequestInit) => {
    const r = responses[i++];
    if (!r) throw new Error(`fetch mock exhausted at call ${i}`);
    return r;
  };
}

function getCapturedFetchCalls(): { url: string; opts: RequestInit | undefined }[] {
  return (globalThis as any).__fetchCalls__ ?? [];
}

function installCapturingFetchMock(responses: Response[]) {
  const calls: { url: string; opts: RequestInit | undefined }[] = [];
  (globalThis as any).__fetchCalls__ = calls;
  let i = 0;
  (globalThis as any).fetch = async (url: string, opts?: RequestInit) => {
    calls.push({ url, opts });
    const r = responses[i++];
    if (!r) throw new Error(`fetch mock exhausted at call ${i}`);
    return r;
  };
}

// Test: submit succeeds and backend returns complete on first poll
{
  const groupRun = { brokeredItemCount: 80, attemptedItemCount: 100, queuedItemCount: 5 };
  installCapturingFetchMock([
    makeJsonResponse({ jobId: "job-001", status: "submitted" }),
    makeJsonResponse({ jobId: "job-001", status: "complete", groupRun }),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0 }
  );

  const result = await (tool as any).execute({ routingGroupId: "GRP_NYC" }, {});
  assert.deepStrictEqual(result, { groupRun }, "single-shot path should return { groupRun }");

  const calls = getCapturedFetchCalls();
  assert.equal(calls.length, 2, "should make exactly 2 fetch calls");
  assert.ok(
    calls[0].url.includes("/routingGroups/GRP_NYC/brokeringSimulation/jobs"),
    "submit URL should contain routingGroupId"
  );
  assert.equal(calls[0].opts?.method, "POST", "submit should be a POST");
  assert.ok(
    calls[1].url.includes("/routingGroups/GRP_NYC/brokeringSimulation/jobs/job-001"),
    "poll URL should contain jobId"
  );
  assert.equal(calls[1].opts?.method, "GET", "poll should be a GET");
}
```

- [ ] **Step 2.2 — Run test — confirm it fails**

```bash
cd /Users/aditipatel/sandbox/circuit
npx tsx src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
```

Expected: Error — "not implemented" or similar.

- [ ] **Step 2.3 — Implement execute in the tool file**

Replace the placeholder `createRunBrokeringGroupSimulationTool` function in `circuit/src/mastra/tools/runBrokeringGroupSimulation.ts` with:

```typescript
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function stripNullish(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = stripNullish(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createRunBrokeringGroupSimulationTool(
  omsBaseUrl: string,
  authToken: string,
  _options?: { initialDelayMs?: number; pollIntervalMs?: number; maxPollDurationMs?: number }
) {
  const INITIAL_DELAY_MS    = _options?.initialDelayMs    ?? 2_000;
  const POLL_INTERVAL_MS    = _options?.pollIntervalMs    ?? 5_000;
  const MAX_POLL_DURATION_MS = _options?.maxPollDurationMs ?? 45 * 60_000;

  return createTool({
    id: "runBrokeringGroupSimulation",
    description:
      "Simulate the full end-to-end brokering group run against a snapshot of today's unrouted " +
      "orders WITHOUT touching production data. Walks every active routing in the group in sequence, " +
      "applying each routing's order filters and running the full fall-through rule chain. Returns a " +
      "result tree (group → routings → order traces → rule attempts → final assignments). " +
      "When variants[] is provided, runs baseline + one round per variant and returns a " +
      "GroupRunVariationResult envelope instead. " +
      "Use when: the question needs orchestrator fidelity across multiple rules, the user wants per-order " +
      "traces ('why didn't ORDER_X route?'), the change is structural (add/remove/reorder a rule, change " +
      "an action target), or the user wants to compare 2–5 distinct configs. " +
      "For single-rule parameter what-ifs, prefer runBrokeringSimulation — it is faster. " +
      "Blocks for the full simulation duration (up to 45 minutes). Do NOT call in parallel with itself.",
    inputSchema: groupSimulationInputSchema,
    execute: async ({ routingGroupId, ...body }) => {
      const base = omsBaseUrl.replace(/\/$/, "").replace(/\/api$/, "/rest/s1");
      const jobsUrl = `${base}/order-routing/routingGroups/${encodeURIComponent(routingGroupId)}/brokeringSimulation/jobs`;
      const headers = {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      };
      const cleanBody = stripNullish(body as Record<string, unknown>);

      console.log(
        `[runBrokeringGroupSimulation] SUBMIT routingGroupId=${routingGroupId} variants=${(body.variants as any[])?.length ?? 0} deltas=${(body.routingConfigDeltas as any[])?.length ?? 0}`
      );

      const submitResp = await fetch(jobsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(cleanBody),
      });
      if (!submitResp.ok) {
        const text = await submitResp.text().catch(() => "");
        const msg = `brokeringGroupSimulation submit failed: HTTP ${submitResp.status} ${submitResp.url}${text ? ` — ${text.substring(0, 400)}` : ""}`;
        console.error("[runBrokeringGroupSimulation]", msg);
        throw new Error(msg);
      }
      const submitJson = (await submitResp.json()) as { jobId?: string; status?: string };
      const jobId = submitJson?.jobId;
      if (!jobId) throw new Error("brokeringGroupSimulation submit response missing jobId");
      console.log(`[runBrokeringGroupSimulation] SUBMITTED jobId=${jobId} status=${submitJson.status ?? "submitted"}`);

      await sleep(INITIAL_DELAY_MS);

      const pollUrl = `${jobsUrl}/${encodeURIComponent(jobId)}`;
      const pollHeaders = { Authorization: `Bearer ${authToken}` };
      const deadline = Date.now() + MAX_POLL_DURATION_MS;

      while (Date.now() < deadline) {
        const pollResp = await fetch(pollUrl, { method: "GET", headers: pollHeaders });
        if (!pollResp.ok) {
          const text = await pollResp.text().catch(() => "");
          const msg = `brokeringGroupSimulation poll failed: HTTP ${pollResp.status} ${pollResp.url}${text ? ` — ${text.substring(0, 400)}` : ""}`;
          console.error("[runBrokeringGroupSimulation]", msg);
          throw new Error(msg);
        }
        const payload = (await pollResp.json()) as {
          jobId?: string;
          status?: string;
          groupRun?: unknown;
          variation?: unknown;
          error?: string;
        };

        switch (payload.status) {
          case "complete": {
            console.log(`[runBrokeringGroupSimulation] COMPLETE jobId=${jobId}`);
            if (payload.variation !== undefined) return { variation: payload.variation };
            return { groupRun: payload.groupRun };
          }
          case "failed":
            throw new Error(`Group simulation failed: ${payload.error ?? "unknown"}`);
          case "not_found":
            throw new Error(`Group simulation jobId ${jobId} expired before completion`);
          case "submitted":
          case "running":
            await sleep(POLL_INTERVAL_MS);
            continue;
          default:
            throw new Error(`Unexpected simulation status: ${payload.status}`);
        }
      }
      throw new Error(
        `Group simulation jobId ${jobId} did not complete within ${MAX_POLL_DURATION_MS / 1000}s`
      );
    },
  });
}
```

- [ ] **Step 2.4 — Run tests and confirm they pass**

```bash
cd /Users/aditipatel/sandbox/circuit
npx tsx src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
```

Expected output:
```
runBrokeringGroupSimulation schema tests passed
```

- [ ] **Step 2.5 — Commit**

```bash
cd /Users/aditipatel/sandbox/circuit
git add src/mastra/tools/runBrokeringGroupSimulation.ts \
        src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
git commit -m "Added: runBrokeringGroupSimulation execute — submit and immediate-complete path"
```

---

## Task 3: Execute — poll loop, error paths, and variants path

**Files:**
- Modify: `circuit/src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts`

All implementation is already in place from Task 2. This task adds tests that exercise the remaining branches.

- [ ] **Step 3.1 — Write tests for poll loop, error paths, and variants path**

Append the following **above** the final `console.log` line in `circuit/src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts`:

```typescript
// Test: backend returns "running" twice before "complete"
{
  const groupRun = { brokeredItemCount: 42, attemptedItemCount: 50, queuedItemCount: 0 };
  installFetchMock([
    makeJsonResponse({ jobId: "job-002", status: "submitted" }),
    makeJsonResponse({ jobId: "job-002", status: "running" }),
    makeJsonResponse({ jobId: "job-002", status: "running" }),
    makeJsonResponse({ jobId: "job-002", status: "complete", groupRun }),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0 }
  );

  const result = await (tool as any).execute({ routingGroupId: "GRP_A" }, {});
  assert.deepStrictEqual(result, { groupRun }, "should return groupRun after polling");
}

// Test: backend returns "failed" — tool must throw
{
  installFetchMock([
    makeJsonResponse({ jobId: "job-003", status: "submitted" }),
    makeJsonResponse({ jobId: "job-003", status: "failed", error: "OOM in rule chain" }),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0 }
  );

  let threw = false;
  try {
    await (tool as any).execute({ routingGroupId: "GRP_B" }, {});
  } catch (e: any) {
    threw = true;
    assert.ok(e.message.includes("OOM in rule chain"), `error message should include backend error: ${e.message}`);
  }
  assert.equal(threw, true, "failed status must throw");
}

// Test: backend returns "not_found" — tool must throw with expiry message
{
  installFetchMock([
    makeJsonResponse({ jobId: "job-004", status: "submitted" }),
    makeJsonResponse({ jobId: "job-004", status: "not_found" }),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0 }
  );

  let threw = false;
  try {
    await (tool as any).execute({ routingGroupId: "GRP_C" }, {});
  } catch (e: any) {
    threw = true;
    assert.ok(e.message.includes("expired"), `error message should mention expiry: ${e.message}`);
  }
  assert.equal(threw, true, "not_found status must throw");
}

// Test: submit returns non-OK HTTP — tool must throw
{
  installFetchMock([
    makeJsonResponse({ error: "store not found" }, 404),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0 }
  );

  let threw = false;
  try {
    await (tool as any).execute({ routingGroupId: "GRP_D" }, {});
  } catch (e: any) {
    threw = true;
    assert.ok(e.message.includes("HTTP 404"), `error should include HTTP status: ${e.message}`);
  }
  assert.equal(threw, true, "non-OK submit must throw");
}

// Test: submit response missing jobId — tool must throw
{
  installFetchMock([
    makeJsonResponse({ status: "submitted" /* no jobId */ }),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0 }
  );

  let threw = false;
  try {
    await (tool as any).execute({ routingGroupId: "GRP_E" }, {});
  } catch (e: any) {
    threw = true;
    assert.ok(e.message.includes("missing jobId"), `error should mention missing jobId: ${e.message}`);
  }
  assert.equal(threw, true, "missing jobId must throw");
}

// Test: deadline exceeded — tool must throw with timeout message
{
  // maxPollDurationMs set to 0 so deadline expires before the first poll
  installFetchMock([
    makeJsonResponse({ jobId: "job-006", status: "submitted" }),
    // poll never resolves before deadline
    makeJsonResponse({ jobId: "job-006", status: "running" }),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0, maxPollDurationMs: 0 }
  );

  let threw = false;
  try {
    await (tool as any).execute({ routingGroupId: "GRP_F" }, {});
  } catch (e: any) {
    threw = true;
    assert.ok(
      e.message.includes("did not complete") || e.message.includes("0s"),
      `error should mention timeout: ${e.message}`
    );
  }
  assert.equal(threw, true, "deadline exceeded must throw");
}

// Test: variants path — backend returns variation key, tool returns { variation }
{
  const variation = {
    baseline: { groupRun: { brokeredItemCount: 80, attemptedItemCount: 100 } },
    variants: [{ label: "Tighter distance", diff: { routingBrokeredDelta: {} } }],
  };
  installFetchMock([
    makeJsonResponse({ jobId: "job-007", status: "submitted" }),
    makeJsonResponse({ jobId: "job-007", status: "complete", variation }),
  ]);

  const { createRunBrokeringGroupSimulationTool } = await import(
    "../../tools/runBrokeringGroupSimulation"
  );
  const tool = createRunBrokeringGroupSimulationTool(
    "https://oms.example.com/api",
    "tok-abc",
    { initialDelayMs: 0, pollIntervalMs: 0 }
  );

  const result = await (tool as any).execute(
    {
      routingGroupId: "GRP_NYC",
      variants: [{ label: "Tighter distance", parameterOverrides: { distance: 50 } }],
    },
    {}
  );
  assert.deepStrictEqual(result, { variation }, "variants path should return { variation }");
}
```

- [ ] **Step 3.2 — Run tests and confirm they all pass**

```bash
cd /Users/aditipatel/sandbox/circuit
npx tsx src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
```

Expected output:
```
runBrokeringGroupSimulation schema tests passed
```

No errors or assertion failures.

- [ ] **Step 3.3 — Commit**

```bash
cd /Users/aditipatel/sandbox/circuit
git add src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
git commit -m "Added: runBrokeringGroupSimulation execute tests — poll loop, errors, variants path"
```

---

## Task 4: Wire into routes.ts

**Files:**
- Modify: `circuit/src/mastra/brokering/routes.ts`

- [ ] **Step 4.1 — Add import**

In `circuit/src/mastra/brokering/routes.ts`, find the block of existing simulation tool imports:

```typescript
import { createRunBrokeringSimulationTool } from "../tools/runBrokeringSimulation";
import { createSubmitBrokeringSimulationTool } from "../tools/submitBrokeringSimulation";
import { createGetBrokeringSimulationStatusTool } from "../tools/getBrokeringSimulationStatus";
```

Add the new import immediately after:

```typescript
import { createRunBrokeringGroupSimulationTool } from "../tools/runBrokeringGroupSimulation";
```

- [ ] **Step 4.2 — Add to toolsets**

In the `/brokering-runs-list-inquiry` handler, find the `toolsets` object:

```typescript
const toolsets = (parsedBody.omsBaseUrl && parsedBody.authToken)
  ? {
      brokering: {
        getFacilityChangeSummary: createFacilityChangeSummaryTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getBrokeringFacilityGroups: createBrokeringFacilityGroupsTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getProductStoreBrokeringSettings: createProductStoreBrokeringSettingsTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getFacilityOrderLimits: createFacilityOrderLimitsTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        runBrokeringSimulation: createRunBrokeringSimulationTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        submitBrokeringSimulation: createSubmitBrokeringSimulationTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getBrokeringSimulationStatus: createGetBrokeringSimulationStatusTool(parsedBody.omsBaseUrl, parsedBody.authToken)
      }
    }
  : undefined;
```

Add `runBrokeringGroupSimulation` at the end of the `brokering` object:

```typescript
const toolsets = (parsedBody.omsBaseUrl && parsedBody.authToken)
  ? {
      brokering: {
        getFacilityChangeSummary: createFacilityChangeSummaryTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getBrokeringFacilityGroups: createBrokeringFacilityGroupsTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getProductStoreBrokeringSettings: createProductStoreBrokeringSettingsTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getFacilityOrderLimits: createFacilityOrderLimitsTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        runBrokeringSimulation: createRunBrokeringSimulationTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        submitBrokeringSimulation: createSubmitBrokeringSimulationTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        getBrokeringSimulationStatus: createGetBrokeringSimulationStatusTool(parsedBody.omsBaseUrl, parsedBody.authToken),
        runBrokeringGroupSimulation: createRunBrokeringGroupSimulationTool(parsedBody.omsBaseUrl, parsedBody.authToken)
      }
    }
  : undefined;
```

- [ ] **Step 4.3 — Update the tools-wired log line**

Find:
```typescript
console.log("[runs-list-inquiry] tools wired:", toolsets ? Object.keys(toolsets.brokering) : []);
```

No change needed — `Object.keys` will automatically include the new tool. Verify the line is still present.

- [ ] **Step 4.4 — Append agent instructions**

In `circuit/src/mastra/brokering/routes.ts`, find `brokeringRunsListInquiryInstructions`. It is a `const` array ending with `.join("\n")`. Add three new string entries immediately before the closing `]` of the array (before `.join("\n")`):

```typescript
  // --- group-run simulation: mode selection ---
  "SIMULATION MODE SELECTION — GROUP-RUN vs SINGLE-RUN:\n" +
  "Use runBrokeringGroupSimulation when:\n" +
  "  - The question needs the full fall-through chain across multiple rules\n" +
  "    (e.g. 'what would today's run look like if...', 'how many items go to UNFILLABLE_PARKING?')\n" +
  "  - The user wants per-order traces ('why didn't ORDER_X route?')\n" +
  "  - The proposed change is structural: add/remove/reorder a rule, change an action target.\n" +
  "    Structural changes require routingConfigDeltas — runBrokeringSimulation cannot express them.\n" +
  "  - The user wants to compare 2–5 distinct configurations side-by-side (use variants[]).\n" +
  "Use runBrokeringSimulation (single-run) when the question is a single-parameter what-if\n" +
  "against one rule, or a range sweep. Single-run is cheaper and faster.\n" +
  "When in doubt, single-run first; escalate to group-run only when single-rule fidelity is insufficient.",

  // --- group-run simulation: how to call ---
  "CALLING runBrokeringGroupSimulation:\n" +
  "- routingGroupId: always read from pageCapabilityManifest.visibleEntities — never ask the user.\n" +
  "- simulationConfig (optional): same override fields as runBrokeringSimulation (distance,\n" +
  "  brokeringSafetyStock, facilityGroupId, data-override maps, etc.). Applied to the baseline\n" +
  "  and shared as the starting point for all variants.\n" +
  "- routingConfigDeltas (optional array): each delta's op dictates which other fields are required:\n" +
  "    ADD_RULE            → orderRoutingId + ruleSeed (map of new-rule fields incl. ruleName, sequenceNum, statusId)\n" +
  "    REMOVE_RULE         → routingRuleId\n" +
  "    SET_RULE_ACTION     → routingRuleId + actionTypeEnumId + actionValue\n" +
  "    SET_RULE_INV_COND   → routingRuleId + fieldName + fieldValue\n" +
  "    SET_ROUTING_FILTER  → orderRoutingId + fieldName + fieldValue\n" +
  "    SET_ROUTING_SEQUENCE_NUM → orderRoutingId + sequenceNum (integer)\n" +
  "    SET_RULE_SEQUENCE_NUM    → routingRuleId + sequenceNum (integer)\n" +
  "- variants[] (optional, max 5): give each a short descriptive label. Each variant can specify\n" +
  "  parameterOverrides (merged on top of simulationConfig) and routingDeltas (same shape as\n" +
  "  routingConfigDeltas). When variants[] is present the tool returns the variation envelope.\n" +
  "- Do NOT call this tool in parallel with itself for the same group — one call at a time.\n" +
  "  The tool blocks for the full simulation duration (up to 45 minutes).",

  // --- group-run simulation: reading results ---
  "READING runBrokeringGroupSimulation RESULTS:\n" +
  "Single-shot path (no variants submitted) — result contains { groupRun }:\n" +
  "  - Headline fill rate: groupRun.brokeredItemCount / groupRun.attemptedItemCount.\n" +
  "  - groupRun.queuedItemCount: items the rule chain moved to a queue facility via ORA_MV_TO_QUEUE.\n" +
  "    Count separately from 'routed to a fulfillment location' — they are not the same.\n" +
  "  - Per-order diagnosis: find the orderId in groupRun.routingResults[].orderTraces[].\n" +
  "    Read finalReason ('FULLY_BROKERED', 'PARTIALLY_BROKERED', 'QUEUED', 'NO_INVENTORY', 'ERROR'),\n" +
  "    then walk ruleAttempts[] in order. The first attempt with outcome 'ROUTED' or 'ROUTED_TO_QUEUE'\n" +
  "    ended the chain. For 'why didn't X route?', narrate each attempt's outcome in plain English.\n" +
  "  - simulationRan: false on the envelope → simulator unavailable; do not fabricate numbers.\n" +
  "Variants path (variants[] was submitted) — result contains { variation }:\n" +
  "  - variation.baseline: the live-config numbers (same shape as single-shot groupRun).\n" +
  "  - variation.variants[i].diff.finalReasonTransitions: orders whose outcome changed between\n" +
  "    baseline and this variant. Lead with these — they are the headline of the comparison.\n" +
  "  - variation.variants[i].diff.routingBrokeredDelta: per-routing [baseline, variant] counts.\n" +
  "  - variation.variants[i].diff.facilityAllocationDelta: per-facility [baseline, variant] counts.\n" +
  "  - variation.partial: true → mid-loop rollback failed; some variants are missing. Tell the user.\n" +
  "  - variation.variants[i].failed: true → that variant errored; others remain valid.\n" +
  "  - Lead the answer with which variant won (highest brokeredItemCount) and why, then list\n" +
  "    each variant's headline numbers.\n" +
  "Always open the answer by stating the simulation mode used\n" +
  "('I ran a full-group simulation...' vs 'I ran a single-rule what-if...').",
```

- [ ] **Step 4.5 — Verify TypeScript compiles**

```bash
cd /Users/aditipatel/sandbox/circuit
npx tsc --noEmit
```

Expected: no errors. If any type errors appear in `routes.ts`, they will be in the instruction string concatenations — fix by ensuring each string entry in the array is a valid string literal.

- [ ] **Step 4.6 — Run all brokering tests to confirm nothing regressed**

```bash
cd /Users/aditipatel/sandbox/circuit
npx tsx src/mastra/test/brokering/runBrokeringGroupSimulation.test.ts
npx tsx src/mastra/test/brokering/brokeringRouteIntent.test.ts
npx tsx src/mastra/test/brokering/brokeringRunsListIntent.test.ts
npx tsx src/mastra/test/brokering/manifestUtils.test.ts
```

Expected: all pass with no errors.

- [ ] **Step 4.7 — Commit**

```bash
cd /Users/aditipatel/sandbox/circuit
git add src/mastra/brokering/routes.ts
git commit -m "Added: wire runBrokeringGroupSimulation into brokering-runs-list-inquiry agent and instructions"
```

---

## Self-review

**Spec coverage check:**
- ✅ New file `runBrokeringGroupSimulation.ts` — Tasks 1-3
- ✅ `simulationConfig` nested (not flat) — Task 1 Step 1.1
- ✅ `routingConfigDeltas` discriminated union, all 7 ops — Task 1 Step 1.1, tested in Step 1.2
- ✅ `variants[]` max 5, reuses `simulationConfigSchema` and `routingConfigDeltaSchema` — Task 1 Step 1.1
- ✅ Timing: `INITIAL_DELAY_MS=2000`, `POLL_INTERVAL_MS=5000`, `MAX_POLL_DURATION_MS=45*60_000` — Task 2 Step 2.3
- ✅ Timing injectable for tests via `_options` — Task 2 Step 2.3
- ✅ Result: `{ groupRun }` single-shot, `{ variation }` variants path — Task 2 Step 2.3, tested Task 3
- ✅ All error paths: non-OK submit, missing jobId, `failed`, `not_found`, deadline — Task 3 Step 3.1
- ✅ `routes.ts` import — Task 4 Step 4.1
- ✅ `toolsets.brokering` entry — Task 4 Step 4.2
- ✅ Three agent instruction blocks (mode selection, how to call, reading results) — Task 4 Step 4.4
- ✅ `stripNullish` handles nested `simulationConfig` — Task 2 Step 2.3

**Placeholder scan:** No TBDs, TODOs, or "similar to above" references. All code blocks are complete.

**Type consistency:**
- `groupSimulationInputSchema` defined in Task 1, imported in test file in Task 1, used in tool factory in Task 2 — consistent.
- `simulationConfigSchema` defined in Task 1, reused for `variants[].parameterOverrides` in same Task 1 — consistent.
- `routingConfigDeltaSchema` defined in Task 1, reused for `variants[].routingDeltas` in same Task 1 — consistent.
- `createRunBrokeringGroupSimulationTool` exported in Task 1 stub, full implementation in Task 2, imported in routes.ts Task 4 — consistent.
- `_options` parameter shape: `{ initialDelayMs?, pollIntervalMs?, maxPollDurationMs? }` — consistent across factory signature and test calls.
