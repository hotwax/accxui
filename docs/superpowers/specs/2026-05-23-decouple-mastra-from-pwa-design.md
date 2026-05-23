# Decouple Mastra from the order-routing PWA

**Status:** Approved design — implementation plan to follow.
**Date:** 2026-05-23
**Scope:** Move the embedded `apps/order-routing/mastra/` server out of the `accxui` PWA workspace and into the existing `sandbox/circuit/` Mastra project. Leave the PWA with only its HTTP client.

## Motivation

The order-routing PWA currently ships with an embedded Mastra server inside `apps/order-routing/mastra/` (~2,800 LOC, 3 HTTP routes, 7 tools, agents, schemas, validators, intent classifiers, domain knowledge). It is run via PWA-owned scripts (`mastra:dev`, `mastra:build`) and pulls `@mastra/core` + `mastra` into the PWA's dependency graph.

The PWA itself only talks to Mastra over HTTP — the only references from `src/` are two `fetch(VITE_VUE_APP_MASTRA_URL + path)` calls in `DraftAssistantService.ts` and `BrokeringRunsAssistantService.ts`. The embedded layout is a packaging accident, not a runtime coupling.

A separate `sandbox/circuit/` Mastra project already exists with its own agent (`orderRoutingAgent`), workflows, storage, and observability. Folding the brokering-route code into that single Mastra instance gives us one server to operate, one set of agent deps to maintain, and a clean PWA whose responsibilities end at HTTP.

## Goals

- The PWA workspace contains zero Mastra server code, zero `@mastra/*` dependencies, and zero `mastra:*` scripts.
- All brokering-route agents, tools, schemas, validators, intent classifiers, domain knowledge, and tests live in `sandbox/circuit/`.
- A single Mastra runtime in `circuit/` serves both the existing `orderRoutingAgent`/workflows and the brokering-route routes.
- HTTP contracts between the PWA and Mastra are byte-identical before and after migration. The only PWA change is the value of `VITE_VUE_APP_MASTRA_URL`.

## Non-goals

- Refactoring agent instructions, schemas, or validator behavior. Migration is relocation, not redesign.
- Extracting a shared `@order-routing/brokering-contracts` workspace package. Tests that depended on direct imports move with the code instead.
- Changing the PWA's HTTP client surface (`DraftAssistantService.ts`, `BrokeringRunsAssistantService.ts`) beyond the URL it points at.
- Migrating the WebGPU/`@mlc-ai/web-llm` Circuit path in `CircuitLLMService.ts`. That stays in the PWA.

## Architecture

```
sandbox/
├── accxui/apps/order-routing/        ← PWA only; no mastra/ dir, no Mastra deps
│   └── src/services/
│       ├── DraftAssistantService.ts        (HTTP client; behavior unchanged)
│       └── BrokeringRunsAssistantService.ts (HTTP client; behavior unchanged)
└── circuit/                          ← single Mastra runtime
    └── src/mastra/
        ├── index.ts                  ← merged: existing orderRoutingAgent + workflows
        │                               + brokering agents + brokering apiRoutes
        ├── agents/orderRoutingAgent.ts      (existing)
        ├── tools/                           (existing orderRoutingTools.ts +
        │                                     7 relocated brokering tools, flat)
        └── brokering/
            ├── agents.ts             ← exports the 4 brokering Agent instances
            ├── routes.ts             ← exports brokeringApiRoutes: ApiRoute[]
            ├── env.ts                ← readServerEnv() (process.env only)
            ├── schemas/
            │   ├── brokeringRouteDraftSchema.ts
            │   ├── pageCapabilitySchema.ts
            │   └── brokeringRunsListInquirySchema.ts
            ├── validators/
            │   └── brokeringRouteDraftValidator.ts
            ├── intent/
            │   ├── brokeringRouteIntent.ts
            │   ├── brokeringRouteIntentFallback.ts
            │   └── brokeringRunsListIntent.ts
            ├── generation/
            │   ├── brokeringRouteDraftGeneration.ts
            │   └── brokeringRouteAssistantRouting.ts
            ├── domain/
            │   ├── orderRoutingDomainKnowledge.ts
            │   └── knowledge/                     (yaml asset)
            └── context/
                ├── manifestUtils.ts
                └── runsListInquiryContext.ts
        └── test/brokering/
            ├── *.test.ts             (12 relocated test files)
            └── fixtures/             (relocated fixtures dir)
```

