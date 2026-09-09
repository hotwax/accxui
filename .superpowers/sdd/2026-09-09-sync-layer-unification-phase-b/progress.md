# SDD ledger — plan: docs/superpowers/plans/2026-09-09-sync-layer-unification-phase-b.md

Repos: accxui root (Tasks 1-5, 12), apps/order-manager (6), apps/company (7-11). Branch app-db-refined-2.
No worktree: apps/* are nested separate repos inside the accxui tree; a worktree would have an
empty apps/ and could not run the app suites, which gate every task.

Baselines at Phase B start: common 189/4 · order-manager 517/0 · company 690/0 · inventory-count 20/12
Company target at end: 669/0 (690 - 28 framework-superseded tests + 7 net new).

Pre-flight: Task 1's refetchOne stub was corrected in the plan before execution (would have
regressed Order Manager's refreshAfterMutation for one task).

Task 1: implemented (commit fed39ef) — DONE_WITH_CONCERNS, concern verified as a real break.
Task 1: PLAN DEFECT found by the implementer. Porting the harness changed its Comlink protocol
  in place while appDbBootstrap (Order Manager's path until Task 6) still speaks the old one:
  updateToken/resyncDomain/resyncAll removed, refetchOne resignatured, and OM passes domains as
  string[] where the port expects ActiveDomain[]. OM's sync would be dead Tasks 1-6; its 517 tests
  pass only because they mock the worker. Violates the plan's own additive-only constraint.
  Plan amended: Task 12 Step 3b now removes the shims. Fix round 1 dispatched to restore them.
Task 1: shim fix landed (commit 48a001d, +5 shim tests). Full task review then run over 46458ad..48a001d.
Task 1: review — spec ❌ on one Important: resyncAll force-ticks only the ACTIVE set, where the old
  harness's unforced tick fell back to ALL registered domains when active was empty. Masked today
  because OM activates its whole catalog. Fix round 1 dispatched.
Task 1: minor (deferred): subscribeToken's unsubscribe is discarded and stop() never closes the
  BroadcastChannel — one leaked listener per harness instance (~14 across the spec file).
Task 1: minor (deferred): LOGIN_MARKER_PREFIX redefined locally instead of reused from baseDb.ts.
Task 1: fix round 1/5 (1 addressed, 0 open — resyncAll now iterates getAllSyncDomains, skips class C, tolerates per-domain failure; commit 9a3df1c)
Task 1: complete (commits 46458ad..9a3df1c, review clean after 1 fix round; class-C exclusion and registered-but-inactive coverage verified by controller)
Task 2: complete (commits 9a3df1c..5277a31, review clean — spec ✅)
Task 2: minor (deferred): ordering spec test 3 (different scopes concurrent) would also pass against a fully-concurrent impl — it only discriminates against over-serialization. Correct for its job, noted so no one mistakes it for an ordering test.
Task 2: note — runTargetedRefetch passes the 3rd args positional only when present (Company passes unconditionally). Reviewer verified every refetchOne in both repos is (ctx, pk) and reads no args, so it is behaviour-preserving today. Revisit when the shims go in Task 12.
Task 3: implemented (commit bec6148) — DONE_WITH_CONCERNS, concern verified as a real gap.
Task 3: PLAN DEFECT found by the implementer (2nd of the phase). The brief's SyncServiceOptions had
  no `db`, so appDbBootstrap's ensureRowShape/DB_SHAPE_VERSION had nowhere to go. It is the only
  thing clearing stale tables on a shape bump, and Task 6 moves OM off appDbBootstrap — the check
  would have been silently lost, surfacing only at the next DB_SHAPE_VERSION bump. Plan amended:
  optional db on SyncServiceOptions, and ensureRowShape MOVES to baseDb.ts so appDbBootstrap and
  syncService share one implementation. Fix round 1 dispatched.
Task 3: fix round 1/5 (1 addressed, 0 open — ensureRowShape/DB_SHAPE_VERSION MOVED to baseDb.ts, db? added to options, 2 covering tests; commit a6a224c)
Task 3: complete (commits 5277a31..a6a224c, review clean — spec ✅)
Task 3: git incident — implementer ran commit --amend and absorbed the controller's concurrent doc commit, recovered via reflog + reset --soft. Controller verified final history: 627fb94 holds only the plan doc, a6a224c only code, ensureRowShape defined exactly once. Sound.
Task 3: PLAN DEFECT (3rd) found via the reviewer's clearLocalDb question. appDbBootstrap has two live consumers nobody had rehomed: useDb.ts imports bootstrapState (core read composable, both apps), and OM's store/user.ts imports clearLocalDb. Task 12 would have deleted the module under them. Plan amended with Step 4b.
Task 3: minor (deferred): apps/company worker-reachable files (workers/syncRegistry.ts:78, domains/registerSeedDomains.ts:3) import the @common/db barrel, which pulls vue into the worker chunk. Pre-existing, not introduced here; Task 7 deletes both files, so it self-resolves — confirm it did.
Task 4: implemented (commit ea13cb2). Review: port verified byte-for-byte faithful to Company's
  original, but spec ❌ on two Important test findings, both traceable to the brief's test code:
  (a) the delete-before-set re-insertion — the behaviour the brief itself called load-bearing — is
  implemented but untested; removing the delete() would pass the whole suite. (b) beforeEach resets
  only serviceState.errors, not the private maps, so test 3 leaks into test 4 and test 4 passes via
  the duplicate short-circuit rather than a fresh insert. Fix round 1 dispatched.
Task 4: fix round 1/5 (3 addressed, 0 open — discriminating re-insertion test via a 2nd untouched scope, __resetErrorState for isolation, single-service assumption documented; commit d17cf9e)
Task 4: note — the controller's suggested test shape was WRONG (single scope makes delete+set and bare set indistinguishable). The implementer caught it, corrected the shape, and verified RED/GREEN empirically.
Task 4: complete (commits 7df5181..d17cf9e, review clean after 1 fix round)
Task 5: complete (commit 507fd3e, review clean — spec ✅; useDbStatus accepts async catalog source and exports catalogLoaded ref)

Framework Phase B Additive Status: 100% COMPLETE (Tasks 1-5 finished in accxui root repo). All framework tests pass (233 pass / 4 pre-existing fail).
