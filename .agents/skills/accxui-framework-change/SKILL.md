---
name: accxui-framework-change
description: Use when changing or adding anything under common/ in the accxui workspace (the framework every app shares), or when moving code from an app into the framework. Triggers include a new or changed file in common/components, common/composables, common/core, common/utils, common/store, common/db, common/css or common/vite; exporting from common/index.ts or common/db/index.ts; "add this to common", "share this between apps", "both apps need it", a component copied between apps (the Dxp* Settings cards in BOPIS and Fulfillment), a breaking change to a framework function, a relative-import or circular-import problem inside common/, a framework change an app needs released (accxuiVersion), and common/tests.
---

# Changing the framework (`common/`)

`common/` is the accxui repo's framework, consumed by every app through the `@common` alias and,
for releases, pinned by tag (`accxuiVersion` in each app's release workflow). A framework change
is a **separate commit in the accxui repo** from any app change, each app being its own repo.

## Rules

1. **Ask before adding to the framework** (a new helper, component or composable, a moved app
   component, a new dependency). *Why:* every app inherits it, and the framework's surface is what
   all four apps must keep working with.
2. **Generic only.** Nothing app-specific: no app store, no app env name, no app route. What differs
   per app comes in as a parameter, prop, emit or `initialiseConfig` field.
3. **Inside `common/`, import by relative path** from the source file
   (`../utils/commonUtil`, `../core/i18n`), never `@common` or `../index`: the barrel creates
   circular imports. Never import from an app (`@/…`).
4. **Respect the worker boundary.** `common/core/workerRemoteApi.ts`, `common/db/types.ts`,
   `common/db/schema/**`, `common/db/seed/**`, `common/db/storage/**` and `common/db/sync/**` (except
   `syncService.ts` / `setupAppDbSync.ts`) run inside sync workers: no Vue, Ionic, Pinia, `commonUtil`,
   `logger`, `translate`, `cookieHelper`, `useAuth`, `configRegistry` there, not even indirectly
   (the worker-safe replacements are in **accxui-common-helpers**).
5. **Module-level state is reset on logout** with `onSessionCleared(() => …)` at module scope
   (`common/composables/useProducts.ts` is the reference), or the next user on the tab sees it.
6. **Export what apps use** from `common/index.ts` (main-thread code) or `common/db/index.ts` (db
   composables and types). Worker code reaches framework files by deep path, so a worker-safe module
   must also work imported directly.
7. **Every caller keeps working.** Before changing a signature or behaviour, grep all four apps
   (`apps/company`, `apps/order-manager`, `apps/bopis`, `apps/fulfillment`) for the export. Prefer
   adding an optional parameter to breaking one; a break needs a change in each app repo that uses it.
8. **Tests and docs move with the code**: a spec in `common/tests/`, and the skill or
   `docs/APP_DB_DEVELOPER_GUIDE.md` section that describes the API updated in the same commit.
9. **User-facing strings** in a framework component or helper go through `translate` (relative
   import). Keys live per app: add the key to the English file of every app that renders it, and to
   **Order Manager's `en-US.json` and `es-ES.json` always**, because its `tests/locales.spec.ts`
   scans all of `common/`. A missing key with a `{placeholder}` renders raw (`{count} min ago`), so list
   the keys each consuming app must add.
10. **Seed-set changes break pinned tests and need version bumps.** A new or changed seed table also
   updates `common/tests/fixtures/seedSchemaAfter.json`, the domain-name list in
   `common/tests/commonSchema.spec.ts` and the catalog length in `common/tests/defineAppDb.spec.ts`,
   and bumps the app db `version` of **every app that picks the table**, including Order Manager, which
   takes the whole `commonSchema` (a separate commit in its repo).
11. **Names in `composables/*.ts`:** every exported function there must start with `use` (root lint).
   A plain helper goes in `common/utils/`.

## Where it goes

| It is | In | Exported from |
|---|---|---|
| A pure helper (formatting, parsing, validation) | `common/utils/commonUtil.ts` (or a sibling module) | `commonUtil` / `common/index.ts` |
| A Vue component | `common/components/<Name>.vue` | `common/index.ts` (default import + named export) |
| A composable with setup-time effects | `common/composables/use<Name>.ts` | `common/index.ts`; if it reads the app db, `common/db/composables/` and `common/db/index.ts` |
| A directive | `common/directives/<name>.ts` | `common/index.ts`; apps register it in `main.ts` |
| Shared CSS | `common/css/theme.css` (global) or `settings.css` (under `.settings`) | imported by every app's `main.ts` |
| A Vite plugin | `common/vite/` | imported by path from each app's `vite.config` |
| A framework seed table / domain / lookup | `common/db/seed/*`, `useSeedData`'s `createSeedLookups` | **accxui-app-db-setup**, **accxui-seed-data** |

## Moving a component from apps into `common/`

The usual case: the same component copied into several apps (BOPIS and Fulfillment each have
`DxpFacilitySwitcher`, `DxpOmsInstanceNavigator`, `DxpProductIdentifier`, `DxpTimeZoneSwitcher`,
`DxpLanguageSwitcher`, `DxpAppVersionInfo`; Order Manager has its own `DxpAppVersionInfo` and
`DxpProductIdentifier`).

1. Diff the copies; take the most complete one as the base and list every behaviour difference.
2. Replace app-store reads with props and emits (`:facilities`, `@update:facility`), or with what
   `accxuiConfig` already carries (`current`, `oms`). The component never imports an app store.
3. Relative imports inside it; `translate` for strings; Ionic components imported from `@ionic/vue`.
4. Export it from `common/index.ts`; a spec in `common/tests/` (or beside it in `common/components/`,
   which Order Manager's suite also runs).
5. Then, per app repo, a separate change: replace the local copy with the `@common` one, wire the
   props / emits from the app's store, delete the copy, add any new `en.json` keys.

Fulfillment runs Ionic 7.6 (**accxui-apps-without-app-db**): a shared component must only use Ionic
APIs that exist in both 7 and 8.

## Checks

- `npx vitest run common/tests` from the accxui root (compare failures with a run on the unchanged
  code: a few already fail). A `.vue` component's spec sits in `common/components/` and runs with
  Order Manager's suite (**accxui-app-testing**).
- The suites of the apps that use what you changed (`pnpm test:unit` in `apps/company` and
  `apps/order-manager` at least), and `pnpm build` in each (**accxui-app-testing**).
- For worker-reachable files: `pnpm build` in Company and Order Manager (a main-thread import there
  breaks or bloats the worker chunk).
- Release order: an app that needs the change is released after accxui is tagged
  (**accxui-dependencies-and-config**).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `import { commonUtil } from "@common"` inside `common/` | circular import, `undefined` at load | `../utils/commonUtil` |
| A framework component reading `useUserStore()` | breaks in every other app | props / emits, or `accxuiConfig` |
| `commonUtil` / `logger` in `common/db/sync/*` | the sync worker breaks | worker-safe primitives |
| A module-level cache with no `onSessionCleared` | the previous tenant's data after re-login | register the reset |
| Changing a signature without grepping the apps | an app breaks at the next release | grep all four; add an optional parameter |
| Framework and app edits in one commit | impossible: separate repos | one commit per repo |
| A copy fixed in one app only | the copies drift further | move it into `common/` (ask first) |
