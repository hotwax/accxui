# Simulation Tab Visibility Flag — Design Spec

**Date:** 2026-06-09
**Author:** toaditi
**Status:** Draft — pending user review
**Repo/branch:** `apps/order-routing` @ `feat/simulation-outcome-metrics` (post origin/main merge: flat routing + side menu)

---

## Context

After the ATP merge, navigation is a **side menu** built in `App.vue` from `router.getRoutes()`,
filtering by `meta.menuIndex` (present) and `meta.permissionId` (permission), grouped by
`meta.section`. The **Simulate** entry is `/simulate` (`menuIndex: 11`, `section: "routing"`, no
permission). Some deployments aren't ready to expose the brokering simulation, so we need a config
switch to show/hide it.

## Decision (from brainstorming)

- **Per-deployment env flag** (not per-user, not per-store): `VITE_SIMULATION_ENABLED`. Matches the
  app's `.env`-driven config convention and the existing `VITE_SIM_*` vars. No backend dependency.
- **Default shown (opt-out):** unset/missing → tab shows; only the literal string `"false"` hides
  it. Non-breaking for current deployments.
- **Hide menu entry AND guard the routes:** when disabled, the menu entry is gone *and* direct
  navigation / bookmarks / deep-links to `/simulate*` redirect to `/brokering`. Feature fully off.

## Goals / Non-goals

**Goals**
- One env flag that hides the Simulate menu entry and blocks its routes when set to `"false"`.
- Pure, testable enablement helper; generic enough to gate future menu entries by a `meta` flag.

**Non-goals**
- Per-user toggle or per-product-store backend setting (explicitly rejected in brainstorming).
- Hiding any other tab; changing the menu/permission architecture.
- A runtime/admin UI to flip it (it's a deploy-time env var).

## Architecture

### 1. Enablement helper — `src/util/featureFlags.ts` (new, pure)

```ts
export function isSimulationEnabled(env: Record<string, any> = import.meta.env): boolean {
  // Default shown: only the explicit string "false" hides it.
  return String((env && env.VITE_SIMULATION_ENABLED) ?? "true").trim().toLowerCase() !== "false";
}

// Map a route's meta.featureFlag to its enablement. Unknown flag → visible (fail open).
export function isFeatureEnabled(flag: string, env: Record<string, any> = import.meta.env): boolean {
  switch (flag) {
    case "simulation": return isSimulationEnabled(env);
    default: return true;
  }
}
```
`env` is injectable so it runs under `npx tsx` (mirrors `simApiBaseUrl()` in `SimulationService.ts`).

### 2. Route metadata + guard — `src/router/index.ts`

- Extend the existing `declare module "vue-router" { interface RouteMeta { … } }` with
  `featureFlag?: string`.
- Tag the `/simulate` route: `meta.featureFlag: "simulation"`.
- Add a guard that redirects when disabled, composed with the existing `authGuard`, applied to the
  three simulate routes (`/simulate`, `/simulate/:routingGroupId`, `/simulate/history/:simulationId`):

```ts
const simulateGuard = (to: any, from: any, next: any) =>
  isFeatureEnabled("simulation") ? authGuard(to, from, next) : next("/brokering");
```
Each simulate route uses `beforeEnter: simulateGuard` (replacing its current `beforeEnter: authGuard`).

### 3. Menu filter — `src/App.vue`

In the `menuItems` computed chain, add one filter step (keeps `App.vue` decoupled from the hardcoded
path; works for any future flagged route):

```ts
.filter((route) => !route.meta.featureFlag || isFeatureEnabled(route.meta.featureFlag as string))
```
No change to the `.map(...)` shape.

## Data flow

`VITE_SIMULATION_ENABLED` (build-time) → `isSimulationEnabled()` → `isFeatureEnabled("simulation")`
→ consumed by (a) the `App.vue` menu filter (hide entry) and (b) `simulateGuard` (block routes).
Single source of truth; both consumers read the same helper.

## Errors / edge cases

- Unset / empty / any value except `"false"` → enabled (shown). Case-insensitive, trimmed, so
  `"FALSE"`, `" false "` also hide.
- Disabled + user navigates to a `/simulate*` URL → redirect to `/brokering` (no dead screen).
- The "View saved result" deep-link in `SimulationResults` is unreachable when disabled (you can't
  run a sim), and the guard covers it regardless.

## Testing

- **`tests/featureFlags.test.ts`** (tsx + `node:assert`, injected env): `isSimulationEnabled` —
  unset → true, `"false"` → false, `"FALSE"`/`" false "` → false, `"true"` → true; `isFeatureEnabled`
  — `"simulation"` delegates, unknown flag → true.
- **Menu + guard:** verified in the running app (no menu/router unit harness) — with the var unset
  the Simulate entry shows and routes work; with `VITE_SIMULATION_ENABLED="false"` the entry is gone
  and `/simulate` redirects to `/brokering`.

## Files

| File | Change |
|---|---|
| `src/util/featureFlags.ts` | create — `isSimulationEnabled`, `isFeatureEnabled` |
| `tests/featureFlags.test.ts` | create — pure tsx tests |
| `.env.example` | add `VITE_SIMULATION_ENABLED="true"` + comment |
| `src/router/index.ts` | `RouteMeta.featureFlag`, `/simulate` `meta.featureFlag`, `simulateGuard` on the 3 simulate routes |
| `src/App.vue` | one filter step in `menuItems` |

## Open questions

None — scope, default, and guard behavior are decided.
