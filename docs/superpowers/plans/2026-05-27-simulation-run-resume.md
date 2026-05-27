# Simulation Run Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an in-flight group-run simulation survive a page refresh — persist submitted jobs to localStorage and resume polling (rebuilding the live progress + results) when the group's Simulate screen reopens.

**Architecture:** A new `SimulationJobStore` (localStorage, one record-list per group, 2h prune) records jobs on submit and removes them on terminal. The store's per-batch poll logic is extracted into a reusable `runBatch` action used by both `submit()` (fresh) and a new `resumeInFlight()` (re-poll persisted jobIds). `Simulation.vue` calls `resumeInFlight` after `loadGroup` on mount. Run-only restore; the editor reopens fresh.

**Tech Stack:** Vue 3 + Ionic 8, Pinia, `localStorage`, pure modules tested with `npx tsx` + `node:assert`.

**Work from:** `/Users/aditipatel/sandbox/accxui/apps/order-routing` for all tasks.

---

## Reference: current `submit()` (in `src/store/simulationStore.ts`)

```typescript
    async submit() {
      const built = this.variations.map((v) => ({ variation: v, variant: buildVariant(v.label, this.baseline, v.group) }));
      const live = built.filter((b) => !isNoOp(b.variant));
      this.runStates = built.map((b) => isNoOp(b.variant)
        ? { variationId: b.variation.id, label: b.variation.label, phase: "failed" as const, error: "No changes vs baseline — skipped." }
        : { variationId: b.variation.id, label: b.variation.label, phase: "pending" as const });
      if (live.length === 0) return;

      this.isRunning = true;
      this.results = null;
      this.view = "results";
      const setPhase = (id: string, phase: VariationRunState["phase"], error?: string) => {
        const rs = this.runStates.find((r) => r.variationId === id);
        if (rs) { rs.phase = phase; if (error) rs.error = error; }
      };

      const batches = chunkVariants(live.map((b) => b.variant), 5);
      const idBatches = chunkVariants(live.map((b) => b.variation.id), 5);
      this.batchProgress = batches.map((_, i) => ({
        batchIndex: i, phaseLabel: "", phaseIndex: 0, phaseCount: 0,
        ordersInScope: 0, ordersProcessed: 0, brokered: 0, queued: 0, events: [],
      }));

      const batchResults = await Promise.all(batches.map(async (variants, i) => {
        const ids = idBatches[i];
        ids.forEach((id) => setPhase(id, "submitted"));
        try {
          const jobId = await submitBatch({ routingGroupId: this.routingGroupId, variants });
          const result = await pollJob(this.routingGroupId, jobId,
            (status) => { if (status === "running") ids.forEach((id) => setPhase(id, "running")); },
            (progress) => { /* updates this.batchProgress[i] via mergeEvents */ });
          ids.forEach((id) => setPhase(id, "done"));
          return result;
        } catch (err: any) {
          ids.forEach((id) => setPhase(id, "failed", err?.message ?? "Batch failed."));
          return null;
        }
      }));

      try { this.results = mergeVariationResults(batchResults); } finally { this.isRunning = false; }
    },
```

## File structure

| File | Responsibility |
|---|---|
| `src/services/SimulationJobStore.ts` (create) | localStorage persistence: `recordJobs`, `getJobs` (prunes >2h), `removeJob`, `clearJobs`. `@common`-free. |
| `src/store/simulationStore.ts` (modify) | `setVariationPhase` + `runBatch` (poll-only) actions; refactor `submit()` to submit-all → record → `runBatch`; add `resumeInFlight()`. |
| `src/views/Simulation.vue` (modify) | Call `sim.resumeInFlight(id)` after `loadGroup` on mount. |
| `tests/simulationJobStore.test.ts` (create) | Persistence + prune tests (injected fake storage). |

---

## Task 1: `SimulationJobStore` (localStorage, TDD)

**Files:**
- Create: `src/services/SimulationJobStore.ts`
- Test: `tests/simulationJobStore.test.ts`

This module must be **`@common`-free** (uses `globalThis.localStorage` + `console`) so its test runs
under `tsx`. Each function accepts an optional `storage` arg (defaults to localStorage) so tests
inject a fake.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/simulationJobStore.test.ts
import assert from "assert";
import { recordJobs, getJobs, removeJob, clearJobs, SimJobRecord, StorageLike } from "../src/services/SimulationJobStore";

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
}
const rec = (jobId: string, submittedAt: number, batchIndex = 0): SimJobRecord =>
  ({ jobId, batchIndex, batchCount: 1, variantLabels: ["V"], submittedAt });

const NOW = 1_000_000_000_000;