### Single-Mastra integration

`circuit/src/mastra/index.ts` adds brokering agents and routes alongside the existing `orderRoutingAgent`/workflows. Storage, logger, observability blocks are untouched.

The brokering tools are wired into their owning agents inside `brokering/agents.ts` (each agent's `tools` block), matching the current per-agent pattern in the original `index.ts`. They are not registered at the Mastra config level. `circuit/src/mastra/tools/` is a flat directory of tool factories shared by both `orderRoutingAgent` (existing) and the brokering agents (newly added).

```ts
import { brokeringAgents } from './brokering/agents';
import { brokeringApiRoutes } from './brokering/routes';

const config = {
  agents: {
    orderRoutingAgent,
    ...brokeringAgents,
  },
  workspace: routingWorkspace,
  logger: new PinoLogger({ name: 'HC-Agents', level: 'debug' }),
  storage,
  observability: new Observability({ /* unchanged */ }),
  workflows: { orderRoutingJsonCreateWorkflow, orderRoutingJsonCreateWorkflowV2 },
  bundler: { sourcemap: true },
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
```

## File move map

Every file in `accxui/apps/order-routing/mastra/` has a target. Renames are minimal — relocations plus subdir grouping.

| Source (`accxui/apps/order-routing/mastra/`) | Destination (`circuit/src/mastra/`) |
|---|---|
| `index.ts` (682 LOC) | **merged** into `index.ts`; agent declarations extracted to `brokering/agents.ts`; `apiRoutes` extracted to `brokering/routes.ts` |
| `brokeringRouteDraftSchema.ts` | `brokering/schemas/brokeringRouteDraftSchema.ts` |
| `pageCapabilitySchema.ts` | `brokering/schemas/pageCapabilitySchema.ts` |
| `brokeringRunsListInquirySchema.ts` | `brokering/schemas/brokeringRunsListInquirySchema.ts` |
| `brokeringRouteDraftValidator.ts` | `brokering/validators/brokeringRouteDraftValidator.ts` |
| `brokeringRouteIntent.ts` | `brokering/intent/brokeringRouteIntent.ts` |
| `brokeringRouteIntentFallback.ts` | `brokering/intent/brokeringRouteIntentFallback.ts` |
| `brokeringRunsListIntent.ts` | `brokering/intent/brokeringRunsListIntent.ts` |
| `brokeringRouteDraftGeneration.ts` | `brokering/generation/brokeringRouteDraftGeneration.ts` |
| `brokeringRouteAssistantRouting.ts` | `brokering/generation/brokeringRouteAssistantRouting.ts` |
| `orderRoutingDomainKnowledge.ts` | `brokering/domain/orderRoutingDomainKnowledge.ts` |
| `public/knowledge/*.yaml` | `brokering/domain/knowledge/*.yaml` (path constants updated) |
| `manifestUtils.ts` | `brokering/context/manifestUtils.ts` |
| `runsListInquiryContext.ts` | `brokering/context/runsListInquiryContext.ts` |
| `env.ts` | `brokering/env.ts`; remove `import.meta.env` fallback; export renamed to `readServerEnv` |
| `tools/getFacilityChangeSummary.ts` | `tools/getFacilityChangeSummary.ts` |
| `tools/getBrokeringFacilityGroups.ts` | `tools/getBrokeringFacilityGroups.ts` |
| `tools/getProductStoreBrokeringSettings.ts` | `tools/getProductStoreBrokeringSettings.ts` |
| `tools/getFacilityOrderLimits.ts` | `tools/getFacilityOrderLimits.ts` |
| `tools/runBrokeringSimulation.ts` | `tools/runBrokeringSimulation.ts` |
| `tools/submitBrokeringSimulation.ts` | `tools/submitBrokeringSimulation.ts` |
| `tools/getBrokeringSimulationStatus.ts` | `tools/getBrokeringSimulationStatus.ts` |

### Two new files in circuit

- **`src/mastra/brokering/agents.ts`** — exports the four brokering agents currently declared inline in the original `index.ts` (~lines 185-215): `brokeringRouteDraftAgent`, `brokeringRouteInquiryAgent`, `brokeringRunsListInquiryAgent`, `brokeringRouteIntentAgent`. Exposes a single `brokeringAgents` object for spread-merging.
- **`src/mastra/brokering/routes.ts`** — exports `brokeringApiRoutes: ApiRoute[]` — the three `registerApiRoute(...)` blocks from the original `index.ts` (~lines 226-680) for `/brokering-route-assistant`, `/brokering-runs-list-inquiry`, `/brokering-route-draft`.

### Deleted from accxui after cutover

Entire `apps/order-routing/mastra/` directory, plus dependency and script entries in §"PWA cleanup".

## HTTP & schema contracts (frozen)

Three routes, byte-identical request/response shapes before and after migration:

| Endpoint | PWA caller |
|---|---|
| `POST /brokering-route-assistant` | `DraftAssistantService.ts` |
| `POST /brokering-route-draft` | `DraftAssistantService.ts` |
| `POST /brokering-runs-list-inquiry` | `BrokeringRunsAssistantService.ts` |

Route handlers are copied as-is into `brokering/routes.ts`. Status codes, error payloads (including the `providerUnavailable` shape returned when `OPENAI_API_KEY` is empty), and CORS headers are preserved.

Schemas (`brokeringRouteDraftSchema`, `pageCapabilitySchema`, `brokeringRunsListInquirySchema`) move with the server. The PWA never imported them at runtime — only tests did, and those tests move too. There is no contract-sharing problem to solve.

## Environment & config

### Circuit side — new entries in `circuit/.env.example`

```
MASTRA_PORT=4111
MASTRA_ALLOWED_ORIGIN=*
MASTRA_MODEL=openai/gpt-4.1-mini
MASTRA_INTENT_MODEL=openai/gpt-4.1-nano
OPENAI_API_KEY=
# Optional: override knowledge yaml location
ORDER_ROUTING_KNOWLEDGE_DIR=
```

Variable renames inside the moved files:

| Old (in PWA `.env`) | New (in circuit `.env`) |
|---|---|
| `VITE_MASTRA_PORT` | `MASTRA_PORT` |
| `VITE_MASTRA_ALLOWED_ORIGIN` | `MASTRA_ALLOWED_ORIGIN` |
| `VITE_MASTRA_MODEL` | `MASTRA_MODEL` |
| `VITE_MASTRA_INTENT_MODEL` | `MASTRA_INTENT_MODEL` |
| `VITE_OPENAI_API_KEY` *and* `OPENAI_API_KEY` | `OPENAI_API_KEY` (collapsed) |
| `VITE_ORDER_ROUTING_KNOWLEDGE_DIR` | `ORDER_ROUTING_KNOWLEDGE_DIR` |

The `env.ts` shim's `import.meta.env` fallback is removed — circuit runs in plain Node only. Export is renamed from `readEnv` to `readServerEnv` to make the boundary explicit.

### PWA side — `accxui/apps/order-routing/.env.example`

```diff
- VITE_VUE_APP_MASTRA_URL="http://localhost:4111"
- VITE_MASTRA_MODEL="openai/gpt-4.1-mini"
- VITE_MASTRA_PORT=4111
- VITE_MASTRA_ALLOWED_ORIGIN="*"
- VITE_OPENAI_API_KEY=""
+ VITE_VUE_APP_MASTRA_URL="http://localhost:4111"   # now points at sandbox/circuit Mastra
```

Only `VITE_VUE_APP_MASTRA_URL` survives — it is the only var the PWA actually consumes. The others were server-side config that the embedded Mastra picked up off the same `.env` file.

## Test relocation

### Moves to `circuit/src/mastra/test/brokering/`

12 test files plus the fixtures dir:

```
brokeringRouteDraftValidator.test.ts
brokeringRouteDraftSchema.test.ts
brokeringRouteDraftGeneration.test.ts
brokeringRouteAssistantRouting.test.ts
brokeringRouteIntent.test.ts
brokeringRouteIntentFallback.test.ts
brokeringRouteIntentSoak.test.ts
brokeringRunsListIntent.test.ts
runsListInquiryContext.test.ts
orderRoutingDomainKnowledge.test.ts
diagnosticPatterns.test.ts
manifestUtils.test.ts
tests/fixtures/brokeringRouteIntentCases.json → test/brokering/fixtures/
```

Inside each, rewrite imports from `"../mastra/<name>"` to the new subdir paths (e.g. `"../../brokering/validators/brokeringRouteDraftValidator"`). Tests continue to use `node:assert` and run via `npx tsx`, matching both the PWA's prior convention and circuit's existing test layout. If circuit has a different runner already wired, follow its convention.

### Stays in `accxui/apps/order-routing/tests/`

- `brokeringRulesDraftTargets.test.ts` — exercises PWA draft-target binding (no `../mastra/` imports).
- `circuitDraftFeedbackService.test.ts` — exercises PWA service.
- `draftAssistantService.test.ts` — already HTTP-level.

A repo-wide grep `rg 'from ["'\''].*mastra/' apps/order-routing` after migration must return zero matches. That is a verification gate in the cutover plan.

## PWA cleanup

### `accxui/apps/order-routing/package.json`

```diff
 "scripts": {
-  "mastra:dev": "mastra dev --dir mastra",
-  "mastra:build": "mastra build --dir mastra"
 },
 "dependencies": {
-  "@mastra/core": "^1.32.1",
-  "mastra": "^1.8.1",
-  "zod": "^4.4.3"   ← only if no remaining PWA code imports zod
 }
```

`zod` removal is conditional — grep the rest of the PWA before deletion. Same gate for any other dep used solely by the embedded mastra.

### `accxui/apps/order-routing/CLAUDE.md`

- "Common commands" — delete `mastra:dev` / `mastra:build` lines; add a one-line pointer that the Mastra server lives in `sandbox/circuit/` and is run from there.
- "Required env" — delete the `MASTRA_MODEL` / `OPENAI_API_KEY` paragraph; keep the `VITE_VUE_APP_MASTRA_URL` description (and fix the existing `VUE_APP_MASTRA_URL` typo while editing).
- "Tests" — drop the paragraph about `tests/*.test.ts` files coupled to mastra; keep the `node:assert` + `tsx` description applied to the three surviving PWA-side tests.
- "Circuit / brokering-draft pipeline" — rewrite steps 4-7 so the PWA's role ends at HTTP POST to circuit's Mastra. Cross-link to `sandbox/circuit/src/mastra/brokering/` for agent/schema/validator code rather than inline file references.

### Other PWA files

- `tsconfig.json` — remove any `include`/`paths` referencing `mastra/`.
- `vite.config.ts` — remove any `mastra/` references.
- `.gitignore` — remove `mastra/`-specific entries.
- `README.md` and `docs/` — grep for "mastra"; update or delete each occurrence.
- Root `accxui/package.json` and `pnpm-workspace.yaml` — grep for `mastra` references; remove if any.

## Cutover plan

Ordered so circuit is proven working before anything in accxui is deleted. Each gate produces real evidence (test output, server log, curl response) before moving on.

### Phase 1 — Land in circuit

1. Branch in `sandbox/circuit/`: `feat/migrate-brokering-mastra`.
2. Copy files per the move map. No edits to imports yet.
3. Rewrite imports + env var names in the moved files. Drop the Vite branch from `env.ts`; rename export to `readServerEnv`.
4. Create `brokering/agents.ts` and `brokering/routes.ts` by extracting inline declarations from the original `index.ts`.
5. Merge into `circuit/src/mastra/index.ts`: spread brokering agents, append `apiRoutes`, add `server.cors` and `server.port` config.
6. Add tests under `circuit/src/mastra/test/brokering/` with fixed import paths.
7. **Verification gate (must all pass before Phase 2):**
   - `pnpm install` clean.
   - `pnpm tsc --noEmit` (or circuit's existing type-check command) — zero errors.
   - All 12 moved tests pass: `for f in src/mastra/test/brokering/*.test.ts; do npx tsx "$f"; done`.
   - `pnpm mastra:dev` — server boots on port 4111.
   - Manual smoke (one curl per route): `/brokering-route-draft`, `/brokering-route-assistant`, `/brokering-runs-list-inquiry` each return HTTP 200 with a valid body, or the documented `providerUnavailable` payload when `OPENAI_API_KEY` is empty.

If any gate fails: stop, fix, re-run. Do not proceed.

### Phase 2 — Cut PWA over

8. Branch in `accxui/`: `feat/decouple-mastra-from-pwa`.
9. Stop the embedded server. **Do not delete `mastra/` yet.** Point the PWA at circuit by confirming `VITE_VUE_APP_MASTRA_URL=http://localhost:4111` in dev `.env`.
10. Run PWA + circuit in parallel (`npm run dev` in accxui, `pnpm mastra:dev` in circuit). Exercise the three Circuit flows in-browser (Chrome DevTools MCP per the PWA's CLAUDE.md convention):
    - Open a brokering route, ask Circuit to add a proximity sort → draft applies to local Vue state, no console errors.
    - Ask an inquiry question about the current draft → inquiry-mode response.
    - On Brokering Runs list, ask a runs-list question → inquiry response with tool-derived data.
11. Run the three surviving PWA tests (`brokeringRulesDraftTargets`, `circuitDraftFeedbackService`, `draftAssistantService`) — all pass.

### Phase 3 — Delete (verify before each)

12. **Grep gate — must return zero matches before deleting `apps/order-routing/mastra/`:**
    ```
    rg 'from ["'\''].*mastra/' apps/order-routing/src apps/order-routing/tests
    rg '\bmastra:dev\b|\bmastra:build\b' apps/order-routing
    rg '@mastra/core|"mastra"' apps/order-routing/src apps/order-routing/tests
    ```
13. Delete `apps/order-routing/mastra/` directory.
14. Update `package.json` per §"PWA cleanup", then `pnpm install` — confirm `node_modules/@mastra` and `node_modules/mastra` are gone.
15. Re-run the three surviving PWA tests and `npm run lint` — green.
16. Re-run the in-browser smoke from step 10 — still green against circuit.
17. Update `CLAUDE.md`, `README.md`, `.env.example`, `vite.config.ts`, `tsconfig.json` per §"PWA cleanup". Each edit preceded by a grep showing the term's remaining locations.
18. Commit + open PR in each repo; cross-link them in the PR descriptions.

## Rollback

If Phase 2 or Phase 3 surfaces a regression, the PWA branch has not merged and the circuit branch can sit dormant. The embedded `mastra/` still exists until step 13, so reverting Phase 2 (revert the `.env` URL, revert `package.json`) restores the prior behavior with no code recovery needed. After step 13, rollback means `git revert` of the deletion commit on the accxui branch.

## Risks & mitigations

- **Circuit's existing Mastra config requires `DATABASE_URL`/observability env that brokering routes don't need.** Mitigation: leave the existing `storage`/`observability` blocks untouched. They already tolerate an empty `DATABASE_URL` (the current code uses `process.env.DATABASE_URL || ''`). Brokering routes don't depend on storage, so a missing DB env affects only the existing orderRoutingAgent path.
- **Knowledge yaml path resolution.** `orderRoutingDomainKnowledge.ts` resolves the yaml location via `import.meta.url` and an optional `*_KNOWLEDGE_DIR` env override. After move, the relative path inside `brokering/domain/knowledge/` is different; the constant inside the file must be updated, and `ORDER_ROUTING_KNOWLEDGE_DIR` becomes the escape hatch if anything goes wrong.
- **Two PWA tests not yet enumerated could secretly import from `../mastra/`.** Mitigation: the Phase 3 grep gate is authoritative — if it finds anything, that test is added to the move list before deletion proceeds.
- **`zod` may be used by non-mastra PWA code.** Mitigation: grep before removing from `package.json`. If grep finds any consumer in `src/`, `zod` stays.
- **`@mastra/core` types leaking into PWA TS via tsconfig path mapping.** Mitigation: Phase 3 step 17 explicitly checks `tsconfig.json` for `mastra/` paths.

## Acceptance criteria

- `rg 'mastra' accxui/apps/order-routing/src accxui/apps/order-routing/tests` returns only the two HTTP-client services and their tests, with no imports from `../mastra/` or `@mastra/*`.
- `accxui/apps/order-routing/package.json` contains no `@mastra/*` or `mastra` dependencies and no `mastra:*` scripts.
- `accxui/apps/order-routing/mastra/` directory does not exist.
- `circuit/src/mastra/brokering/` contains every relocated source file (13 `.ts` files plus the `domain/knowledge/` yaml asset) and a working `agents.ts` + `routes.ts`. `circuit/src/mastra/tools/` contains the 7 relocated brokering tools.
- `circuit/src/mastra/test/brokering/` contains all 12 test files and the fixtures dir; every test exits 0.
- A locally-running circuit Mastra (`pnpm mastra:dev`) serves the three documented routes; the locally-running PWA (`npm run dev`) successfully completes a draft, an inquiry, and a runs-list inquiry against it.
