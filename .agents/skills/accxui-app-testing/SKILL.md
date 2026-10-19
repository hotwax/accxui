---
name: accxui-app-testing
description: Use when writing, running or fixing tests in the accxui workspace: framework specs in common/tests, unit specs in an app's tests/ folder (apps/company, apps/order-manager, apps/bopis, apps/fulfillment or a new app), BOPIS's Playwright end-to-end tests, or deciding which checks prove a change. Triggers include vitest, vi.mock("@common"), vi.mocked(api), mount / flushPromises / enableAutoUnmount, @vue/test-utils, setActivePinia, createPinia, "@vitest-environment jsdom", tests/setup/i18n.ts, test:unit, check:wiring, appDbWiring.spec.ts, a spec that fails on an "@/" alias, "No test files found", mocking an app db or appDbSync, playwright, auth.setup, storageState, data-testid, vue-tsc, and "is this failure mine".
---

# Tests and checks in the accxui workspace

Tests are the gate that means something here (lint style and typecheck carry old noise). Each repo
runs its own suite: the framework from the accxui root, each app from its own folder.

## Which command

| Changed | Run | Notes |
|---|---|---|
| `common/` | `npx vitest run common/tests` from the accxui root | **never** bare `vitest` / `pnpm test:unit` at the root: it collects every app's specs, which fail on `@/` aliases. A few framework specs already fail; compare with a run on the unchanged code before calling one yours |
| `common/` used by an app | also that app's suite | Company's is the strongest gate (about 1,400 tests) |
| An app with an app db | `pnpm test:unit` then `pnpm build` in `apps/<app>` | `build` lints `src` and runs the wiring spec first |
| BOPIS, Fulfillment | `npx vitest run` in the app (their `test:unit` is watch mode); `pnpm build` | neither has unit specs yet; BOPIS has Playwright (below) |
| Types | `npx vue-tsc --noEmit -p tsconfig.json` in the app (Order Manager also `--ignoreDeprecations 6.0`, or it stops on the tsconfig and checks nothing) | each app has a few existing errors: diff against the run before your change |

macOS has no `timeout` command: `timeout 300 npx …` fails at once and prints nothing, which reads as
"clean". Use the tool's own timeout instead.

## Where specs go

| Code under test | Spec | Imports |
|---|---|---|
| `common/**` (`.ts`) | `common/tests/<thing>.spec.ts` | **relative** (`../db/schema/defineEntity`); `import { describe, it, expect, vi } from "vitest"`; `// @vitest-environment jsdom` on the first line when it needs the DOM |
| `common/components/*.vue` | `common/components/<Name>.spec.ts`, beside it | the accxui root has no Vue plugin, so a `.vue` can't be mounted from `common/tests`. Order Manager's config includes `../../common/components/**/*.spec.ts` (and `common/core/**`): run it with Order Manager's `pnpm test:unit` |
| An app's `src/**` | `apps/<app>/tests/<same folder as src>/<file>.spec.ts` (`tests/composables/`, `tests/store/`, `tests/utils/`, `tests/components/`, `tests/views/`, `tests/workers/`, `tests/db/`) | `@/…` and `@common` aliases |

Config per app:
- **Order Manager** (and a new app): `test` block in `vite.config` with `globals: true`,
  `environment: "jsdom"`, `include: ["tests/**/*.spec.ts", "../../common/components/**/*.spec.ts",
  "../../common/core/**/*.spec.ts"]`, `setupFiles: ["tests/setup/i18n.ts"]`
  (`createDxpI18n({ "en-US": enUS })`, so unmocked `translate` returns real English).
  `tests/locales.spec.ts` is Order Manager's **translation-key check**: every literal
  `translate("…")` key in `src/` **and in all of `common/`** must be in `en-US.json` and in
  `es-ES.json` (with the same placeholders). The ESLint key rule never checks Order Manager (it reads
  only `en.json`), so this spec is what fails on a missing key, including one a framework change adds.
- **Company**: no `test` block. Node environment, no globals: a spec imports from `vitest` and opts
  in with `// @vitest-environment jsdom`.
- **BOPIS, Fulfillment**: `test: { globals: true, environment: "jsdom" }`, no specs yet.

## Recipes

**A util** (pure: no mocks needed):

```ts
import { describe, expect, it } from "vitest";
import { groupByFacility } from "@/utils/audits";

describe("groupByFacility", () => {
  it("keeps rows without a facility in their own group", () => {
    expect(groupByFacility([{ auditId: "A1" }, { auditId: "A2", facilityId: "F1" }])).toEqual({ "": [{ auditId: "A1" }], F1: [{ auditId: "A2", facilityId: "F1" }] });
  });
});
```

**A composable or store action that calls the API:** mock `@common` with only what the code uses,
then assert the request it made.

