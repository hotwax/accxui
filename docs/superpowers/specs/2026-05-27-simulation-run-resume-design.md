# Simulation Run Resume (Refresh-Resilient) — Design Spec

**Date:** 2026-05-27
**Author:** toaditi
**Status:** Draft — pending user review

---

## Context

Group-run simulations are submitted async (submit → poll) and can run 10–60 min. The PWA holds the
run entirely in the Pinia `simulationStore` plus an in-memory poll loop, so a **page refresh loses
the run**: `loadGroup` re-runs and resets `isRunning`/`batchProgress`/`results`, the poll loop is
gone, and the still-running backend job is orphaned — the screen shows "No simulation has run yet"
even though one is in progress. The backend KT explicitly recommends persisting `jobId` and resuming
polling across refresh/navigation. This spec covers that resilience.

Builds on the shipped simulation screen, the verified async contract, and the live progress feed
(`2026-05-27-live-progress-feed-design.md`).

---

## Goals / Non-goals

**Goals**
- Persist submitted job(s) so an in-flight run survives a refresh.
- On reopening the group's Simulate screen, auto-resume polling and show the live progress, then the
  results on completion.

**Non-goals**
- Restoring the editor's variations/draft (run-only resume; the editor reopens fresh — the
  progress/result envelopes carry their own labels).
- A global, cross-tab "run in progress" indicator (same-group, on-screen resume only).
- Resuming via IndexedDB or a server-side session (localStorage only).
- Recovering runs whose `jobId` was never persisted (i.e. runs submitted before this ships).

---

## Key decisions (from brainstorming)

1. **Run-only restore** — persist/resume the run; the editor reopens fresh (no variations).
2. **Same-group, on-screen resume** — resume when the group's Simulate screen mounts; no global indicator.
3. **Storage** — `localStorage`, one record-list per group.
4. **Prune window** — auto-resume only jobs younger than **2 hours** (covers a ~1h run + the 5-min
   result TTL); older records are dropped on read.

---

## What is persisted + lifecycle

```
localStorage key:  "sim.inflight.<routingGroupId>"  →  SimJobRecord[]
SimJobRecord = {
  jobId: string;
  batchIndex: number;     // position within the run's batches
  batchCount: number;     // total batches in the run (for rebuilding placeholders)
  variantLabels: string[];// labels of the variants in this batch (for the runStates summary)
  submittedAt: number;    // epoch ms — for the 2h prune
}
```

- **Write** all batch records on submit (the `jobId` is known right after `submitBatch`).
- **Remove** a record when its batch reaches a terminal state (complete/failed/not_found); when the
  list empties, remove the key.
- **Prune on read:** drop records with `Date.now() - submittedAt > 2h`; if all pruned, the key is cleared.
- **Failure-tolerant:** any storage error (disabled/full) is swallowed + logged — the in-session run
  is unaffected, it just isn't refresh-resilient.

---

## Architecture

### New module — `src/services/SimulationJobStore.ts`

Thin, pure-ish wrapper over `localStorage` (injectable storage for tests):

```typescript
interface SimJobRecord { jobId: string; batchIndex: number; batchCount: number; variantLabels: string[]; submittedAt: number; }
const PRUNE_MS = 2 * 60 * 60_000; // 2h

recordJobs(routingGroupId: string, jobs: SimJobRecord[]): void   // overwrites the group's list
getJobs(routingGroupId: string, now = Date.now()): SimJobRecord[] // returns non-expired; prunes expired (rewrites/clears)
removeJob(routingGroupId: string, jobId: string): void           // drops one; clears key when empty
clearJobs(routingGroupId: string): void
```

Reads/writes JSON; all calls wrapped in try/catch (log + no-op on error). The prune logic
(`getJobs` filtering by `submittedAt`) is the unit-tested core.

### Store — `src/store/simulationStore.ts`

**Extract a batch runner.** `submit()` currently inlines, per batch: `submitBatch` → `pollJob`
(with `onProgress` updating `batchProgress[i]` and `onPhase` updating `runStates`) → collect result.
Pull this into a reusable internal:

