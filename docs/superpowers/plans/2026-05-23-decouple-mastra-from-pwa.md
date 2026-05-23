# Decouple Mastra from Order-Routing PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the entire `apps/order-routing/mastra/` server into `sandbox/circuit/src/mastra/brokering/`, fold its agents and routes into the existing single Mastra instance, and delete all Mastra code from the PWA workspace.

**Architecture:** Three phases — (1) land everything in `circuit/` and prove it works with all tests + a live smoke test, (2) point the PWA at circuit's Mastra and verify in-browser, (3) grep-gate every deletion before executing it and verify again after. The PWA already talks to Mastra only over HTTP, so the only runtime change is `VITE_VUE_APP_MASTRA_URL`.

**Tech Stack:** TypeScript, Mastra (`@mastra/core`), Zod v4 (`zod/v4`), Node `tsx` for test execution, `pnpm` in `circuit/`, `npm` in the PWA.

---

## File Structure

### New files created in `circuit/`

| Path | Responsibility |
|---|---|
| `src/mastra/brokering/agents.ts` | 4 brokering `Agent` instances (model configs only, no instructions) |
| `src/mastra/brokering/routes.ts` | 3 `registerApiRoute` handlers + instruction strings + provider-unavailable helpers |
| `src/mastra/brokering/env.ts` | `readServerEnv()` — `process.env` only, no Vite fallback |
| `src/mastra/brokering/schemas/brokeringRouteDraftSchema.ts` | Zod schema + normalizer for brokering route draft |
| `src/mastra/brokering/schemas/pageCapabilitySchema.ts` | Zod types for page capability manifest |
| `src/mastra/brokering/schemas/brokeringRunsListInquirySchema.ts` | Zod schema for runs-list inquiry |
| `src/mastra/brokering/validators/brokeringRouteDraftValidator.ts` | Cross-field business-rule validator |
| `src/mastra/brokering/intent/brokeringRouteIntent.ts` | LLM-backed intent classifier (edit vs inquiry) |
| `src/mastra/brokering/intent/brokeringRouteIntentFallback.ts` | Dictionary fallback when LLM unavailable |
| `src/mastra/brokering/intent/brokeringRunsListIntent.ts` | Runs-list intent classifier |
| `src/mastra/brokering/generation/brokeringRouteDraftGeneration.ts` | Draft generation + structured output |
| `src/mastra/brokering/generation/brokeringRouteAssistantRouting.ts` | Assistant routing (inquiry vs draft) |
| `src/mastra/brokering/domain/orderRoutingDomainKnowledge.ts` | Loads and caches the domain knowledge yaml |
| `src/mastra/brokering/domain/knowledge/hotwax_order_routing_domain_knowledge.yaml` | Domain knowledge asset |
| `src/mastra/brokering/context/manifestUtils.ts` | Manifest pruning helpers |
| `src/mastra/brokering/context/runsListInquiryContext.ts` | Tool resolution for runs-list inquiry |
| `src/mastra/tools/getFacilityChangeSummary.ts` | Tool factory (no import changes) |
| `src/mastra/tools/getBrokeringFacilityGroups.ts` | Tool factory |
| `src/mastra/tools/getProductStoreBrokeringSettings.ts` | Tool factory |
| `src/mastra/tools/getFacilityOrderLimits.ts` | Tool factory |
| `src/mastra/tools/runBrokeringSimulation.ts` | Tool factory |
| `src/mastra/tools/submitBrokeringSimulation.ts` | Tool factory |
| `src/mastra/tools/getBrokeringSimulationStatus.ts` | Tool factory |
| `src/mastra/test/brokering/*.test.ts` (×12) | Relocated unit tests |
| `src/mastra/test/brokering/fixtures/brokeringRouteIntentCases.json` | Test fixture |

### Files modified in `circuit/`

| Path | Change |
|---|---|
| `src/mastra/index.ts` | Add brokering agents, `server` config block, `brokeringApiRoutes` |
| `package.json` | Bump `zod` from `^3.25.76` to `^4.4.3`; add circuit `.env` entries |

### Files deleted from `accxui/apps/order-routing/`

| Path | When |
|---|---|
| `mastra/` (entire dir) | Task 18 — after grep gate passes |
| `mastra:dev`, `mastra:build` from `package.json` scripts | Task 19 |
| `@mastra/core`, `mastra`, `zod` from `package.json` deps | Task 19 |
| Stale entries in `.env.example`, `CLAUDE.md`, README, tsconfig, vite.config | Task 20 |

---

## Phase 1: Land in circuit

### Task 1: Create branch + directory scaffold

**Files:**
- Create: directories in `circuit/src/mastra/`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/aditipatel/sandbox/circuit
git checkout -b feat/migrate-brokering-mastra
```

- [ ] **Step 2: Create all target directories**

```bash
mkdir -p src/mastra/brokering/schemas \
         src/mastra/brokering/validators \
         src/mastra/brokering/intent \
         src/mastra/brokering/generation \
         src/mastra/brokering/domain/knowledge \
         src/mastra/brokering/context \
         src/mastra/tools \
         src/mastra/test/brokering/fixtures
```

- [ ] **Step 3: Verify structure**

```bash
find src/mastra/brokering src/mastra/tools src/mastra/test/brokering -type d
```

Expected output:
```
src/mastra/brokering
src/mastra/brokering/schemas
src/mastra/brokering/validators
src/mastra/brokering/intent
src/mastra/brokering/generation
src/mastra/brokering/domain
src/mastra/brokering/domain/knowledge
src/mastra/brokering/context
src/mastra/tools
src/mastra/test/brokering
src/mastra/test/brokering/fixtures
```

- [ ] **Step 4: Commit**

```bash
git add src/mastra/brokering src/mastra/tools src/mastra/test/brokering
git commit -m "Added: brokering directory scaffold in circuit Mastra"
```

---

### Task 2: Copy schema files (3 files, no import changes)

**Source:** `accxui/apps/order-routing/mastra/`
**Destination:** `circuit/src/mastra/brokering/schemas/`

These three files import only `zod` — no internal path changes needed.

- [ ] **Step 1: Copy the three schema files**

```bash
MASTRA_SRC="/Users/aditipatel/sandbox/accxui/apps/order-routing/mastra"
BROKERING="src/mastra/brokering"

