---
name: accxui-auth
description: Use when AccxUI app code (any app under apps/*) or framework code in common/ (components, composables, core) deals with login, logout, the session token, route guards or per-session state. Triggers include useAuth, isAuthenticated, logout, updateUserId, clearAuth, checkAppVersionRedirect, initialiseConfig, postLogin / preLogout / postLogout, the common Login component, onSessionCleared, a router guard redirecting to /login, a user who stays on /login after a successful login, data from the previous user showing after re-login, a 401 that logs the user out, INVALID_APP_CONTEXT, "Session expired. Refreshing...", or a tab that logs out when another tab does.
---

# Auth: `useAuth`, the login hooks and session state

`useAuth()` from `@common` is a plain framework helper (not an app composable), so stores, the
router and `.vue` files may all call it. It holds one token per tab (cookies + module refs); the app
plugs in through `initialiseConfig`. The login screen is the framework's `Login` component.

**Inside `common/` itself**, import from the source file with a relative path, never `@common` or
`../index` (the barrel can create circular imports):

```ts
import { useAuth } from "../composables/useAuth";
import { onSessionCleared } from "../core/sessionScope";
import { accxuiConfig, initialiseConfig } from "../core/configRegistry";
```

## Wiring an app (once, in `main.ts`)

```ts
import { initialiseConfig, Login } from "@common";

initialiseConfig({
  postLogin: useUserStore().postLogin,      // after the token is stored
  preLogout: useUserStore().preLogout,      // optional; manual logout only, session still valid
  postLogout: useUserStore().postLogout,    // after the token is cleared
  get oms() { return useUserStore().oms },  set oms(val) { useUserStore().oms = val },
  get appVersion() { return useUserStore().appVersion }, set appVersion(val) { useUserStore().appVersion = val },
  get current() { return useUserStore().current },       set current(val) { useUserStore().current = val },
  router,
});
// router: { path: "/login", name: "Login", component: Login }
```

`initialiseConfig` replaces the whole config, so pass every field. `oms`, `appVersion` and `current`
are getters/setters onto the app's user store: the framework reads and writes them there.

## What apps use from `useAuth()`

| Member | Where apps use it |
|---|---|
| `isAuthenticated` | `ComputedRef<boolean>` (below): route guards, `App.vue` watches, menus |
| `logout()` | the Logout button (Settings). The sequence is below |
| `updateUserId(userId)` | in the user store, right after loading the profile |
| `clearAuth()` | in the user store's `postLogout`, and when a login must be undone (the app-access check) |
| `checkAppVersionRedirect()` | the router's global `beforeEach`: `if (useAuth().checkAppVersionRedirect()) return false` |

Logging in is the framework's `Login` page (`/login` route, from `@common`); app code doesn't call
`login()` or set the token itself.

## When `isAuthenticated` is true

All of: a token and an expiration exist, the expiration is in the future, **and** either the app is
embedded (Shopify) or both the `oms` cookie equals the user store's `oms` and the `userId` cookie equals
`current.userId` (the fields passed to `initialiseConfig`).

So `postLogin` must load the profile into `current` **and** call `useAuth().updateUserId(current.userId)`,
and keep `oms` in step with the `oms` cookie. Miss one and the token is valid but `isAuthenticated`
stays false: the user lands back on `/login`.

## Login and logout order

**Login:** the `Login` page signs in (credentials or SSO), stores the token, then `await postLogin()`. It runs for every
login, never for a page reload. A `postLogin` that throws
fails the login.

**Logout** (`logout()`):
1. manual logout only: loader, `await preLogout()` (errors logged), server logout (SAML gives a redirect URL)
2. the token and userId are cleared (except embedded / invalid-context logouts, which toast "Session expired. Refreshing...")
3. `await postLogout()` (errors logged)
4. every `onSessionCleared` reset runs (below)
5. keeps the `oms` cookie and `appVersion`, removes `requestedPagePath`, then redirects to `/login` (or the SAML / Shopify URL)

So: anything that needs the session (removing a push token, saving a draft to the server) goes in
`preLogout`; resetting stores and local state goes in `postLogout`.

**Automatic logouts:**
- any API response `401` → `logout({ isUserUnauthorised: true })`;
- an API call while `isAuthenticated` is false (another tab logged out or switched user, the cookie
  expired) → `logout({ isUserUnauthorised: true, invalidAppContext: true })`, `clearAuth()`, and the
  call rejects with `Error("INVALID_APP_CONTEXT")`. Don't toast that error; the logout handles it.

## Guards and reacting to auth

```ts
// router
const authGuard = () => { if (!useAuth().isAuthenticated.value) return { path: "/login" } };
// { path: "/orders", component: Orders, beforeEnter: authGuard }
router.beforeEach(() => { if (useAuth().checkAppVersionRedirect()) return false });

// App.vue: work that must run on a reload too (postLogin doesn't run on a reload)
watch(useAuth().isAuthenticated, (authenticated) => { if (authenticated) void startAppDbSync() }, { immediate: true });
```

## Session-scoped state

- **App state:** reset it in `postLogout` (`store.$reset()`, stop sync, clear caches).
- **Module-level state in `common`** (a shared composable caching tenant data): register its reset at
  module scope; `logout()` runs it after `postLogout`:

```ts
// common/composables/useSomething.ts
import { onSessionCleared } from "../core/sessionScope";
const cache = new Map<string, any>();
onSessionCleared(() => cache.clear());
```

  Every new composable in `common/` that keeps module-level data (a cache, a `ref` outside the
  function) must do this, or the next user on the same tab sees the previous user's data
  (`common/composables/useProducts.ts` is the reference).

  App code may use `onSessionCleared` the same way (imported from `@common`) for its own module-level state (Company's
  `useSecurity.ts` does).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `postLogin` doesn't call `updateUserId` (or `current` lacks `userId`) | valid token, `isAuthenticated` false, back to `/login` | set `current`, then `updateUserId(current.userId)` |
| Work that needs the session in `postLogout` | the call fails: the token is already cleared | `preLogout` |
| Starting per-session work only in `postLogin` | nothing runs after a page reload | also a `watch(isAuthenticated, …, { immediate: true })` in `App.vue` |
| Module-level cache in a shared composable with no reset | the next user sees the previous tenant's data | `onSessionCleared` |
| Toasting `INVALID_APP_CONTEXT` | a second error over the logout | ignore it |
| Calling `logout()` again on a 401 handler | double teardown | the interceptor already does it |
| Omitting fields in `initialiseConfig` | `oms` / `current` undefined, auth never true | pass every field |
| An app composable also named `useAuth` (Company's `composables/useSecurity.ts` has one for `hasPermission` / `userProfile`) | the wrong one imported | `isAuthenticated`, `login`, `logout` come from `@common` |
