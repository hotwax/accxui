import { defineStore } from 'pinia';
import 'pinia-plugin-persistedstate'

// Multi-version hosting (docs/MULTI_VERSION_APP_HOSTING_DESIGN.md §4.1/§4.3): the version
// `checkLoginOptions` configured for this tenant — the source of truth for all route
// canonicalization (useAuth.ts's checkAppVersionRedirect, and the router's global guard using
// this cached value with no network call). Three distinct states, not two:
//   undefined -> never yet resolved (no checkLoginOptions answer seen this origin) - nothing to
//                enforce yet; guessing before any evidence would risk a wrong premature redirect.
//   null      -> resolved: no version configured for this tenant - unversioned URLs are canonical.
//   string    -> resolved: tenant is configured for this specific version.
//
// Deliberately a persisted Pinia store (localStorage-backed), not a cookie: cookies in this
// codebase are domain-wide (`domain=hotwax.io` in prod, cookieHelper.ts) so that a session
// carries across apps — exactly what's wanted for auth (oms/token/userId), but wrong here.
// `configuredAppVersion` needs to be scoped to ONE app, not shared across every app on the same
// parent domain — company.hotwax.io and fulfillment.hotwax.io would otherwise clobber the same
// cookie with unrelated version numbers, causing spurious mismatch detections. localStorage is
// strictly origin-scoped: shared across every *version* of one app (the same origin, which is
// what this cache needs to survive a version-to-version redirect), but isolated from every other
// app (a different origin/subdomain) — the right scope on both counts, for free.
export const useAppVersionStore = defineStore('appVersion', {
  state: () => ({
    configuredAppVersion: undefined as string | null | undefined
  }),
  getters: {
    getConfiguredAppVersion: (state) => state.configuredAppVersion,
  },
  actions: {
    setConfiguredAppVersion(version: string | null) {
      this.configuredAppVersion = version;
    }
  },
  persist: true
});
