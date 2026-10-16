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

- `common/core/workerRemoteApi.ts`, `common/db/types.ts`, `common/db/schema/**`,
  `common/db/seed/**`, `common/db/storage/**`, and `common/db/sync/**` **except** the main-thread
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
| `copyToClipboard(value, text?)` | copies and toasts "Copied" (or `translate(text)`) |

**Dates and times** (Luxon; epoch millis in, `"-"` for empty where noted)

| Call | Gives |
|---|---|
| `getDateAndTime(millis)` | localized date + 12 h time, `"-"` when empty |
| `getDateWithOrdinalSuffix(millis)` | `"5th Oct 2026"`, `"-"` when empty |
| `formatUtcDate(value, timeZone, format?)` | a UTC millis / ISO value shown in the user's zone (default `MM-dd-yyyy`), `"-"` when empty |
| `formatDateTime("yyyy-MM-dd", format?, endOfDay?)` | start (or end) of that day as `yyyy-MM-dd HH:mm:ss.SSS`, for a date-range filter |
| `parseDateTimeValue(value)` | any Moqui / OFBiz date value (millis, ISO, SQL timestamp, …) as a Luxon `DateTime`, or `null` |
| `getCurrentTime(zone, format?)` | the time now in a zone (`t ZZZZ`) |

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
| `getMaargURL()` | the Maarg REST base (`https://<instance>.hotwax.io/rest/s1/`), for `api({ baseURL: commonUtil.getMaargURL() })` |
| `getMaargBaseURL()` | the Maarg host alone (without `/rest/s1/`), for a URL you build yourself |
| `getOmsURL()` | the OMS base URL |
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

## i18n: `translate`

- **Every user-facing string**: `translate("Order cancelled")`, with values:
  `translate("{count} jobs created", { count })`. The key is the English text itself and must exist in
  the app's English file (`src/locales/en.json`; Order Manager `en-US.json`); the root `pnpm lint`
  rejects a missing key. Add the key there in the same change; other locale files may lag.
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
