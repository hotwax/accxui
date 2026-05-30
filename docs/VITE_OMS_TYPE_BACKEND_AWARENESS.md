# VITE_OMS_TYPE — Backend Type Awareness

## Overview

accxUI PWA apps currently assume OFBiz as their OMS backend. The URL builder in
`@common/utils/commonUtil.ts` always appends `/api/` to produce the OMS URL.

When an app is deployed against Moqui instead of OFBiz, the login call goes to
`https://{subdomain}.hotwax.io/api/` — which does not exist on Moqui — and the app
fails to authenticate.

This document specifies a build-time env var `VITE_OMS_TYPE` that tells the URL
builder which backend type the app is talking to. The user experience is unchanged:
they type the same subdomain in the login form. The URL constructed is correct for
the backend they are connecting to.

---

## Why build-time, not runtime

Each deployed instance of an accxUI app connects to exactly one backend type. This is
a deployment decision, not a user decision. Runtime detection would require an
additional probe request on every login and add complexity for something that is fixed
per deployment.

A build-time flag is set once in the app's `.env` file and compiled in. Zero runtime
cost, zero ambiguity.

---

## The env var

```env
# .env.example
VITE_OMS_TYPE=moqui    # Moqui backend — uses /rest/s1/admin/ paths
# VITE_OMS_TYPE=ofbiz  # OFBiz backend — default, uses /api/ paths (unset = OFBiz)
```

**Default (unset):** OFBiz behavior. All existing apps are unaffected.

---

## Changes required in `@common`

### 1. `common/utils/commonUtil.ts` — `getOmsURL()`

Branch on `import.meta.env.VITE_OMS_TYPE` when building the OMS URL from a
plain subdomain or hostname:

```typescript
const getOmsURL = () => {
  const oms = getEmbeddedAppStoreSafe().oms || cookieHelper().get("oms")
  const isMoqui = import.meta.env.VITE_OMS_TYPE === 'moqui'
  let omsURL = ""
  if (oms) {
    if (oms.startsWith('http')) {
      // Full URL already provided — use as-is if it contains a known path,
      // otherwise append the correct path for the backend type
      omsURL = (oms.includes('/api') || oms.includes('/rest/'))
        ? oms
        : isMoqui ? `${oms}/rest/s1/admin/` : `${oms}/api/`
    } else {
      // Plain subdomain — build the full URL for the correct backend
      omsURL = isMoqui
        ? `https://${oms}.hotwax.io/rest/s1/admin/`
        : `https://${oms}.hotwax.io/api/`
    }
    if (omsURL && !omsURL.endsWith('/')) omsURL += '/'
  }
  return omsURL
}
```

**Behavior matrix:**

| Input | `VITE_OMS_TYPE` | Output |
|-------|----------------|--------|
| `"demo"` | unset | `https://demo.hotwax.io/api/` |
| `"demo"` | `moqui` | `https://demo.hotwax.io/rest/s1/admin/` |
| `"https://demo.hotwax.io"` | unset | `https://demo.hotwax.io/api/` |
| `"https://demo.hotwax.io"` | `moqui` | `https://demo.hotwax.io/rest/s1/admin/` |
| `"https://demo.hotwax.io/rest/s1/admin/"` | any | `https://demo.hotwax.io/rest/s1/admin/` |
| `"https://demo.hotwax.io/api/"` | any | `https://demo.hotwax.io/api/` |

### 2. `common/composables/useAuth.ts` — `fetchLoginOptions()`

The current code unconditionally sets the `maarg` cookie from `resp.data.maargInstanceUrl`.
In the OFBiz architecture, OFBiz's `checkLoginOptions` response tells the PWA where the
Moqui (maarg) instance is — they are different servers.

In a Moqui-only deployment, Moqui IS the maarg server. The `checkLoginOptions` response
does not contain `maargInstanceUrl` because there is no second server to discover. The
current code sets the `maarg` cookie to the string `"undefined"`, causing all post-login
data calls to fail.

**Fix:** Guard the cookie set. When `VITE_OMS_TYPE=moqui` and `maargInstanceUrl` is
absent, use the same subdomain the user entered — it is the maarg subdomain:

```typescript
// Current (broken when maargInstanceUrl is absent):
cookieHelper().set("maarg", resp.data.maargInstanceUrl, getDuration())

// Replace with:
if (resp.data.maargInstanceUrl) {
  // OFBiz case: a separate Moqui instance URL is provided
  cookieHelper().set("maarg", resp.data.maargInstanceUrl, getDuration())
} else if (import.meta.env.VITE_OMS_TYPE === 'moqui') {
  // Moqui-only case: the OMS IS the maarg — same subdomain
  cookieHelper().set("maarg", cookieHelper().get("oms"), getDuration())
}
```

**Why `cookieHelper().get("oms")` works:**
The `oms` cookie holds the raw subdomain the user typed (e.g. `"demo"`). `getMaargURL()`
reads the `maarg` cookie and constructs `https://demo.hotwax.io/rest/s1/` from it — the
correct Moqui REST base URL for all `admin/*` data calls.

---

## Full login flow after this change (Moqui deployment)

```
User types "demo" in OMS field
         ↓
setOms() → oms cookie = "demo"
         ↓
getOmsURL("demo") — VITE_OMS_TYPE=moqui
  → https://demo.hotwax.io/rest/s1/admin/
         ↓
GET https://demo.hotwax.io/rest/s1/admin/checkLoginOptions
  → { loginAuthType: "BASIC" }   (no maargInstanceUrl — Moqui-only)
         ↓
fetchLoginOptions() fallback:
  maarg cookie = "demo"
  getMaargURL("demo") = https://demo.hotwax.io/rest/s1/
         ↓
POST https://demo.hotwax.io/rest/s1/admin/login   { username, password }
  → { token, expirationTime, api_key }
         ↓
GET https://demo.hotwax.io/rest/s1/admin/user/permissions
  → { docs: [{ permissionId: "COMPANY_APP_VIEW" }], count: 1 }
         ↓
GET https://demo.hotwax.io/rest/s1/admin/user/profile
GET https://demo.hotwax.io/rest/s1/admin/productStores
  ... (all admin/* calls use getMaargURL() base = /rest/s1/)
```

---

## Impact on each app during migration

| App state | `VITE_OMS_TYPE` | Behavior |
|-----------|----------------|----------|
| Not yet migrated (OFBiz) | unset | Unchanged — OFBiz `/api/` path |
| Migrated to Moqui | `moqui` | Moqui `/rest/s1/admin/` path |
| In-flight migration | set per deployment | Each instance picks its backend |

No changes to existing OFBiz-connected apps are required. Backward compatibility is
fully preserved.

---

## What each app needs to do when migrating

1. Set `VITE_OMS_TYPE=moqui` in the app's `.env` / deployment config
2. Update `fetchPermissions()` to call the correct Moqui endpoint:
   - From: `POST ${getOmsURL()}/getPermissions`
   - To: `GET ${getMaargURL()}/admin/user/permissions`
   
   The response shape is identical — `{ docs: [{ permissionId }], count }`.

3. Update `useAuth().logout()` call to use `POST` (Moqui's logout endpoint is POST,
   not GET as in OFBiz).

These are app-level changes. The `@common` changes in this document are the shared
foundation that makes them possible.

---

## Relation to authentication flow

For the full accxUI authentication flow against Moqui, see
[AUTHENTICATION_LOGIN_FLOW.md](./AUTHENTICATION_LOGIN_FLOW.md).

The Moqui-side endpoints (`checkLoginOptions`, `login`, `logout`, `user/permissions`)
are documented in the `hotwax-maarg-util` component.