```ts
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@common";
import { useAuditActions } from "@/composables/useAuditActions";

vi.mock("@common", () => ({
  api: vi.fn(),
  commonUtil: { hasError: (resp: any) => !!resp?.data?._ERROR_MESSAGE_ },
  logger: { error: vi.fn() },
  translate: (key: string) => key,
}));
vi.mock("@/db/appDbSync", () => ({ refreshAfterMutation: vi.fn(async () => 1) }));

beforeEach(() => vi.mocked(api).mockReset());

it("closes the audit and reconciles that one record", async () => {
  vi.mocked(api).mockResolvedValue({ data: {} } as any);
  const { refreshAfterMutation } = await import("@/db/appDbSync");

  await useAuditActions().closeAudit("A1");

  expect(vi.mocked(api).mock.lastCall?.[0]).toMatchObject({ url: "oms/audits/A1", method: "put", data: { statusId: "AUDIT_CLOSED" } });
  expect(refreshAfterMutation).toHaveBeenCalledWith("audit", { auditId: "A1" });
});
```

**A Pinia store:** a fresh pinia per test; replace the store's own fetch actions on the instance
(Order Manager `tests/store/customer.spec.ts`):

```ts
beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(useAuditStore(), { fetchAudit: vi.fn(async () => ({ auditId: "A1" })) });
});
```

**A component:** mount with real Ionic components, stub overlays, and drive it through events
(Company `tests/components/FulfillmentOrderSearch.spec.ts`):

```ts
// @vitest-environment jsdom   (Company only; Order Manager's config sets jsdom)
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { IonSearchbar } from "@ionic/vue";
enableAutoUnmount(afterEach);

const wrapper = mount(AuditSearch, {
  props: { facilityId: "F1" },
  global: { stubs: { IonModal: { props: ["isOpen"], template: "<div v-if=\"isOpen\" data-modal><slot /></div>" } } },
});
wrapper.findComponent(IonSearchbar).vm.$emit("ionInput", { detail: { value: "spring" } });
await flushPromises();
```

**Reading the app db in a component:** mock the app db module and `useLiveEntity` rather than
opening IndexedDB:

```ts
vi.mock("@/db/appDb", () => ({ appDb: { tables: new Proxy({}, { get: (_t, table) => table }) } }));
vi.mock("@common", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useLiveEntity: () => ({ records: ref([{ auditId: "A1" }]), first: ref(), count: ref(1), hydrated: ref(true), error: ref() }),
}));
```

Sync domains (`tests/workers/`) and the wiring spec (`tests/db/appDbWiring.spec.ts`) have their own
recipes in **accxui-app-db-setup** (a `defineSnapshotDomain` / `defineCursorDomain` domain needs the
registry pattern there, not an `appDb.entity` mock). A `BaseDB` builds in Node without `indexedDB` as long as nothing
calls `.open()`, so schema tests need no `fake-indexeddb`.

## What to test

- Every new util, composable action, store action and sync domain: the request it makes (url,
  method, params) and what it does with the answer, including the error and empty answers.
- A bug fix: a spec that fails before the fix.
- Components: behaviour the user sees (what an event emits, which request a search sends, the empty
  state), not markup snapshots.
- Not: ESLint rules (verify a rule by linting sample code locally; never commit a spec for one).

## BOPIS end-to-end (Playwright)

`apps/bopis/playwright.config.mjs`: tests in `playwright/tests/`, page objects in `playwright/pages/`,
one worker, a `setup` project (`auth.setup.js`) that logs in and saves `playwright/.auth/user.json`
for the `chromium` project. Environments map to **deployed** URLs in `playwright/config.js`
(credentials from `.env`), so they don't run against localhost. Run with `pnpm test:e2e` in
`apps/bopis`. Selectors use `data-testid` (**accxui-ui-conventions**, Test ids).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `npx vitest run` at the accxui root | hundreds of alias failures from every app | `npx vitest run common/tests`, or run in the app |
| `@/` imports in a `common/tests` spec | can't resolve | relative imports |
| `vi.mock("@common")` without a factory in an app spec | every export becomes `undefined`, `translate` too | a factory with what the code uses, or `importOriginal` spread |
| A Company spec using `document` without the jsdom comment | `document is not defined` | `// @vitest-environment jsdom` first line |
| A framework component spec in `common/tests` | can't compile `.vue` | `common/components/<Name>.spec.ts`, run through Order Manager |
| A new `translate` key without the Order Manager locale files | `tests/locales.spec.ts` fails, even for a key only `common/` uses | add it to `en-US.json` and `es-ES.json` |
| Reusing one pinia across tests | state leaks between tests | `setActivePinia(createPinia())` in `beforeEach` |
| Asserting on `refreshAfterMutation`'s return to check the screen | tests nothing the user sees | assert it was called with the domain and pk |
| `pnpm test:unit` in BOPIS / Fulfillment from a script | never exits (watch mode) | `npx vitest run` |
| Calling a pre-existing failure a regression | wasted time | run the suite on the unchanged code first |
