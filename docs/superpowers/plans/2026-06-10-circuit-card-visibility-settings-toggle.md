# Circuit card visibility — Settings toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted runtime toggle on `/settings` ("Show Circuit") that shows/hides the Circuit model-installer card.

**Architecture:** Add a `circuitEnabled` boolean (default `true`) + `setCircuitEnabled` action to the existing `useCircuitStore` (Pinia, already `persist: true`). In `Settings.vue`, add a "Preferences" card containing the toggle, wrap the existing Circuit card in `v-if="circuitStore.circuitEnabled"`, and gate the `checkWebGPUSupport()` probe so it only runs when Circuit is enabled.

**Tech Stack:** Vue 3 + Ionic 8, Pinia with `pinia-plugin-persistedstate`, Vitest (`npm run test:unit`).

> **Working directory for ALL tasks:** `apps/order-routing` (a nested git repo, branch `feat/simulation-outcome-metrics`). All `git`, `npx vitest`, and `npm` commands below run from there, NOT the outer `accxui` repo. The design doc lives in the outer repo; code + tests live here.

---

## File Structure

- `src/store/circuit.ts` — add `circuitEnabled` to `CircuitState` interface + state default + `setCircuitEnabled` action. (Single responsibility unchanged: circuit feature state.)
- `src/views/Settings.vue` — Preferences card with toggle, `v-if` on the Circuit card, guard `checkWebGPUSupport()`, `toggleCircuit` handler, `IonToggle` import.
- `tests/circuitVisibility.test.ts` — new Vitest spec for the store behavior.

---

## Task 1: Store flag + action (TDD)

**Files:**
- Modify: `src/store/circuit.ts` (interface ~line 6-25, state default ~line 30-48, actions block ~line 380-391)
- Test: `tests/circuitVisibility.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/circuitVisibility.test.ts`:

```ts
// tests/circuitVisibility.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// The circuit store imports @common + the WebLLM / IndexedDB service modules at load time.
// Stub them so the store module imports cleanly in the Vitest environment.
vi.mock("@common", () => ({ translate: (s: string) => s }));
vi.mock("@/services/CircuitStorageService", () => ({ CircuitStorageService: {} }));
vi.mock("@/services/CircuitLLMService", () => ({ default: {} }));

import { useCircuitStore } from "../src/store/circuit";

describe("circuit visibility toggle", () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it("defaults circuitEnabled to true (card shown by default)", () => {
    const s = useCircuitStore();
    expect(s.circuitEnabled).toBe(true);
  });

  it("setCircuitEnabled flips the flag both ways", () => {
    const s = useCircuitStore();
    s.setCircuitEnabled(false);
    expect(s.circuitEnabled).toBe(false);
    s.setCircuitEnabled(true);
    expect(s.circuitEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/circuitVisibility.test.ts`
Expected: FAIL — `s.circuitEnabled` is `undefined` (expected `true`), and `s.setCircuitEnabled is not a function`.

- [ ] **Step 3: Add the state field to the interface**

In `src/store/circuit.ts`, in the `CircuitState` interface, add `circuitEnabled` after `lastPrompt`:

```ts
  activeContext: any | null;
  lastPrompt: any[] | null;
  // Whether the Circuit model-installer card is shown on /settings. Persisted; default shown.
  circuitEnabled: boolean;
}
```

- [ ] **Step 4: Add the state default**

In the `state: (): CircuitState => ({ ... })` initializer, add `circuitEnabled: true` after `lastPrompt: null`:

```ts
    activeContext: null,
    lastPrompt: null,
    circuitEnabled: true
  }),
```

- [ ] **Step 5: Add the action**

In the `actions` block, add `setCircuitEnabled` after the existing `setActiveContext` action (keep the trailing structure intact):

```ts
    setActiveContext(payload: any) {
      this.activeContext = payload;
    },
    setCircuitEnabled(payload: boolean) {
      this.circuitEnabled = payload;
    }
  },
  persist: true
});
```