// round-trip
{
  const s = fakeStorage();
  recordJobs("G1", [rec("j1", NOW)], s);
  assert.deepStrictEqual(getJobs("G1", NOW, s).map((j) => j.jobId), ["j1"], "record + get round-trip");
}
// prune drops records older than 2h, keeps younger
{
  const s = fakeStorage();
  recordJobs("G1", [rec("old", NOW - 3 * 60 * 60_000), rec("young", NOW - 10 * 60_000)], s);
  assert.deepStrictEqual(getJobs("G1", NOW, s).map((j) => j.jobId), ["young"], "prunes >2h");
}
// removeJob drops one and clears key when empty
{
  const s = fakeStorage();
  recordJobs("G1", [rec("j1", NOW), rec("j2", NOW, 1)], s);
  removeJob("G1", "j1", s);
  assert.deepStrictEqual(getJobs("G1", NOW, s).map((j) => j.jobId), ["j2"], "removeJob drops one");
  removeJob("G1", "j2", s);
  assert.strictEqual(s.map.has("sim.inflight.G1"), false, "key cleared when empty");
}
// corrupt / missing → []
{
  const s = fakeStorage();
  assert.deepStrictEqual(getJobs("MISSING", NOW, s), [], "missing key → []");
  s.setItem("sim.inflight.BAD", "{not json");
  assert.deepStrictEqual(getJobs("BAD", NOW, s), [], "corrupt → []");
}
// clearJobs
{
  const s = fakeStorage();
  recordJobs("G1", [rec("j1", NOW)], s);
  clearJobs("G1", s);
  assert.deepStrictEqual(getJobs("G1", NOW, s), [], "clearJobs empties");
}

