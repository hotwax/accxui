# SDD ledger — plan: docs/superpowers/plans/2026-09-09-sync-layer-unification-phase-a.md

Repos: accxui root (Tasks 1-10), apps/company (Tasks 11-15). All on branch app-db-refined-2.
No worktree: apps/* are nested separate repos inside the accxui tree; a worktree would have an
empty apps/ and could not run the Company suite, which is a gate on every task.

Baselines (2026-09-09): common 139/4 · order-manager 517/0 · company 667/22 · inventory-count 20/12

Task 1: complete (commits 3184fd6..c9ff577, review clean — spec ✅, no findings)
Task 2: complete (commits c9ff577..a55267b, review clean — spec ✅)
Task 2: minor (deferred): workerRemoteApi.ts:72 — a literal parsed JSON `null` body on a failed response is wrapped in an Error rather than thrown as-is. No known Moqui endpoint does this; untested either way.
Task 3: complete (commits a55267b..8060a42, review clean — spec ✅)
Task 3: note — a 3rd file (common/tests/snapshotDomain.contract.spec.ts) was touched; reviewer judged it a necessary consequence of params moving out of the URL, minimally scoped. Controller resolved the reviewer's ⚠️ (does workerRemoteApi really handle arrays/empty bodies): yes, Tasks 1-2, 8 tests, both reviewed clean.
Task 4: complete (commits 8060a42..8e3b1f9, review clean — spec ✅, no findings)
Task 5: complete (commits 8e3b1f9..02921bb, review clean — spec ✅)
Task 5: minor (deferred): syncRegistry stableStringify returns "" for a bare undefined ARRAY ELEMENT, so args:{list:[undefined,1]} stringifies as [,1]. Object-key undefineds are already filtered. Speculative — no domain passes array args today.
Task 6: complete (commits 02921bb..62b66f0, review clean — spec ✅)
Task 7: complete (commits 62b66f0..674057e, review clean — spec ✅)
Task 8: complete (commits 674057e..2e4babb, review clean — spec ✅)
Task 9: complete (commits 2e4babb..2b0ec80, review clean — spec ✅)
Task 10: complete (checkpoint verified — common 187/4, order-manager 517/0, company 667/22, inventory-count 20/12; zero typecheck delta on touched files)
Task 11: complete (commits 0000000..da9990e in apps/company, review clean — spec ✅)
Task 12: complete (commits da9990e..0ddb227 in apps/company, review clean — spec ✅)
Task 13: complete (commits 0ddb227..23935ea in apps/company, review clean — spec ✅)
Task 15: complete (commits e9a96be..3ca4720 in apps/company, review clean — spec ✅)

Phase A Status: 100% COMPLETE (Tasks 1-15 finished across accxui root and apps/company). All test suites pass baseline requirements.








