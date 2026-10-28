---
name: accxui-common-helpers
description: Use when AccxUI app code (any app under apps/*) or framework code in common/ (components, composables, main-thread core; worker-reachable common/db and common/core/workerRemoteApi have their own rules here) shows a toast or loader, checks an API response for an error, logs, translates a user-facing string, switches the language, formats a date / time / phone number / currency, shows a status color or product identifier, copies to the clipboard, validates an email or password, works with a cron expression, needs the OMS instance name or the OMS / Maarg URL, or is about to write a small generic helper. Triggers include commonUtil, showToast, hasError, getProductIdentificationValue, getFeatures, getStatusColor, getOMSInstanceName, getOmsURL / getMaargURL, isMoqui, logger, console.log, translate, en.json, locales, createDxpI18n, i18n.global.locale, emitter, presentLoader / dismissLoader, cookieHelper.
---

# Framework helpers: `commonUtil`, `logger`, `translate`, `emitter`

In app code, import from `@common` (worker code under `src/db` / `src/workers` never imports `@common`). Before writing a helper, check this list: the apps already use these. A
generic helper that isn't here goes into `common/` (a framework commit, after asking), not into one
app's `utils`.

**Inside `common/` itself** (a component, composable or core module that needs one of these helpers),
import from the source file with a relative path, never `@common` or `../index` (the barrel can create
circular imports):

```ts
import { commonUtil } from "../utils/commonUtil";
import logger from "../core/logger";
import { translate } from "../core/i18n";
import emitter from "../core/emitter";
import { cookieHelper } from "../helpers/cookieHelper";
```

**Worker-reachable framework modules are excluded from this.** These run inside a sync worker, so
importing a main-thread helper there pulls Vue, Ionic, Pinia or DOM-only code into the worker and
breaks it (`cookieHelper` reads `document.cookie`; `commonUtil` imports `@ionic/vue`, the i18n
module and a Pinia store; `logger` and `translate` are Vue plugins):

- `common/core/workerRemoteApi.ts`, `common/db/types.ts`, `common/db/model/**`,
  `common/db/schema/**`, `common/db/domain/**`, `common/db/storage/**`, and `common/db/sync/**` **except** the main-thread
  `syncService.ts` and `setupAppDbSync.ts`, plus anything these import.

In those files never import `commonUtil`, `cookieHelper`, `translate` / `../core/i18n`, `logger`,
`emitter`, `useAuth`, `configRegistry`, a composable, a store, `vue` or `@ionic/vue` (a `type`-only
import is fine; it is erased). Use the worker-safe primitives instead:

| Need | Worker-safe way |
|---|---|
| Logging | `console.warn` / `console.error` with a `[db]` or module prefix, as `baseDb.ts`, `defineSnapshotDomain.ts` and `workerRemoteApi.ts` do. Pass a value that may hold a token or response body through `sanitizeForLog` from `core/logRedaction.ts` (its `vue-logger-plugin` import is type-only) |
| OMS instance, Maarg URL, token | read them from the `SyncContext` (`ctx.omsInstance`, `ctx.maargUrl`, `ctx.token`) and call `workerGet` / `workerPost` / `pageAll` / `pageNewestFirst`, which build the URL. Never `getOMSInstanceName()`, `getMaargURL()` or a cookie. A new value the worker needs is computed on the main thread in `syncService.ts`, added to the start payload and read into `ctx` in `pollingWorkerHarness.ts` |
| A user-facing message | no `translate`: return English text or a code, and translate it on the main thread where it is shown |
| Dates and other formatting | the plain library (`luxon`) directly, not a `commonUtil` wrapper |

Before committing a change there, check the file's imports (and any new import's own imports) against
this list.

A new generic helper needed by framework code goes straight into `common/utils/commonUtil.ts` (or the
matching `common/` module) and is exported from `common/index.ts` if apps should use it too.

## `commonUtil`: what the apps use

**API responses and messages**

| Call | Use |
|---|---|
| `hasError(resp)` | after every `api()` call: `true` when the body carries `_ERROR_MESSAGE_`, `_ERROR_MESSAGE_LIST_` or `error` (an error body can come with HTTP 200) |
| `showToast(message, { position?, icon?, canDismiss?, manualDismiss?, buttons? })` | every user message; pass a `translate(...)`d string. 3 s by default; `manualDismiss` keeps it open |
| The message to show for a failed call | **no framework helper**. Throw or toast a fixed `translate("Failed to …")` string; a server message, when you show one, is `err?.response?.data?.errorMessage` / `_ERROR_MESSAGE_` read inline. Company's `getResponseErrorMessage` (`apps/company/src/utils/index.ts`) and Order Manager's `assertSuccessfulPayload` (`utils/returns.ts`) are app-local: use them only in that app |
| `copyToClipboard(value, text?)` | copies and toasts "Copied" (or `translate(text)`) |

**Dates and times** (Luxon; epoch millis in, `"-"` for empty where noted). The helpers without a
`timeZone` argument format in Luxon's `Settings.defaultZone`, which the user store sets from the
profile and must set again when the user switches time zone (Company and Order Manager do;
Fulfillment's `setUserTimeZone` doesn't, so pass the zone explicitly there with `formatUtcDate`).

| Call | Gives |
|---|---|
| `getDateAndTime(millis)` | localized date + 12 h time, `"-"` when empty |
| `getDateWithOrdinalSuffix(millis)` | `"5th Oct 2026"`, `"-"` when empty |
| `formatUtcDate(value, timeZone, format?)` | a UTC millis / ISO value shown in the user's zone (default `MM-dd-yyyy`), `"-"` when empty |
| `formatDateTime("yyyy-MM-dd", format?, endOfDay?)` | start (or end) of that day as `yyyy-MM-dd HH:mm:ss.SSS`, for a date-range filter |
| `parseDateTimeValue(value)` | any Moqui / OFBiz date value (millis, ISO, SQL timestamp, …) as a Luxon `DateTime`, or `null` |
| `getCurrentTime(zone, format?)` | the time now in a zone (`t ZZZZ`) |
| `getRelativeTime(millis)` | Luxon's `toRelative()` ("3 minutes ago"), in Luxon's locale, not the app's messages; reads the clock itself |

**Cron** (scheduled jobs): `getCronString(expr)` (human text), `getNextExecutionTime(expr, timeZone?)`,
`parseCronExpression(expr, timeZone?)`.

**Display**

| Call | Gives |
|---|---|
| `getStatusColor(statusId)` | the Ionic color for a status (`"medium"` when unknown); use it for status badges, never a hardcoded color |
| `getColorByDesc(description)` | the color for a status *description* (BOPIS) |
| `getProductIdentificationValue(identifierTypeId, product)` | the product's value for the user's chosen identifier (SKU, UPCA, …), reading `goodIdentifications`; `undefined` until the product is loaded |
| `getFeatures(productFeatures)` / `getFeature(productFeatures, "Color")` | all feature values as one string / one feature's value |
| `formatCurrency(amount, currencyUomId)` | symbol + amount to 2 decimals |
| `formatPhoneNumber(countryCode, areaCode, number)` / `getTelecomCountryCode(code)` | `+1-555-1234567` / the dialing code |

**Validation and ids**: `isValidEmail(email)`, `isValidPassword(password)` (5+ chars with a letter, a
digit and a symbol), `generateInternalId(name)` (`"My Store"` → `"MY_STORE"`).

**Session and environment**

| Call | Gives |
|---|---|
| `getOMSInstanceName()` | the OMS instance name (`demo` from `demo.hotwax.io`), e.g. for topic names or per-instance keys |
| `getMaargURL()` | the Maarg REST base (`https://<instance>.hotwax.io/rest/s1/`). It is already `api()`'s default `baseURL`: don't pass it (**accxui-app-layers**) |
| `getMaargBaseURL()` | the Maarg host alone (without `/rest/s1/`), for a URL you build yourself |
| `getOmsURL()` | the OMS base URL (`…/api/`, or `…/rest/s1/` on Moqui): pass it as `baseURL` for OFBiz service calls |
| `isMoqui()` | the OMS is Moqui-only (no OFBiz) |
| `isAppEmbedded()` | running inside Shopify (**accxui-shopify-embedded**) |
| `goToOms()` | opens the OMS in a new tab, signed in |
| `hasWebcamAccess()` | a camera is available (web scanner) |

## `logger`

- `logger.error(...)` in every `catch` that doesn't rethrow; `logger.warn(...)` for a handled but
  unexpected state; `logger.info` / `logger.debug` rarely. **Never `console.*`** in app code or main-thread `common/` code (worker-reachable modules are the exception, above).
- It redacts tokens and passwords before printing, so logging an axios error is safe.
- Installed once in `main.ts`: `.use(logger, { level: import.meta.env.VITE_DEFAULT_LOG_LEVEL })`; it
  also catches uncaught Vue errors.
- **On-device logs:** always on, nothing to configure. The logger keeps every logged line in IndexedDB
  (`app-logs`), already redacted, newest 2000 only, each cut at 10,000 characters. Only levels at or above
  `level` are kept. Unhandled promise rejections and window errors are logged (and so kept) as `error` too. Show them with the framework
  modal, never an app copy (it loads on first open, so it costs nothing at startup):
  `modalController.create({ component: DxpLogsModal })`. It takes its title and environment from
  `VITE_APP_VERSION_CONFIG` (`appId` → "BOPIS logs", `environmentTypeId` on its own header line), so there is
  nothing to pass.
  The framework `Login` page always shows a "View logs" button in its top-right corner, so a user who
  cannot sign in can still see why. Each line also keeps the OMS and username as
  the `oms` / `userId` cookies hold them when it is written (`userId` only exists while logged in), which the
  modal shows as a medium and a primary badge beside the level. Copy takes the rows on screen; the
  download button saves every stored entry, oldest first, as a `.txt` named from the `appId` (browser
  download via `file-saver`, so PWA and web only, not a Capacitor shell). `logStore.readLogs(limit)` /
  `logStore.readAllLogs()` / `logStore.clearLogs()` are there for anything else. The strings (`View logs`,
  `Logs`, `All`, `Errors`, `Clear logs`, `Clear`, `Copy these logs`, `Logs copied to the clipboard.`,
  `Download logs`, `Logs could not be downloaded.`, `No logs recorded yet.`,
  `This removes every stored log entry on this device.`) go in the app's `en.json`.

## Shipping logs off the device: `faroUtil`

- Opt-in per environment: without `VITE_FARO_COLLECTOR_URL` nothing starts and nothing is sent.
  Add the key (empty) to the app's `.env.example`.
- Two lines in `main.ts`, before `createApp`, and the hook on the logger install:
  ```ts
  faroUtil.initialiseFaro()
  // ...
  .use(logger, { level: import.meta.env.VITE_DEFAULT_LOG_LEVEL, afterHooks: [faroUtil.faroLoggerHook] })
  ```
  It is an **after** hook, so everything shipped has already been through `RedactSensitiveDataHook`:
  a bearer token never leaves the device. The on-device store runs after it either way, so the logs
  modal keeps working whether or not a collector is configured.
- **The app does not pass the user.** `faroUtil` reads it from `accxuiConfig` — the context the app
  already gives `initialiseConfig` — as a Faro meta *getter*, re-read on every capture, so login,
  logout and OMS switches are picked up with nothing to re-set. `current.userId` / `userLoginId` /
  `userFullName` and `oms` go out with every log, exception and event, plus the Maarg instance from
  `commonUtil.getMaargBaseURL()`.
- `initialiseFaro({ appName, collectorUrl, getContext })` — all optional. `appName` defaults to the
  `appId` in `VITE_APP_VERSION_CONFIG`. `getContext` is for state the framework cannot see (Company's
  Maarg instance name and purpose): it is called on every capture and its values are merged into
  `user.attributes`, empty ones dropped. It must never be an app store read from a util — pass a
  getter the page or composable owns.

## i18n: `translate`

- **Every user-facing string**: `translate("Order cancelled")`, with values:
  `translate("{count} jobs created", { count })`. The key is the English text itself and must exist in
  the app's English file (`src/locales/en.json`; Order Manager `en-US.json`). Add it in the same
  change. Follow the app's existing key convention (Fulfillment's `en.json` often keys a message
  without its placeholder and puts `{count}` only in the value).
- **What checks keys:** the root ESLint rule `local/i18n-check-keys` only reads a file named
  `src/locales/en.json` and only sees `translate("…")` **in script code**, not in `<template>`; it
  never checks Order Manager (`en-US.json`) or `common/` (no locale file). Order Manager's
  `tests/locales.spec.ts` checks every key in its `src/` and all of `common/`, in `en-US.json` **and**
  `es-ES.json`. Elsewhere other locale files may lag. A missing key shows the key text; one with a
  `{placeholder}` shows the placeholder raw.
- Strings in toasts, alerts, buttons, labels, placeholders and empty states all go through it.
- Setup (once): `main.ts` `const i18n = createDxpI18n(localeMessages)` (from `src/locales/index.ts`,
  which maps locale codes to the JSON files) and `.use(i18n)`.
- Switch language: `i18n.global.locale.value = "es-ES"` (BOPIS, Order Manager), and save the choice
  with the user's preferences.

## `emitter`: the global loader

```ts
emitter.emit("presentLoader", { message: translate("Saving…"), backdropDismiss: false });   // options optional
try {
  await save();
} finally {
  emitter.emit("dismissLoader");
}
```

`App.vue` listens (`emitter.on("presentLoader", …)` / `dismissLoader`) and removes the listeners in
`onUnmounted` with `emitter.off`. Always dismiss in `finally`. Prefer an inline spinner for a part of a
page; the global loader blocks the whole screen.

## `cookieHelper`

Apps only **read** a cookie for display or a startup choice: `cookieHelper().get("oms")` (the instance
shown on Settings), `cookieHelper().get("locale")`. Never set or remove auth cookies: the session is
`useAuth`'s (**accxui-auth**).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| Checking only `resp.status === 200` | an error body passes as success | `commonUtil.hasError(resp)` |
| A hardcoded string in the template or toast | untranslated, and the key lint fails | `translate(...)` + a key in `en.json` |
| `console.log` / `console.error` | unredacted, ignores the log level | `logger` |
| Own Luxon formatting for a date shown in a list | inconsistent formats across screens | the date helper above that fits |
| A hardcoded color on a status badge | colors drift between screens | `getStatusColor(statusId)` |
| `presentLoader` without `dismissLoader` in `finally` | the screen stays blocked after an error | dismiss in `finally` |
| A new generic helper in one app's `utils` | duplicated across apps | ask, then add to `common/` |