console.log("simulationJobStore tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/simulationJobStore.test.ts`
Expected: FAIL — `Cannot find module '../src/services/SimulationJobStore'`.

- [ ] **Step 3: Implement**

```typescript
// src/services/SimulationJobStore.ts
// localStorage persistence of in-flight simulation jobs so a run survives a page refresh.
// @common-free so the test runs under tsx.

export interface SimJobRecord {
  jobId: string;
  batchIndex: number;
  batchCount: number;
  variantLabels: string[];
  submittedAt: number; // epoch ms
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PRUNE_MS = 2 * 60 * 60_000; // 2h
const keyFor = (routingGroupId: string) => `sim.inflight.${routingGroupId}`;

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis !== "undefined" && globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function recordJobs(routingGroupId: string, jobs: SimJobRecord[], storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(routingGroupId), JSON.stringify(jobs));
  } catch (e) {
    console.error("[SimulationJobStore] recordJobs failed", e);
  }
}

export function clearJobs(routingGroupId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(keyFor(routingGroupId));
  } catch (e) {
    console.error("[SimulationJobStore] clearJobs failed", e);
  }
}

/** Returns the non-expired job records for a group, pruning (rewriting/clearing) any older than 2h. */
export function getJobs(routingGroupId: string, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): SimJobRecord[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(keyFor(routingGroupId));
  } catch {
    return [];
  }
  if (!raw) return [];
  let list: SimJobRecord[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    list = parsed;
  } catch {
    return [];
  }
  const fresh = list.filter((j) => now - (j?.submittedAt ?? 0) <= PRUNE_MS);
  if (fresh.length !== list.length) {
    if (fresh.length) recordJobs(routingGroupId, fresh, storage);
    else clearJobs(routingGroupId, storage);
  }
  return fresh;
}

export function removeJob(routingGroupId: string, jobId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const next = getJobs(routingGroupId, Date.now(), storage).filter((j) => j.jobId !== jobId);
  if (next.length) recordJobs(routingGroupId, next, storage);
  else clearJobs(routingGroupId, storage);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/simulationJobStore.test.ts`
Expected: PASS — prints `simulationJobStore tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/services/SimulationJobStore.ts tests/simulationJobStore.test.ts
git commit -m "feat(resume): SimulationJobStore — localStorage in-flight job persistence + 2h prune"
```

---

## Task 2: Store — `runBatch`, persisted `submit()`, `resumeInFlight()`

**Files:**
- Modify: `src/store/simulationStore.ts`

- [ ] **Step 1: Add imports**

At the top, add:

```typescript
import * as SimulationJobStore from "../services/SimulationJobStore";
```
(The store already imports `mergeEvents`, `chunkVariants`, `mergeVariationResults`, `submitBatch`,
`pollJob`, and the types incl. `BatchProgress`, `VariationRunState`, `SimVariant`. If `SimVariant`
is not yet imported from `../types/simulation`, add it to that import.)

- [ ] **Step 2: Add a `zeroed batchProgress` helper + `setVariationPhase` + `runBatch` actions**

Add this module-level helper above `export const simulationStore` (next to `deepClone`):

```typescript
const zeroedBatch = (batchIndex: number): BatchProgress => ({
  batchIndex, phaseLabel: "", phaseIndex: 0, phaseCount: 0,
  ordersInScope: 0, ordersProcessed: 0, brokered: 0, queued: 0, events: [],
});
```

Add these two actions inside `actions: { ... }` (e.g. just above `submit`):

```typescript
    // Update the phase (+ optional error) of every runStates entry whose id is in `ids`.
    setVariationPhase(ids: string[], phase: VariationRunState["phase"], error?: string) {
      ids.forEach((id) => {
        const rs = this.runStates.find((r) => r.variationId === id);
        if (rs) { rs.phase = phase; if (error) rs.error = error; }
      });
    },

    // Poll one already-submitted batch job to completion, streaming progress into batchProgress
    // and updating runStates. Removes the persisted record on terminal. Returns the poll result
    // ({ groupRun?|variation? }) or null on failure. Used by both submit() and resumeInFlight().
    async runBatch(args: { batchIndex: number; ids: string[]; jobId: string }): Promise<any | null> {
      const { batchIndex, ids, jobId } = args;
      this.setVariationPhase(ids, "running");
      try {
        const result = await pollJob(
          this.routingGroupId,
          jobId,
          (status) => { if (status === "running") this.setVariationPhase(ids, "running"); },
          (progress) => {
            const bp = this.batchProgress[batchIndex];
            if (!bp) return;
            bp.phaseLabel = progress.phaseLabel;
            bp.phaseIndex = progress.phaseIndex;
            bp.phaseCount = progress.phaseCount;
            bp.ordersInScope = progress.ordersInScope;
            bp.ordersProcessed = progress.ordersProcessed;
            bp.brokered = progress.brokered;
            bp.queued = progress.queued;
            bp.events = mergeEvents(bp.events, progress.events ?? [], 50);
          },
        );
        this.setVariationPhase(ids, "done");
        SimulationJobStore.removeJob(this.routingGroupId, jobId);
        return result;
      } catch (err: any) {
        this.setVariationPhase(ids, "failed", err?.message ?? "Batch failed.");
        SimulationJobStore.removeJob(this.routingGroupId, jobId);
        return null;
      }
    },
```

- [ ] **Step 3: Rewrite `submit()` to submit-all → record → runBatch**

Replace the existing `submit()` action body (everything after the `if (live.length === 0) return;`
line) with:

```typescript
      this.isRunning = true;
      this.results = null;
      this.view = "results";

      const batches = chunkVariants(live.map((b) => b.variant), 5);
      const idBatches = chunkVariants(live.map((b) => b.variation.id), 5);
      this.batchProgress = batches.map((_, i) => zeroedBatch(i));

      // Submit every batch first (instant responses) so we have all jobIds to persist up-front.
      SimulationJobStore.clearJobs(this.routingGroupId);
      const submitted = await Promise.all(batches.map(async (variants, i) => {
        const ids = idBatches[i];
        this.setVariationPhase(ids, "submitted");
        try {
          const jobId = await submitBatch({ routingGroupId: this.routingGroupId, variants });
          return { batchIndex: i, ids, jobId, variantLabels: variants.map((v) => v.label) };
        } catch (err: any) {
          this.setVariationPhase(ids, "failed", err?.message ?? "Failed to submit batch.");
          return { batchIndex: i, ids, jobId: null as string | null, variantLabels: variants.map((v) => v.label) };
        }
      }));

      const okJobs = submitted.filter((s) => s.jobId) as Array<{ batchIndex: number; ids: string[]; jobId: string; variantLabels: string[] }>;
      SimulationJobStore.recordJobs(this.routingGroupId, okJobs.map((s) => ({
        jobId: s.jobId, batchIndex: s.batchIndex, batchCount: batches.length,
        variantLabels: s.variantLabels, submittedAt: Date.now(),
      })));

      const batchResults = await Promise.all(okJobs.map((s) => this.runBatch({ batchIndex: s.batchIndex, ids: s.ids, jobId: s.jobId })));
      try { this.results = mergeVariationResults(batchResults); } finally { this.isRunning = false; }
```

(The lines before `if (live.length === 0) return;` — building `built`, `live`, and the initial
`runStates` — stay unchanged. The old inline `setPhase` closure is removed; phase updates now go
through `this.setVariationPhase`.)

- [ ] **Step 4: Add `resumeInFlight()` action**

Add this action (e.g. right after `submit`):

```typescript
    // On reopening a group's Simulate screen, re-attach to any persisted in-flight jobs and resume
    // polling — rebuilding the live panels + runStates summary and merging results on completion.
    async resumeInFlight(routingGroupId: string) {
      const jobs = SimulationJobStore.getJobs(routingGroupId);
      if (!jobs.length) return;

      this.routingGroupId = routingGroupId;
      this.isRunning = true;
      this.results = null;
      this.view = "results";

      const batchCount = jobs[0].batchCount || jobs.length;
      this.batchProgress = Array.from({ length: batchCount }, (_, i) => zeroedBatch(i));
      this.runStates = [];

      const toRun = jobs.map((j) => {
        const ids = j.variantLabels.map((label, n) => {
          const id = `${j.batchIndex}:${n}`;
          this.runStates.push({ variationId: id, label, phase: "running" as const });
          return id;
        });
        return { batchIndex: j.batchIndex, ids, jobId: j.jobId };
      });

      const batchResults = await Promise.all(toRun.map((x) => this.runBatch(x)));
      try { this.results = mergeVariationResults(batchResults); } finally { this.isRunning = false; }
    },
```

- [ ] **Step 5: Type-check + lint + sanity tests**

Run: `npx tsc --noEmit -p tsconfig.json` → confirm no errors reference `simulationStore.ts`.
Run: `npx eslint --ext .ts src/store/simulationStore.ts` → fix new errors.
Run: `npx tsx tests/simulationBatch.test.ts && npx tsx tests/simulationService.test.ts` → still pass
(unrelated, confirms imports intact).

- [ ] **Step 6: Commit**

```bash
git add src/store/simulationStore.ts
git commit -m "feat(resume): runBatch extraction, persist jobs on submit, resumeInFlight action"
```

---

## Task 3: `Simulation.vue` — resume on mount

**Files:**
- Modify: `src/views/Simulation.vue`

- [ ] **Step 1: Call `resumeInFlight` after `loadGroup`**

In the `<script setup>`, change the `reload` function so it resumes any in-flight run after the
group loads:

```typescript
async function reload() {
  await sim.loadGroup(String(props.routingGroupId));
  await sim.resumeInFlight(String(props.routingGroupId));
}

onMounted(reload);
```

(Everything else in `Simulation.vue` stays as-is. `loadGroup` resets state and the editor; `resumeInFlight`
then repopulates `isRunning`/`batchProgress`/`runStates` and flips `view` to `results` if a persisted
job exists, so the live feed reappears.)

- [ ] **Step 2: Lint + build**

Run: `npx eslint --ext .vue src/views/Simulation.vue` → fix new errors.
Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/views/Simulation.vue
git commit -m "feat(resume): resume in-flight run on Simulate screen mount"
```

---

## Task 4: End-to-end verification

**Files:** none.

- [ ] **Step 1: Full pure suite + lint + build**

Run: `npx tsx tests/simulationJobStore.test.ts && npx tsx tests/progressBuffer.test.ts && npx tsx tests/simulationDiff.test.ts && npx tsx tests/simulationBatch.test.ts && npx tsx tests/simulationService.test.ts`
Expected: all five print their `… passed` lines.
Run: `npx eslint --ext .ts,.vue src/services/SimulationJobStore.ts src/store/simulationStore.ts src/views/Simulation.vue` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 2: In-app check (against the live backend)**

With `npm run dev` running: build ≥1 variation and Submit; once it's polling (view = Simulation),
**refresh the page**. After reload, the Simulate screen should re-enter the Simulation view with the
live panel(s) resuming (progress continuing), and complete into the results scorecard. Submitting a
fresh run afterward clears the old records. (Also verify a normal, no-refresh run still completes.)

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A && git commit -m "chore(resume): end-to-end verification fixes"
```

---

## Notes for the implementer

- **Partial-completion cosmetic gap:** if some batches finished (records removed) before the refresh,
  `resumeInFlight` rebuilds `batchProgress` sized to the original `batchCount`, so already-finished
  batches show an empty placeholder panel until the run completes and the results view takes over.
  Acceptable for v1 — do not add special handling.
- **`@common` import rules:** `SimulationJobStore.ts` must stay `@common`-free (uses
  `globalThis.localStorage` + `console`); `SimulationService.ts` keeps `@common` dynamic-imported.
- **Synthetic runStates ids on resume** (`"<batchIndex>:<n>"`) only need to be unique within the run;
  they are not real variation ids (the variations are gone after refresh) and are used solely to key
  phase updates.
- **Pinia reactivity:** mutating `this.batchProgress[i].<field>` in place + reassigning `bp.events`
  is the established pattern; `this.runStates.push(...)` and array reassignment are reactive.
- **Field-name assumptions** match the live progress feed + result shapes already in the store; no new
  backend fields are introduced.