cp "$MASTRA_SRC/brokeringRouteDraftSchema.ts"    "$BROKERING/schemas/brokeringRouteDraftSchema.ts"
cp "$MASTRA_SRC/pageCapabilitySchema.ts"          "$BROKERING/schemas/pageCapabilitySchema.ts"
cp "$MASTRA_SRC/brokeringRunsListInquirySchema.ts" "$BROKERING/schemas/brokeringRunsListInquirySchema.ts"
```

- [ ] **Step 2: Verify zod import paths — they must say `zod/v4`, not `zod`**

```bash
grep "from.*zod" src/mastra/brokering/schemas/*.ts
```

Expected: all lines say `from "zod/v4"` (not `from "zod"`). If any say `from "zod"`, update them to `from "zod/v4"`.

- [ ] **Step 3: Bump zod in circuit `package.json` to v4**

Open `package.json` and change:
```diff
-    "zod": "^3.25.76",
+    "zod": "^4.4.3",
```

The brokering files use `from "zod/v4"`. Zod v3 does not reliably export that path. v4 guarantees it.

- [ ] **Step 4: Install**

```bash
pnpm install
```

Expected: `zod` resolves to `4.x`.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/brokering/schemas package.json pnpm-lock.yaml
git commit -m "Added: brokering schemas (brokeringRouteDraft, pageCapability, brokeringRunsList)"
```

---

### Task 3: Copy validator (1 file, update 2 imports)

**Source:** `accxui/apps/order-routing/mastra/brokeringRouteDraftValidator.ts`
**Destination:** `circuit/src/mastra/brokering/validators/brokeringRouteDraftValidator.ts`

- [ ] **Step 1: Copy**

```bash
cp "$MASTRA_SRC/brokeringRouteDraftValidator.ts" \
   src/mastra/brokering/validators/brokeringRouteDraftValidator.ts
```

- [ ] **Step 2: Fix the two internal imports**

Open `src/mastra/brokering/validators/brokeringRouteDraftValidator.ts`. Change:

```diff
-import {
-  brokeringRouteDraftSchema
-} from "./brokeringRouteDraftSchema";
-import type {
-  BrokeringRouteDraft
-} from "./brokeringRouteDraftSchema";
-import type {
-  DraftValue,
-  PageCapabilityManifest
-} from "./pageCapabilitySchema";
+import {
+  brokeringRouteDraftSchema
+} from "../schemas/brokeringRouteDraftSchema";
+import type {
+  BrokeringRouteDraft
+} from "../schemas/brokeringRouteDraftSchema";
+import type {
+  DraftValue,
+  PageCapabilityManifest
+} from "../schemas/pageCapabilitySchema";
```

- [ ] **Step 3: Verify no remaining `./` internal imports**

```bash
grep 'from "\.' src/mastra/brokering/validators/brokeringRouteDraftValidator.ts
```

Expected: no lines starting with `from "./"` to a sibling file (only `../schemas/...` paths).

- [ ] **Step 4: Commit**

```bash
git add src/mastra/brokering/validators/brokeringRouteDraftValidator.ts
git commit -m "Added: brokering draft validator with corrected import paths"
```

---

### Task 4: Copy intent classifiers (3 files, update imports)

**Source:** `accxui/apps/order-routing/mastra/{brokeringRouteIntent,brokeringRouteIntentFallback,brokeringRunsListIntent}.ts`
**Destination:** `circuit/src/mastra/brokering/intent/`

- [ ] **Step 1: Copy**

```bash
cp "$MASTRA_SRC/brokeringRouteIntent.ts"         src/mastra/brokering/intent/brokeringRouteIntent.ts
cp "$MASTRA_SRC/brokeringRouteIntentFallback.ts"  src/mastra/brokering/intent/brokeringRouteIntentFallback.ts
cp "$MASTRA_SRC/brokeringRunsListIntent.ts"       src/mastra/brokering/intent/brokeringRunsListIntent.ts
```

- [ ] **Step 2: Fix `brokeringRouteIntent.ts` — one import**

Change:
```diff
-import type { DraftConversationMessage } from "./pageCapabilitySchema";
+import type { DraftConversationMessage } from "../schemas/pageCapabilitySchema";
```

- [ ] **Step 3: Fix `brokeringRunsListIntent.ts` — two imports**

Change:
```diff
-import type { DiagnosticPattern } from "./orderRoutingDomainKnowledge";
-import type { DraftConversationMessage } from "./pageCapabilitySchema";
+import type { DiagnosticPattern } from "../domain/orderRoutingDomainKnowledge";
+import type { DraftConversationMessage } from "../schemas/pageCapabilitySchema";
```

- [ ] **Step 4: Check `brokeringRunsListInquirySchema.ts` import in `brokeringRunsListIntent.ts`**

```bash
grep "from '\|from \"" src/mastra/brokering/intent/brokeringRunsListIntent.ts
```

If any line still says `from "./brokeringRunsListInquirySchema"`, change it to `from "../schemas/brokeringRunsListInquirySchema"`.

- [ ] **Step 5: Verify `brokeringRouteIntentFallback.ts` has no internal imports to fix**

```bash
grep 'from "\.' src/mastra/brokering/intent/brokeringRouteIntentFallback.ts
```

Expected: no output (this file has no internal imports).

- [ ] **Step 6: Commit**

```bash
git add src/mastra/brokering/intent/
git commit -m "Added: brokering intent classifiers (route intent, fallback, runs-list intent)"
```

---

### Task 5: Copy generation files (2 files, update imports)

**Source:** `accxui/apps/order-routing/mastra/{brokeringRouteDraftGeneration,brokeringRouteAssistantRouting}.ts`
**Destination:** `circuit/src/mastra/brokering/generation/`

- [ ] **Step 1: Copy**

```bash
cp "$MASTRA_SRC/brokeringRouteDraftGeneration.ts"  src/mastra/brokering/generation/brokeringRouteDraftGeneration.ts
cp "$MASTRA_SRC/brokeringRouteAssistantRouting.ts"  src/mastra/brokering/generation/brokeringRouteAssistantRouting.ts
```

- [ ] **Step 2: Fix `brokeringRouteDraftGeneration.ts` — 4 imports**

Change:
```diff
-import {
-  brokeringRouteDraftSchema
-} from "./brokeringRouteDraftSchema";
-import type {
-  BrokeringRouteDraft
-} from "./brokeringRouteDraftSchema";
-import type {
-  DraftConversationMessage,
-  PageCapabilityManifest
-} from "./pageCapabilitySchema";
-import {
-  BrokeringRouteDraftValidationError,
-  validateBrokeringRouteDraftJson
-} from "./brokeringRouteDraftValidator";
-import {
-  pruneManifestForDraft
-} from "./manifestUtils";
+import {
+  brokeringRouteDraftSchema
+} from "../schemas/brokeringRouteDraftSchema";
+import type {
+  BrokeringRouteDraft
+} from "../schemas/brokeringRouteDraftSchema";
+import type {
+  DraftConversationMessage,
+  PageCapabilityManifest
+} from "../schemas/pageCapabilitySchema";
+import {
+  BrokeringRouteDraftValidationError,
+  validateBrokeringRouteDraftJson
+} from "../validators/brokeringRouteDraftValidator";
+import {
+  pruneManifestForDraft
+} from "../context/manifestUtils";
```

- [ ] **Step 3: Fix `brokeringRouteAssistantRouting.ts` — 3 imports**

Change:
```diff
-import type {
-  BrokeringRouteDraft
-} from "./brokeringRouteDraftSchema";
-import type {
-  DraftConversationMessage,
-  PageCapabilityManifest
-} from "./pageCapabilitySchema";
-import type { BrokeringRouteIntent, BrokeringRouteIntentPayload } from "./brokeringRouteIntent";
+import type {
+  BrokeringRouteDraft
+} from "../schemas/brokeringRouteDraftSchema";
+import type {
+  DraftConversationMessage,
+  PageCapabilityManifest
+} from "../schemas/pageCapabilitySchema";
+import type { BrokeringRouteIntent, BrokeringRouteIntentPayload } from "../intent/brokeringRouteIntent";
```

- [ ] **Step 4: Verify no remaining stale `./` internal imports**

```bash
grep 'from "\.' src/mastra/brokering/generation/brokeringRouteDraftGeneration.ts
grep 'from "\.' src/mastra/brokering/generation/brokeringRouteAssistantRouting.ts
```

Expected: no output from either grep.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/brokering/generation/
git commit -m "Added: brokering draft generation and assistant routing"
```

---

### Task 6: Copy domain knowledge + yaml asset

**Source:** `accxui/apps/order-routing/mastra/orderRoutingDomainKnowledge.ts` and `mastra/public/knowledge/*.yaml`
**Destination:** `circuit/src/mastra/brokering/domain/`

- [ ] **Step 1: Copy the TypeScript file and the yaml asset**

```bash
cp "$MASTRA_SRC/orderRoutingDomainKnowledge.ts" \
   src/mastra/brokering/domain/orderRoutingDomainKnowledge.ts

cp "$MASTRA_SRC/public/knowledge/hotwax_order_routing_domain_knowledge.yaml" \
   src/mastra/brokering/domain/knowledge/hotwax_order_routing_domain_knowledge.yaml
```

- [ ] **Step 2: Fix the `env` import and rename `readEnv` → `readServerEnv`**

Open `src/mastra/brokering/domain/orderRoutingDomainKnowledge.ts`. Change:

```diff
-import { readEnv } from "./env";
+import { readServerEnv } from "../env";
```

Then find the one call site:
```diff
-  const overrideDir = readEnv("VITE_ORDER_ROUTING_KNOWLEDGE_DIR");
+  const overrideDir = readServerEnv("ORDER_ROUTING_KNOWLEDGE_DIR");
```

- [ ] **Step 3: Verify yaml path resolution works at new depth**

The `resolveKnowledgePath` function uses `import.meta.url` to find the module directory, then tries candidates in order. After the move, `import.meta.url` resolves to `circuit/src/mastra/brokering/domain/orderRoutingDomainKnowledge.ts`. Candidate `join(mastraDir, "knowledge", fileName)` becomes `circuit/src/mastra/brokering/domain/knowledge/...` — that is exactly where we copied the yaml. The function will find it at that candidate.

Verify the candidate line exists and points to `"knowledge"` (not `"public/knowledge"`):
```bash
grep '"knowledge"' src/mastra/brokering/domain/orderRoutingDomainKnowledge.ts
```

Expected output includes a line like:
```
    join(mastraDir, "knowledge", fileName),
```

- [ ] **Step 4: Commit**

```bash
git add src/mastra/brokering/domain/
git commit -m "Added: brokering domain knowledge module and yaml asset"
```

---

### Task 7: Copy context utilities (2 files, update imports)

**Source:** `accxui/apps/order-routing/mastra/{manifestUtils,runsListInquiryContext}.ts`
**Destination:** `circuit/src/mastra/brokering/context/`

- [ ] **Step 1: Copy**

```bash
cp "$MASTRA_SRC/manifestUtils.ts"        src/mastra/brokering/context/manifestUtils.ts
cp "$MASTRA_SRC/runsListInquiryContext.ts" src/mastra/brokering/context/runsListInquiryContext.ts
```

- [ ] **Step 2: Fix `manifestUtils.ts` — one import**

Change:
```diff
-import type { PageCapabilityManifest } from "./pageCapabilitySchema";
+import type { PageCapabilityManifest } from "../schemas/pageCapabilitySchema";
```

- [ ] **Step 3: Fix `runsListInquiryContext.ts` — 4 tool imports go up two levels**

Change:
```diff
-import { createFacilityChangeSummaryTool } from "./tools/getFacilityChangeSummary";
-import { createBrokeringFacilityGroupsTool } from "./tools/getBrokeringFacilityGroups";
-import { createProductStoreBrokeringSettingsTool } from "./tools/getProductStoreBrokeringSettings";
-import { createFacilityOrderLimitsTool } from "./tools/getFacilityOrderLimits";
+import { createFacilityChangeSummaryTool } from "../../tools/getFacilityChangeSummary";
+import { createBrokeringFacilityGroupsTool } from "../../tools/getBrokeringFacilityGroups";
+import { createProductStoreBrokeringSettingsTool } from "../../tools/getProductStoreBrokeringSettings";
+import { createFacilityOrderLimitsTool } from "../../tools/getFacilityOrderLimits";
```

- [ ] **Step 4: Verify no remaining stale imports**

```bash
grep 'from "\.' src/mastra/brokering/context/manifestUtils.ts
grep 'from "\.' src/mastra/brokering/context/runsListInquiryContext.ts
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/brokering/context/
git commit -m "Added: brokering manifest utils and runs-list inquiry context"
```

---

### Task 8: Create `brokering/env.ts` (strip Vite fallback, rename export)

**Source:** `accxui/apps/order-routing/mastra/env.ts` — adapted, not copied verbatim.

The original `env.ts` had a dual `process.env` + `import.meta.env` shim because the embedded Mastra ran under both Node and Vite. On the circuit side only Node applies.

- [ ] **Step 1: Create `src/mastra/brokering/env.ts`**

```typescript
// Reads from process.env only — circuit runs in plain Node, not Vite.
export function readServerEnv(key: string): string | undefined {
  return process.env[key];
}
```

- [ ] **Step 2: Verify the only consumer of `readServerEnv` in brokering/ is `orderRoutingDomainKnowledge.ts` so far**

```bash
grep -r "readEnv\|readServerEnv" src/mastra/brokering/
```

Expected: only `orderRoutingDomainKnowledge.ts` imports it right now (agents and routes come in later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/mastra/brokering/env.ts
git commit -m "Added: readServerEnv helper (process.env only, no Vite shim)"
```

---

### Task 9: Copy 7 brokering tools (no import changes)

**Source:** `accxui/apps/order-routing/mastra/tools/*.ts`
**Destination:** `circuit/src/mastra/tools/`

All 7 tool files import only `@mastra/core/tools` and `zod/v4` — no internal imports to update.

- [ ] **Step 1: Copy all 7 tool files**

```bash
cp "$MASTRA_SRC/tools/getFacilityChangeSummary.ts"           src/mastra/tools/getFacilityChangeSummary.ts
cp "$MASTRA_SRC/tools/getBrokeringFacilityGroups.ts"          src/mastra/tools/getBrokeringFacilityGroups.ts
cp "$MASTRA_SRC/tools/getProductStoreBrokeringSettings.ts"    src/mastra/tools/getProductStoreBrokeringSettings.ts
cp "$MASTRA_SRC/tools/getFacilityOrderLimits.ts"              src/mastra/tools/getFacilityOrderLimits.ts
cp "$MASTRA_SRC/tools/runBrokeringSimulation.ts"              src/mastra/tools/runBrokeringSimulation.ts
cp "$MASTRA_SRC/tools/submitBrokeringSimulation.ts"           src/mastra/tools/submitBrokeringSimulation.ts
cp "$MASTRA_SRC/tools/getBrokeringSimulationStatus.ts"        src/mastra/tools/getBrokeringSimulationStatus.ts
```

- [ ] **Step 2: Verify no internal imports**

```bash
grep 'from "\.' src/mastra/tools/*.ts
```

Expected: no output (tools only use `@mastra/core/tools` and `zod/v4`).

- [ ] **Step 3: Commit**

```bash
git add src/mastra/tools/
git commit -m "Added: 7 brokering tool factories"
```

---

### Task 10: Create `brokering/agents.ts`

Extracts the 4 Agent declarations from the original `index.ts` (~lines 185–210). Agents are model configs only — instructions are never stored on the instance.

- [ ] **Step 1: Create `src/mastra/brokering/agents.ts`**

```typescript
import { Agent } from "@mastra/core/agent";
import { readServerEnv } from "./env";

export const brokeringRouteDraftAgent = new Agent({
  id: "brokering-route-draft-agent",
  name: "Brokering Route Draft Agent",
  model: readServerEnv("MASTRA_MODEL") || "openai/gpt-4.1-mini"
});

export const brokeringRouteInquiryAgent = new Agent({
  id: "brokering-route-inquiry-agent",
  name: "Brokering Route Inquiry Agent",
  model: readServerEnv("MASTRA_MODEL") || "openai/gpt-4.1-mini"
});

export const brokeringRunsListInquiryAgent = new Agent({
  id: "brokering-runs-list-inquiry-agent",
  name: "Brokering Runs List Inquiry Agent",
  model: readServerEnv("MASTRA_MODEL") || "openai/gpt-4.1-mini"
});

export const brokeringRouteIntentAgent = new Agent({
  id: "brokering-route-intent-agent",
  name: "Brokering Route Intent Agent",
  model: readServerEnv("MASTRA_INTENT_MODEL") || "openai/gpt-4.1-nano"
});

export const brokeringAgents = {
  brokeringRouteDraftAgent,
  brokeringRouteInquiryAgent,
  brokeringRunsListInquiryAgent,
  brokeringRouteIntentAgent,
};
```

Note: `VITE_MASTRA_MODEL` → `MASTRA_MODEL` and `VITE_MASTRA_INTENT_MODEL` → `MASTRA_INTENT_MODEL`.

- [ ] **Step 2: Commit**

```bash
git add src/mastra/brokering/agents.ts
git commit -m "Added: brokering agent declarations (4 model configs)"
```

---

### Task 11: Create `brokering/routes.ts`

Extracts the 3 `registerApiRoute` blocks (~lines 226–582), instruction string constants (~lines 51–184), and helper functions (~lines 590–682) from the original `index.ts`. This is the largest file in the migration.

- [ ] **Step 1: Create `src/mastra/brokering/routes.ts`**

Start with all the imports (converted from the original `index.ts` import block with paths updated):

```typescript
import { registerApiRoute } from "@mastra/core/server";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import type { DraftConversationMessage } from "./schemas/pageCapabilitySchema";
import {
  brokeringRouteDraftRequestSchema,
  normalizeBrokeringRouteDraft
} from "./schemas/brokeringRouteDraftSchema";
import { requireOrderRoutingDomainKnowledge, getDiagnosticPatterns } from "./domain/orderRoutingDomainKnowledge";
import { classifyRunsListIntent } from "./intent/brokeringRunsListIntent";
import { resolveRequiredTools, prefetchToolContext } from "./context/runsListInquiryContext";
import { BrokeringRouteDraftValidationError } from "./validators/brokeringRouteDraftValidator";
import { generateValidatedBrokeringRouteDraft } from "./generation/brokeringRouteDraftGeneration";
import {
  brokeringRouteInquirySchema,
  generateBrokeringRouteAssistantResponse
} from "./generation/brokeringRouteAssistantRouting";
import { classifyBrokeringRouteIntent } from "./intent/brokeringRouteIntent";
import { dictionaryIntentFallback } from "./intent/brokeringRouteIntentFallback";
import { pruneManifestForInquiry } from "./context/manifestUtils";
import {
  brokeringRunsListInquirySchema,
  brokeringRunsListInquiryRequestSchema,
  type BrokeringRunsListInquiry,
  type BrokeringRunsListInquiryResponse
} from "./schemas/brokeringRunsListInquirySchema";
import { createFacilityChangeSummaryTool } from "../tools/getFacilityChangeSummary";
import { createBrokeringFacilityGroupsTool } from "../tools/getBrokeringFacilityGroups";
import { createProductStoreBrokeringSettingsTool } from "../tools/getProductStoreBrokeringSettings";
import { createFacilityOrderLimitsTool } from "../tools/getFacilityOrderLimits";
import { createRunBrokeringSimulationTool } from "../tools/runBrokeringSimulation";
import { createSubmitBrokeringSimulationTool } from "../tools/submitBrokeringSimulation";
import { createGetBrokeringSimulationStatusTool } from "../tools/getBrokeringSimulationStatus";
import { readServerEnv } from "./env";
```

- [ ] **Step 2: Copy the instruction string constants from the original**

Open `accxui/apps/order-routing/mastra/index.ts` and copy lines 51–183 (the four `const brokeringRoute*Instructions = [...].join("\n")` blocks) verbatim into `routes.ts` after the imports. No changes needed — these are plain string arrays.

- [ ] **Step 3: Copy the three `registerApiRoute` handler blocks**

From `accxui/apps/order-routing/mastra/index.ts`, copy lines 226–581 (the three `registerApiRoute(...)` call expressions including their closing `}),` delimiters) into `routes.ts`. Wrap them in an exported array:

```typescript
export const brokeringApiRoutes = [
  registerApiRoute("/brokering-route-assistant", { /* ... verbatim from index.ts lines 226–319 ... */ }),
  registerApiRoute("/brokering-runs-list-inquiry", { /* ... verbatim from index.ts lines 321–490 ... */ }),
  registerApiRoute("/brokering-route-draft", { /* ... verbatim from index.ts lines 492–581 ... */ }),
];
```

- [ ] **Step 4: Replace every `readEnv(...)` call in the pasted handler bodies**

Inside the three handlers there are six `readEnv(...)` calls, all checking the OpenAI key. Change each:

```diff
-if (!readEnv("OPENAI_API_KEY") && !readEnv("VITE_OPENAI_API_KEY")) {
+if (!readServerEnv("OPENAI_API_KEY")) {
```

This collapses the two-key check to one — on the circuit side there's no `VITE_` prefix.

- [ ] **Step 5: Copy the four helper functions from the original**

From `accxui/apps/order-routing/mastra/index.ts`, copy lines 583–682 verbatim into `routes.ts` after the exported array:
- `buildProviderUnavailableBrokeringRouteDraft` (line 590)
- `buildProviderUnavailableAssistantResponse` (line 601)
- `handleRunsListInquiryError` (line 615)
- `buildProviderUnavailableRunsListInquiryResponse` (line 637)
- `isMissingApiKeyError` (line 657)
- `writeInquiryDebugDump` (line 661)

No changes needed to these functions — they use only types and utilities already imported above.

- [ ] **Step 6: Verify no remaining `readEnv` calls**

```bash
grep "readEnv" src/mastra/brokering/routes.ts
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/mastra/brokering/routes.ts
git commit -m "Added: brokering API routes (route-assistant, runs-list-inquiry, route-draft)"
```

---

### Task 12: Merge brokering into `circuit/src/mastra/index.ts`

- [ ] **Step 1: Open `circuit/src/mastra/index.ts` and add the brokering imports at the top**

Add after the existing imports:

```typescript
import { brokeringAgents } from './brokering/agents';
import { brokeringApiRoutes } from './brokering/routes';
```

- [ ] **Step 2: Spread brokering agents into the `config.agents` block**

Change:
```diff
 const config = {
   agents: {
-    orderRoutingAgent
+    orderRoutingAgent,
+    ...brokeringAgents,
   },
```

- [ ] **Step 3: Add `server` config to the Mastra config**

Add after the `workflows` line, still inside `config`:

```typescript
  server: {
    port: Number(process.env.MASTRA_PORT || 4111),
    cors: {
      origin: process.env.MASTRA_ALLOWED_ORIGIN || '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    },
    apiRoutes: brokeringApiRoutes,
  },
```

- [ ] **Step 4: Verify the final `index.ts` looks like this**

```typescript
import { Mastra } from '@mastra/core/mastra';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { orderRoutingAgent } from './agents/orderRoutingAgent';
import { PostgresStore } from '@mastra/pg';
import { PinoLogger } from '@mastra/loggers';
import { routingWorkspace } from './workspaces';
import { orderRoutingJsonCreateWorkflow } from './workflows/orderRoutingJsonCreateWorkflow';
import { workflow as orderRoutingJsonCreateWorkflowV2 } from './workflows/orderRoutingJsonCreateWorkflowV2';
import { brokeringAgents } from './brokering/agents';
import { brokeringApiRoutes } from './brokering/routes';

const storage = new PostgresStore({
  id: 'hc-agent-store',
  connectionString: process.env.DATABASE_URL || '',
  schemaName: process.env.DATABASE_SCHEMA || ''
});

const config = {
  agents: {
    orderRoutingAgent,
    ...brokeringAgents,
  },
  workspace: routingWorkspace,
  logger: new PinoLogger({ name: 'HC-Agents', level: 'debug' }),
  storage,
  bundler: {
    sourcemap: true,
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(),
          new CloudExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
  workflows: { orderRoutingJsonCreateWorkflow, orderRoutingJsonCreateWorkflowV2 },
  server: {
    port: Number(process.env.MASTRA_PORT || 4111),
    cors: {
      origin: process.env.MASTRA_ALLOWED_ORIGIN || '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    },
    apiRoutes: brokeringApiRoutes,
  },
};

export const mastra = new Mastra({
  ...config,
});

export const workspace = routingWorkspace;
```

- [ ] **Step 5: Add circuit `.env.example` entries**

Add to `circuit/.env.example` (create the file if it doesn't exist):

```
# Brokering route server config
MASTRA_PORT=4111
MASTRA_ALLOWED_ORIGIN=*
MASTRA_MODEL=openai/gpt-4.1-mini
MASTRA_INTENT_MODEL=openai/gpt-4.1-nano
OPENAI_API_KEY=
# Optional: override knowledge yaml location
ORDER_ROUTING_KNOWLEDGE_DIR=
```

- [ ] **Step 6: Commit**

```bash
git add src/mastra/index.ts .env.example
git commit -m "Added: brokering agents and routes merged into circuit Mastra instance"
```

---

### Task 13: Migrate 12 tests + fixture to circuit

**Source:** `accxui/apps/order-routing/tests/`
**Destination:** `circuit/src/mastra/test/brokering/`

- [ ] **Step 1: Copy all 12 test files and the fixture**

```bash
PWA_TESTS="/Users/aditipatel/sandbox/accxui/apps/order-routing/tests"
CIRCUIT_TESTS="src/mastra/test/brokering"

cp "$PWA_TESTS/brokeringRouteDraftValidator.test.ts"    "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/brokeringRouteDraftSchema.test.ts"       "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/brokeringRouteDraftGeneration.test.ts"   "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/brokeringRouteAssistantRouting.test.ts"  "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/brokeringRouteIntent.test.ts"            "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/brokeringRouteIntentFallback.test.ts"    "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/brokeringRouteIntentSoak.test.ts"        "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/brokeringRunsListIntent.test.ts"         "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/runsListInquiryContext.test.ts"          "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/orderRoutingDomainKnowledge.test.ts"     "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/diagnosticPatterns.test.ts"              "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/manifestUtils.test.ts"                   "$CIRCUIT_TESTS/"
cp "$PWA_TESTS/fixtures/brokeringRouteIntentCases.json" "$CIRCUIT_TESTS/fixtures/"
```

- [ ] **Step 2: Bulk-rewrite all `../mastra/<name>` imports to their new paths**

Every test file currently imports from `"../mastra/<module>"`. In the new location (`src/mastra/test/brokering/`), the same modules are at `"../../<subdir>/<module>"`. Run these replacements:

```bash
cd src/mastra/test/brokering

# schemas
sed -i '' 's|from "\.\./mastra/brokeringRouteDraftSchema"|from "../../schemas/brokeringRouteDraftSchema"|g' *.test.ts
sed -i '' 's|from "\.\./mastra/pageCapabilitySchema"|from "../../schemas/pageCapabilitySchema"|g' *.test.ts
sed -i '' 's|from "\.\./mastra/brokeringRunsListInquirySchema"|from "../../schemas/brokeringRunsListInquirySchema"|g' *.test.ts

# validators
sed -i '' 's|from "\.\./mastra/brokeringRouteDraftValidator"|from "../../validators/brokeringRouteDraftValidator"|g' *.test.ts

# intent
sed -i '' 's|from "\.\./mastra/brokeringRouteIntent"|from "../../intent/brokeringRouteIntent"|g' *.test.ts
sed -i '' 's|from "\.\./mastra/brokeringRouteIntentFallback"|from "../../intent/brokeringRouteIntentFallback"|g' *.test.ts
sed -i '' 's|from "\.\./mastra/brokeringRunsListIntent"|from "../../intent/brokeringRunsListIntent"|g' *.test.ts

# generation
sed -i '' 's|from "\.\./mastra/brokeringRouteDraftGeneration"|from "../../generation/brokeringRouteDraftGeneration"|g' *.test.ts
sed -i '' 's|from "\.\./mastra/brokeringRouteAssistantRouting"|from "../../generation/brokeringRouteAssistantRouting"|g' *.test.ts

# domain
sed -i '' 's|from "\.\./mastra/orderRoutingDomainKnowledge"|from "../../domain/orderRoutingDomainKnowledge"|g' *.test.ts

# context
sed -i '' 's|from "\.\./mastra/manifestUtils"|from "../../context/manifestUtils"|g' *.test.ts
sed -i '' 's|from "\.\./mastra/runsListInquiryContext"|from "../../context/runsListInquiryContext"|g' *.test.ts

cd ../../../../
```

- [ ] **Step 3: Fix `brokeringRouteIntentSoak.test.ts` — remove stale `VITE_OPENAI_API_KEY` fallback**

This test skips itself when no API key is present. It currently checks two variables; on the circuit side only `OPENAI_API_KEY` exists.

Open `src/mastra/test/brokering/brokeringRouteIntentSoak.test.ts` and change:

```diff
-const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
+const apiKey = process.env.OPENAI_API_KEY;
```

- [ ] **Step 4: Verify no stale `../mastra/` imports remain**

```bash
grep -r 'from.*\.\./mastra/' src/mastra/test/brokering/
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/test/brokering/
git commit -m "Added: 12 brokering unit tests + fixture relocated from PWA"
```

---

### Task 14: Phase 1 verification gate — must fully pass before touching the PWA

All four checks must produce clean output. **Do not proceed to Phase 2 if any check fails.**

- [ ] **Step 1: Type-check — zero errors**

```bash
cd /Users/aditipatel/sandbox/circuit
pnpm exec tsc --noEmit
```

Expected: exits 0 with no output. If errors appear, fix import paths, type mismatches, or the zod version before continuing.

- [ ] **Step 2: Run all 12 relocated tests**

```bash
for f in src/mastra/test/brokering/*.test.ts; do
  echo "--- $f ---"
  npx tsx "$f"
done
```

Expected: each file prints its own "… tests passed" line and exits 0. Any failing test must be fixed before proceeding.

- [ ] **Step 3: Start the Mastra dev server**

```bash
pnpm mastra:dev &
sleep 5
```

Expected: server logs show `Listening on port 4111` (or similar). If it fails to start, check `.env` has `OPENAI_API_KEY` or expects the `providerUnavailable` fallback path.

- [ ] **Step 4: Smoke curl — three routes**

Route 1 — brokering-route-draft (expects `providerUnavailable` shape if no API key):
```bash
curl -s -X POST http://localhost:4111/brokering-route-draft \
  -H "Content-Type: application/json" \
  -d '{"prompt":"add proximity sort","conversationHistory":[],"pageCapabilityManifest":{"pageId":"test","route":"/tabs/circuit","visibleEntities":{},"editableTargets":[],"outputContract":{}}}' \
  | jq .
```

Expected: JSON response (HTTP 200) — either a valid draft object or a `{ questions: [...], summary: "..." }` provider-unavailable shape. `500` or `ECONNREFUSED` means the server is not running correctly.

Route 2 — brokering-route-assistant:
```bash
curl -s -X POST http://localhost:4111/brokering-route-assistant \
  -H "Content-Type: application/json" \
  -d '{"prompt":"what filters are active?","conversationHistory":[],"pageCapabilityManifest":{"pageId":"test","route":"/tabs/circuit","visibleEntities":{},"editableTargets":[],"outputContract":{}}}' \
  | jq .
```

Expected: JSON with `schemaVersion: "brokering-route-assistant.v1"` key (or provider-unavailable equivalent).

Route 3 — brokering-runs-list-inquiry:
```bash
curl -s -X POST http://localhost:4111/brokering-runs-list-inquiry \
  -H "Content-Type: application/json" \
  -d '{"prompt":"why did this run fail?","conversationHistory":[],"productStoreId":"STORE","authToken":"token","omsBaseUrl":"http://oms"}' \
  | jq .
```

Expected: JSON with `schemaVersion: "brokering-runs-list-inquiry.v1"` key.

- [ ] **Step 5: Stop the dev server**

```bash
kill %1
```

- [ ] **Step 6: Commit Phase 1 complete marker**

```bash
git add .
git commit -m "Added: Phase 1 complete — brokering Mastra fully migrated to circuit"
```

---

## Phase 2: Cut PWA over

### Task 15: Update PWA env + manual browser smoke

- [ ] **Step 1: Create the circuit branch for PWA changes**

```bash
cd /Users/aditipatel/sandbox/accxui
git checkout -b feat/decouple-mastra-from-pwa
```

- [ ] **Step 2: Confirm `VITE_VUE_APP_MASTRA_URL` in the PWA's `.env`**

```bash
grep MASTRA_URL apps/order-routing/.env 2>/dev/null || echo "Not set — will use default"
```

If the file doesn't exist yet, copy from `.env.example`:
```bash
cp apps/order-routing/.env.example apps/order-routing/.env
```

The value `VITE_VUE_APP_MASTRA_URL="http://localhost:4111"` is already correct — no change needed.

- [ ] **Step 3: Start both servers**

In terminal 1 (circuit):
```bash
cd /Users/aditipatel/sandbox/circuit && pnpm mastra:dev
```

In terminal 2 (PWA):
```bash
cd /Users/aditipatel/sandbox/accxui/apps/order-routing && npm run dev
```

- [ ] **Step 4: In-browser smoke — three Circuit flows**

Open the PWA in Chrome. Use Chrome DevTools console to monitor for errors throughout.

**Flow 1 — brokering route draft:** Navigate to a brokering route (Tabs → a route). Open Circuit panel. Type: *"Add a proximity sort to the first inventory rule."* Expected: draft applies to Vue state (UI updates to show the proximity sort), no console errors, no red Circuit banner.

**Flow 2 — inquiry:** Still on the route, type: *"What filters are currently active on the order selection?"* Expected: Circuit replies with a text answer about current filters, does NOT apply a draft to the UI.

**Flow 3 — runs-list inquiry:** Navigate to Brokering Runs list. Open Circuit panel. Type: *"Why might runs be failing here?"* Expected: Circuit replies with a text answer, no console error.

- [ ] **Step 5: Stop both servers after smoke passes**

---

### Task 16: Run surviving PWA tests

The three tests that stay in `accxui/apps/order-routing/tests/` don't import from `../mastra/` — they test PWA services directly.

- [ ] **Step 1: Run each test**

```bash
cd /Users/aditipatel/sandbox/accxui/apps/order-routing

npx tsx tests/brokeringRulesDraftTargets.test.ts
npx tsx tests/circuitDraftFeedbackService.test.ts
npx tsx tests/draftAssistantService.test.ts
```

Expected: each prints "… tests passed" and exits 0.

- [ ] **Step 2: If `draftAssistantService.test.ts` requires the Mastra server running, start circuit first**

```bash
# In another terminal:
cd /Users/aditipatel/sandbox/circuit && pnpm mastra:dev
```

Then re-run. If this test is HTTP-level, it will need the server up.

- [ ] **Step 3: Commit Phase 2 marker**

```bash
cd /Users/aditipatel/sandbox/accxui
git add .
git commit -m "Added: Phase 2 complete — PWA verified against circuit Mastra"
```

---

## Phase 3: Delete and clean PWA

### Task 17: Grep gate — verify zero remaining accxui references to embedded mastra

Every grep below must return **zero matches**. Do not proceed to Task 18 until all are clean.

- [ ] **Step 1: Check for direct imports from `../mastra/`**

```bash
cd /Users/aditipatel/sandbox/accxui/apps/order-routing
rg 'from ["\x27].*[./]mastra/' src/ tests/
```

Expected: no output. (Only `DraftAssistantService.ts` and `BrokeringRunsAssistantService.ts` will mention `mastra` but as a URL string, not an import path.)

- [ ] **Step 2: Check for Mastra npm package imports**

```bash
rg '@mastra/|from "mastra"' src/ tests/
```

Expected: no output.

- [ ] **Step 3: Check for mastra:dev / mastra:build script references in PWA source**

```bash
rg 'mastra:dev|mastra:build' .
```

Expected: only hits in `package.json` (which we'll delete next) and possibly CLAUDE.md/README (cleaned in Task 20). No hits in `src/` or `tests/`.

If any of the above greps return hits in `src/` or `tests/`, trace the import and fix it (likely a test that wasn't on the known list) before continuing.

---

### Task 18: Delete `apps/order-routing/mastra/` directory

- [ ] **Step 1: Verify the directory size — sanity check before delete**

```bash
find /Users/aditipatel/sandbox/accxui/apps/order-routing/mastra -type f | wc -l
```

Expected: ~22 files (14 `.ts` root files + 7 tools + 1 yaml + subdirs). If the count is much higher, something unexpected is present — inspect before deleting.

- [ ] **Step 2: Delete**

```bash
rm -rf /Users/aditipatel/sandbox/accxui/apps/order-routing/mastra
```

- [ ] **Step 3: Verify it's gone**

```bash
ls /Users/aditipatel/sandbox/accxui/apps/order-routing/mastra 2>&1
```

Expected: `ls: ... No such file or directory`.

- [ ] **Step 4: Commit**

```bash
cd /Users/aditipatel/sandbox/accxui
git add -A apps/order-routing/mastra
git commit -m "Removed: embedded mastra/ directory from order-routing PWA"
```

---

### Task 19: Update PWA `package.json` — remove scripts and deps

- [ ] **Step 1: Check if `zod` is used anywhere in `src/` (not in the deleted `mastra/`)**

```bash
rg 'from "zod' apps/order-routing/src/
```

Expected: no output. If any hits appear, `zod` must stay in `package.json`.

- [ ] **Step 2: Remove the two mastra scripts and three dependencies**

Open `apps/order-routing/package.json`. Remove:

```diff
 "scripts": {
   ...
-  "mastra:dev": "mastra dev --dir mastra",
-  "mastra:build": "mastra build --dir mastra"
 },
 "dependencies": {
   ...
-  "@mastra/core": "^1.32.1",
-  "mastra": "^1.8.1",
-  "zod": "^4.4.3"   ← only if the Step 1 grep found no hits
 }
```

- [ ] **Step 3: Run install to confirm resolution**

```bash
cd /Users/aditipatel/sandbox/accxui
pnpm install
```

Expected: lockfile updates, no errors.

- [ ] **Step 4: Confirm `@mastra` is gone from node_modules**

```bash
ls apps/order-routing/node_modules/@mastra 2>&1
```

Expected: `No such file or directory`.

- [ ] **Step 5: Commit**

```bash
git add apps/order-routing/package.json pnpm-lock.yaml
git commit -m "Removed: @mastra/core, mastra, zod deps and mastra:* scripts from order-routing PWA"
```

---

### Task 20: Update `.env.example`, `CLAUDE.md`, `README`, `vite.config`, `tsconfig`

- [ ] **Step 1: Update `.env.example`**

Open `apps/order-routing/.env.example`. Remove these five lines and replace with a single updated comment:

```diff
-VITE_VUE_APP_MASTRA_URL="http://localhost:4111"
-VITE_MASTRA_MODEL="openai/gpt-4.1-mini"
-VITE_MASTRA_PORT=4111
-VITE_MASTRA_ALLOWED_ORIGIN="*"
-VITE_OPENAI_API_KEY=""
+# Mastra server URL — the server lives in sandbox/circuit, not here.
+# Start it from sandbox/circuit with: pnpm mastra:dev
+VITE_VUE_APP_MASTRA_URL="http://localhost:4111"
```

- [ ] **Step 2: Update `CLAUDE.md` — four targeted sections**

Open `apps/order-routing/CLAUDE.md`.

**Change 1 — "Common commands" section:** Remove the two `mastra:*` lines. Add one pointer line:

```diff
-- `npm run mastra:dev` — start the local Mastra HTTP server on `MASTRA_PORT` (default 4111) using files in `mastra/`
-- `npm run mastra:build` — produce a Mastra bundle
+- The Mastra server for Circuit lives in `sandbox/circuit/` — run it from there with `pnpm mastra:dev`
```

**Change 2 — "Required env" section:** Delete the paragraph about `MASTRA_MODEL` / `OPENAI_API_KEY`. Update the `VUE_APP_MASTRA_URL` description (also fix the typo — it says `VUE_APP_MASTRA_URL` but the actual env var is `VITE_VUE_APP_MASTRA_URL`):

```diff
-- `VUE_APP_MASTRA_URL` — base URL the PWA uses for `/brokering-route-assistant` and `/brokering-route-draft` calls.
-- `MASTRA_MODEL` / `OPENAI_API_KEY` — read by the Mastra server in `mastra/index.ts`. Without `OPENAI_API_KEY` the routes return a "provider unavailable" payload rather than failing.
+- `VITE_VUE_APP_MASTRA_URL` — base URL the PWA uses for `/brokering-route-assistant`, `/brokering-route-draft`, and `/brokering-runs-list-inquiry` calls. The server is `sandbox/circuit/`; its own env vars (`OPENAI_API_KEY`, `MASTRA_MODEL`, etc.) are configured there.
```

**Change 3 — "Tests" section:** Remove the `tests/*.test.ts` paragraph about mastra-coupled tests:

```diff
-- `tests/*.test.ts` — standalone TypeScript scripts that import from `mastra/` and `src/services/` and use `node:assert`. They are not wired to a test runner in `package.json`. Run an individual one with `npx tsx tests/<name>.test.ts` (or `ts-node`). Each file ends with a `console.log("... tests passed")` line and throws on assertion failure.
-
-When adding new tests for `mastra/` logic, follow the existing `node:assert` + `tsx`-runnable pattern rather than introducing Jest.
+- `tests/*.test.ts` — standalone TypeScript scripts for PWA services and draft-target binding. Run with `npx tsx tests/<name>.test.ts`. Three files: `brokeringRulesDraftTargets.test.ts`, `circuitDraftFeedbackService.test.ts`, `draftAssistantService.test.ts`.
```

**Change 4 — "Circuit / brokering-draft pipeline" section:** Replace steps 4-7 to point at circuit:

```diff
-4. `mastra/index.ts` registers two routes:
-   - `/brokering-route-assistant` — …
-   - `/brokering-route-draft` — …
-5. Both agents are pure model configs — instructions live as constants in `mastra/index.ts` …
-6. `mastra/orderRoutingDomainKnowledge.ts` loads `mastra/public/knowledge/…yaml` …
-7. The validated draft comes back to the PWA …
-
-When changing agent behaviour, the relevant pieces are usually all three of: instructions in `mastra/index.ts`, schema in `mastra/brokeringRouteDraftSchema.ts`, and validator in `mastra/brokeringRouteDraftValidator.ts`. …
+4. The Mastra server (running in `sandbox/circuit/`) receives the request. Source lives in
+   `circuit/src/mastra/brokering/`. Routes are defined in `routes.ts`, agents in `agents.ts`,
+   schemas in `schemas/`, validator in `validators/`, domain knowledge in `domain/`.
+5-7. (unchanged — validated draft returns to the PWA; only a user Save calls the Order Routing API.)
+
+When changing agent behaviour, the relevant pieces live in `sandbox/circuit/src/mastra/brokering/`:
+instructions in `routes.ts`, schema in `schemas/brokeringRouteDraftSchema.ts`, validator in
+`validators/brokeringRouteDraftValidator.ts`.
```

- [ ] **Step 3: Check `vite.config.ts` and `tsconfig.json` for mastra references**

```bash
grep -n "mastra" apps/order-routing/vite.config.ts apps/order-routing/tsconfig.json 2>/dev/null
```

If any hits: remove those lines. If no hits: continue.

- [ ] **Step 4: Check `README.md` and `docs/` for mastra references that need updating**

```bash
grep -rn "mastra/" apps/order-routing/README.md apps/order-routing/docs/ 2>/dev/null | head -20
```

For each hit, update the reference to point at `sandbox/circuit/src/mastra/brokering/` or remove the stale path.

- [ ] **Step 5: Check workspace root for stale mastra references**

```bash
grep -rn "mastra" /Users/aditipatel/sandbox/accxui/package.json \
  /Users/aditipatel/sandbox/accxui/pnpm-workspace.yaml 2>/dev/null
```

Expected: no output (root config shouldn't reference the app-level mastra dir). If any hits: remove them.

- [ ] **Step 6: Commit all doc and config cleanup**

```bash
cd /Users/aditipatel/sandbox/accxui
git add apps/order-routing/.env.example \
        apps/order-routing/CLAUDE.md \
        apps/order-routing/README.md \
        apps/order-routing/vite.config.ts \
        apps/order-routing/tsconfig.json
git commit -m "Updated: remove mastra references from PWA env, CLAUDE.md, README, and config"
```

---

### Task 21: Final PWA verification + open PRs

- [ ] **Step 1: Final `pnpm tsc --noEmit` on circuit**

```bash
cd /Users/aditipatel/sandbox/circuit
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Final lint on PWA**

```bash
cd /Users/aditipatel/sandbox/accxui/apps/order-routing
npm run lint
```

Expected: zero lint errors. If `no-unused-vars` or similar fires on something only used by the removed mastra code, fix the file.

- [ ] **Step 3: Run surviving PWA tests one last time**

```bash
npx tsx tests/brokeringRulesDraftTargets.test.ts
npx tsx tests/circuitDraftFeedbackService.test.ts
npx tsx tests/draftAssistantService.test.ts
```

Expected: all pass.

- [ ] **Step 4: Re-run all circuit brokering tests**

```bash
cd /Users/aditipatel/sandbox/circuit
for f in src/mastra/test/brokering/*.test.ts; do npx tsx "$f"; done
```

Expected: all pass.

- [ ] **Step 5: Final acceptance grep — zero hits required**

```bash
cd /Users/aditipatel/sandbox/accxui/apps/order-routing
rg 'from ["\x27].*[./]mastra/' src/ tests/
rg '@mastra/|from "mastra"' src/ tests/
```

Expected: zero output from both greps.

- [ ] **Step 6: Open circuit PR**

```bash
cd /Users/aditipatel/sandbox/circuit
gh pr create \
  --title "Migrate brokering-route Mastra into circuit" \
  --body "$(cat <<'EOF'
## Summary
- Adds `src/mastra/brokering/` with all brokering agents, schemas, validators, intent classifiers, generation, domain knowledge, and context utilities relocated from `accxui/apps/order-routing/mastra/`
- Adds 7 brokering tool factories to `src/mastra/tools/`
- Merges 4 brokering agents and 3 API routes into the single Mastra instance in `src/mastra/index.ts`
- Bumps `zod` to `^4.4.3` for `zod/v4` compatibility
- Relocates 12 unit tests + fixture to `src/mastra/test/brokering/`

Companion PR: [link to accxui PR]

## Test plan
- [ ] `pnpm exec tsc --noEmit` passes with zero errors
- [ ] All 12 brokering tests pass via `npx tsx`
- [ ] `pnpm mastra:dev` boots on port 4111
- [ ] Three curl smokes (route-draft, route-assistant, runs-list-inquiry) each return valid JSON
EOF
)"
```

- [ ] **Step 7: Open accxui PR**

```bash
cd /Users/aditipatel/sandbox/accxui
gh pr create \
  --title "Decouple order-routing PWA from Mastra" \
  --body "$(cat <<'EOF'
## Summary
- Removes `apps/order-routing/mastra/` directory entirely
- Removes `@mastra/core`, `mastra`, and `zod` from PWA `package.json`
- Removes `mastra:dev` and `mastra:build` scripts
- Cleans `.env.example` to keep only `VITE_VUE_APP_MASTRA_URL`
- Updates `CLAUDE.md`, `README.md` to point at `sandbox/circuit` for the Mastra server
- 12 formerly-embedded tests moved to circuit (companion PR above); 3 PWA-side tests remain

Companion PR: [link to circuit PR]

## Test plan
- [ ] `npm run lint` passes with zero errors
- [ ] Three surviving PWA tests pass via `npx tsx`
- [ ] In-browser smoke: draft, inquiry, and runs-list-inquiry all work against circuit Mastra
EOF
)"
```

- [ ] **Step 8: Cross-link the two PRs in their descriptions**

Edit both PR bodies to replace `[link to ... PR]` with the actual PR URL from the opposite repo.

---

## Acceptance Criteria Checklist

- [ ] `rg 'from.*mastra/' accxui/apps/order-routing/src accxui/apps/order-routing/tests` — zero hits
- [ ] `accxui/apps/order-routing/package.json` contains no `@mastra/*`, `mastra`, or `mastra:*` entries
- [ ] `accxui/apps/order-routing/mastra/` does not exist
- [ ] `circuit/src/mastra/brokering/` contains: `agents.ts`, `routes.ts`, `env.ts`, `schemas/` (3 files), `validators/` (1 file), `intent/` (3 files), `generation/` (2 files), `domain/` (1 ts + yaml), `context/` (2 files)
- [ ] `circuit/src/mastra/tools/` contains 7 tool factory files
- [ ] `circuit/src/mastra/test/brokering/` contains 12 test files and `fixtures/brokeringRouteIntentCases.json`; every test exits 0 when run with `npx tsx`
- [ ] Circuit Mastra (`pnpm mastra:dev`) serves all three routes; PWA `npm run dev` successfully completes a draft, an inquiry, and a runs-list inquiry