```typescript
// resolves to the batch's poll result ({ groupRun?|variation? }) or null on failure
async runBatch(args: {
  batchIndex: number;
  ids: string[];                 // runStates ids in this batch (synthetic on resume)
  jobId?: string;                // present on resume → poll existing job, skip submitBatch
  variants?: SimVariant[];       // present on fresh submit
}): Promise<any | null>
```
- Fresh: `jobId = await submitBatch({...variants})`, then `SimulationJobStore.recordJobs` is updated
  to include it (recorded up-front in `submit()` once all jobIds exist — see below), then poll.
- Resume: poll the given `jobId` directly.
- Both: `pollJob(groupId, jobId, onPhase→setPhase, onProgress→batchProgress[batchIndex])`; on
  terminal, `SimulationJobStore.removeJob(groupId, jobId)`; return result or null on error.

**`submit()`** — after computing `batches` and submitting (jobIds known), write records via
`SimulationJobStore.recordJobs(groupId, records)` (one per batch: jobId, batchIndex, batchCount =
batches.length, variantLabels from the batch's variants, submittedAt = now). Clears the group's
records first so a new submit never mixes with stale ones. Otherwise unchanged (still uses `runBatch`
+ `mergeVariationResults`).

**`resumeInFlight(routingGroupId)`** (new action) — `const jobs = SimulationJobStore.getJobs(id)`;
if empty, return. Else:
- `isRunning = true`, `view = "results"`, `results = null`.
- Rebuild `batchProgress` = array of `batchCount` zeroed placeholders.
- Rebuild `runStates` from each record's `variantLabels` (synthetic ids `"<batchIndex>:<n>"`, phase
  `"running"`).
- `Promise.all(jobs.map(j => runBatch({ batchIndex: j.batchIndex, ids: <its synthetic ids>, jobId: j.jobId })))`,
  then `results = mergeVariationResults(...)`, `isRunning = false` (in a `finally`).

### View — `src/views/Simulation.vue`

`onMounted`: after `await sim.loadGroup(id)`, call `sim.resumeInFlight(id)`. Resume repopulates the
run state and flips `view` to `results`, so the user immediately sees the live feed when returning to
a group with an in-flight run. (`loadGroup` already ran and reset state; resume layers on top.)

---

## Data flow

```
submit():  per batch → submitBatch → jobId  ──recordJobs──▶ localStorage["sim.inflight.<group>"]
           runBatch polls; on terminal → removeJob

refresh → Simulation.vue onMounted:
  loadGroup(id)                      // resets state, editor fresh
  resumeInFlight(id):
    getJobs(id) (pruned)             // localStorage
    rebuild batchProgress + runStates + isRunning + view='results'
    per record → runBatch({ jobId }) // re-attach poll loop
    merge results → results view ; removeJob on each terminal
```

---

## Error handling / edge cases

| Condition | Handling |
|---|---|
| Resumed job `not_found` (expired/pruned server-side) | Terminal; mark that batch's variations failed with "result no longer available"; `removeJob`. No retry loop. |
| All records pruned by age on read | `getJobs` returns `[]`; `resumeInFlight` no-ops; key cleared. |
| Completion after resume | Normal `mergeVariationResults` → results; records removed. |
| New `submit()` while records exist | `submit()` clears the group's records first, then writes fresh ones. |
| `localStorage` unavailable/full | try/catch swallows; run still works in-session (just not resumable). |
| Multiple groups | Records keyed per group; only the opened group resumes. |

---

## Testing

- **`SimulationJobStore`** (pure, `tsx` + injected fake storage): `recordJobs`/`getJobs` round-trip;
  prune drops records older than 2h and keeps younger; `removeJob` drops one and clears the key when
  empty; corrupt/missing JSON → `[]` (no throw).
- **`runBatch` paths:** fresh (submit+poll) and resume (poll existing jobId) both update
  `batchProgress` and return the result; failure → null. (Via existing fake-`api` seams.)
- **In-app:** submit a run → refresh the page → the run reappears (live panels resume) and completes
  into the results view; the editor reopens with no variations.

---

## Open questions / assumptions

1. **Backend job survives client gaps** — the async job runs server-side independent of the client;
   re-polling an existing `jobId` after a refresh returns its current state (per the verified
   contract). Confirmed by the KT ("keep polling continuously … 5-min result TTL after completion").
2. **2h prune window** — chosen to cover a ~1h run + 5-min result TTL with margin; adjust if runs get
   longer.
3. **Pre-existing orphaned runs** — runs submitted before this ships had no persisted `jobId` and
   cannot be resumed; they still persist server-side to the past-simulations DB (separate feature).