(Leave `persist: true` exactly as-is — it is what persists `circuitEnabled` across reloads.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/circuitVisibility.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add src/store/circuit.ts tests/circuitVisibility.test.ts
git commit -m "feat(circuit): circuitEnabled store flag + setCircuitEnabled action (persisted)"
```

---

## Task 2: Settings UI — Preferences toggle + gated Circuit card

**Files:**
- Modify: `src/views/Settings.vue` — template (Circuit card ~line 103-153, add Preferences card before it), script (`onMounted` ~line 204-206, add handler + computed, `@ionic/vue` import ~line 160)

No new unit test: this repo does not render-test `Settings.vue`; the store unit is covered in Task 1. Verify via lint + the full Vitest suite + manual check (Step 6-7).

- [ ] **Step 1: Add `IonToggle` to the `@ionic/vue` import**

In `src/views/Settings.vue`, the import on line 160 currently reads:

```ts
import { IonAvatar, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonMenuButton, IonPage, IonSelect, IonSelectOption, IonTitle, IonToolbar, modalController } from "@ionic/vue";
```

Add `IonToggle` (alphabetical, after `IonTitle`):

```ts
import { IonAvatar, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonMenuButton, IonPage, IonSelect, IonSelectOption, IonTitle, IonToggle, IonToolbar, modalController } from "@ionic/vue";
```

- [ ] **Step 2: Gate the mount-time WebGPU probe**

In `src/views/Settings.vue`, the `onMounted` block (lines 204-206) currently reads:

```ts
onMounted(() => {
  circuitStore.checkWebGPUSupport();
});
```

Replace with:

```ts
onMounted(() => {
  if (circuitStore.circuitEnabled) circuitStore.checkWebGPUSupport();
});
```

- [ ] **Step 3: Add the toggle handler**

In `src/views/Settings.vue`, add a `toggleCircuit` function next to the other functions (e.g. directly after the `unloadModel` function, ~line 233):

```ts
function toggleCircuit(event: CustomEvent) {
  const enabled = !!event.detail.checked;
  circuitStore.setCircuitEnabled(enabled);
  // When re-enabling in-session, run the WebGPU probe that onMounted skipped while hidden.
  if (enabled) circuitStore.checkWebGPUSupport();
}
```

- [ ] **Step 4: Add the Preferences card before the Circuit card**

In the template, immediately BEFORE the Circuit card (the `<ion-card>` opening at line 103 whose `<ion-card-title>Circuit</ion-card-title>` is at line 105), insert:

```html
        <ion-card>
          <ion-card-header>
            <ion-card-title>{{ translate("Preferences") }}</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            {{ translate("Show or hide the Circuit local-model card on this page.") }}
          </ion-card-content>
          <ion-item lines="none">
            <ion-toggle :checked="circuitStore.circuitEnabled" @ionChange="toggleCircuit($event)">
              {{ translate("Show Circuit") }}
            </ion-toggle>
          </ion-item>
        </ion-card>
```

- [ ] **Step 5: Wrap the Circuit card in `v-if`**

Change the Circuit card's opening tag (line 103) from:

```html
        <ion-card>
          <ion-card-header>
            <ion-card-title>Circuit</ion-card-title>
```

to:

```html
        <ion-card v-if="circuitStore.circuitEnabled">
          <ion-card-header>
            <ion-card-title>Circuit</ion-card-title>
```

(Leave the rest of the Circuit card, through its closing `</ion-card>` at line 153, unchanged.)

- [ ] **Step 6: Lint + run the full test suite**

Run: `npm run lint && npx vitest run`
Expected: lint passes with no new errors; all Vitest specs pass (including `circuitVisibility.test.ts` from Task 1).

- [ ] **Step 7: Manual verification in the running app**

Run the dev server (`npm run dev`) and open `http://localhost:8100/settings`. Confirm:
- A "Preferences" card with a "Show Circuit" toggle appears (toggle ON by default).
- The "Circuit" model card is visible while the toggle is ON.
- Toggling OFF removes the Circuit card; the toggle stays visible.
- Reload the page → the toggle state persists (Circuit stays hidden if it was turned off).

- [ ] **Step 8: Commit**

```bash
git add src/views/Settings.vue
git commit -m "feat(circuit): Settings 'Show Circuit' toggle hides the Circuit model card"
```

---

## Self-Review

- **Spec coverage:**
  - Persisted `circuitEnabled` default `true` + `setCircuitEnabled` → Task 1. ✓
  - Dedicated "Preferences" toggle, whole Circuit card hidden via `v-if` → Task 2 Steps 4-5. ✓
  - Guard `checkWebGPUSupport()` (mount + on re-enable) → Task 2 Steps 2-3. ✓
  - Test for default + flip → Task 1. ✓ (Note: persistence config `persist: true` is verified by inspection in Task 1 Step 5, not unit-asserted — `pinia-plugin-persistedstate` is not active under a bare `createPinia()`, so persistence is not unit-testable here; manual reload check covers it in Task 2 Step 7.)
  - No env-flag / router / menu changes → respected (none in plan). ✓
- **Placeholder scan:** No TBD/TODO/"handle edge cases"; all code shown. ✓
- **Type consistency:** `circuitEnabled: boolean` and `setCircuitEnabled(payload: boolean)` used identically in store, test, and Settings.vue handler. ✓
