# Circuit card visibility — Settings toggle (design)

Date: 2026-06-10
App: `apps/order-routing` (PWA on `:8100`, nested git repo, branch `feat/simulation-outcome-metrics`)
Status: design — awaiting implementation plan

## Problem

A user expected a switch on `/settings` to "remove Circuit from the UI" but saw none.
Investigation found:

- The only Circuit surface in the visible UI on this branch is the **model-installer card**
  on the Settings page (`src/views/Settings.vue:103-153`) — the WebGPU local-model download/GPU-info card.
  Circuit is **not** a routed tab here: `src/views/Circuit.vue` and `src/components/circuit/*` exist
  but have no `/circuit` route, no menu entry, and no nav link.
- The previously-added visibility control (`VITE_SIMULATION_ENABLED`, `src/util/featureFlags.ts`) is a
  **build-time env flag for the Simulate tab**, not a runtime switch and unrelated to Circuit.

So there is no runtime switch for Circuit, and a "hide the Circuit tab" feature has no tab to hide.

## Goal

Add a **runtime toggle on `/settings`** that shows/hides the Circuit model-installer card, persisted
across sessions and reloads.

## Non-goals (YAGNI)

- No env flag (the user explicitly wants a visible switch).
- No router/menu changes — Circuit is not routed on this branch, so there is nothing to gate there.
  (If Circuit later becomes a routed tab, the same store flag can be wired into the existing
  `meta.featureFlag` machinery in `App.vue` / `router/index.ts`. Out of scope now.)
- No new "feature flag framework" — one boolean.

## Design

### State (persisted)

Add to `useCircuitStore` (`src/store/circuit.ts`, already `persist: true`):

- `circuitEnabled: boolean` — state field, **default `true`** (opt-out; consistent with the
  simulation flag's opt-out style).
- `setCircuitEnabled(value: boolean)` — action that sets the field.

Because the store already persists, the user's choice survives reloads with no extra wiring. The new
field is persisted with the rest of the circuit state.

### UI (`src/views/Settings.vue`)

**Option A (chosen): dedicated toggle, card fully disappears.**

- Add a small **"Preferences"** `ion-card` containing one `ion-item` (`lines="none"`) with an
  `ion-toggle` labeled **"Show Circuit"**, bound to `circuitStore.circuitEnabled` via
  `setCircuitEnabled` on `ionChange`.
- Wrap the existing Circuit card (`Settings.vue:103-153`) in `v-if="circuitStore.circuitEnabled"`.
  When off, the entire Circuit card is removed from the UI; the toggle remains visible in the
  Preferences card so the action is always reversible.

Placement: the Preferences card sits in the same `section` grid as the other setting cards
(before the Circuit card so the toggle reads as the control for it). Follow existing Ionic patterns —
native components + CSS variables, no custom typography/color overrides.

### Side-effect guard

`onMounted` currently always calls `circuitStore.checkWebGPUSupport()`. Gate it to run only when
`circuitStore.circuitEnabled` is true, so a hidden feature does not trigger a WebGPU probe. (If the
user later enables the toggle in-session, `checkWebGPUSupport()` should run then too — the toggle
handler can call it when switching from off→on.)

## Data flow

1. Settings loads → reads `circuitStore.circuitEnabled` (persisted, default `true`).
2. Circuit card renders iff `circuitEnabled`. If true, `checkWebGPUSupport()` runs on mount.
3. User flips "Show Circuit" → `setCircuitEnabled(value)` updates store (persisted). Card appears/
   disappears reactively. On off→on, `checkWebGPUSupport()` is invoked by the handler.

## Error handling

- No network/IO in the toggle path; the only failure surface is `checkWebGPUSupport()`, whose existing
  error handling (sets `modelInfo.status = 'unsupported'`) is unchanged.

## Testing

Follow the repo's standalone `tsx`-runnable `node:assert` pattern (`apps/order-routing/tests/*.test.ts`).
Add `tests/circuitVisibility.test.ts` asserting:

- Default `circuitEnabled` is `true`.
- `setCircuitEnabled(false)` sets it to `false`; `setCircuitEnabled(true)` restores it.
- The store is configured with `persist: true` (so the choice survives reloads).

(Settings.vue rendering is not unit-tested in this repo; the store behavior is the testable unit.)

## Files touched

- `apps/order-routing/src/store/circuit.ts` — add `circuitEnabled` state + `setCircuitEnabled` action.
- `apps/order-routing/src/views/Settings.vue` — Preferences card + toggle, `v-if` on Circuit card,
  guard `checkWebGPUSupport()`.
- `apps/order-routing/tests/circuitVisibility.test.ts` — new test.

All code changes land in the **nested `apps/order-routing` git repo** (branch
`feat/simulation-outcome-metrics`). This design doc lives in the outer `accxui` repo alongside the
sibling `2026-06-09-simulation-tab-visibility-flag-design.md`.
