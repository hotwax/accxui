// Multi-version hosting (docs/MULTI_VERSION_APP_HOSTING_DESIGN.md §4.1/§4.3).
//
// Pure, URL-based canonicalization: given the version configured for a tenant (or null, meaning
// "no pin — unversioned is canonical") and the current path, decide what path this tenant should
// actually be on. Deliberately independent of which bundle happens to be running — it reasons
// about the URL alone, so it's identical whether called from a fresh `checkLoginOptions`
// response or a cached value.
//
// URL shape: `/vX.Y.Z/<rest>` (e.g. `/v2.4.0/product-store`) for a versioned path, `/<rest>` for
// an unversioned one — the first path segment IS the version string (matching VITE_APP_VERSION,
// RETAINED_VERSIONS, checkLoginOptions' `appVersion`, all "vX.Y.Z"-shaped). This ties "is this
// path versioned" to that naming convention being followed everywhere — a manual-discipline item
// (docs §4.4/§8), not something enforced elsewhere in this design.

const VERSION_SEGMENT_PATTERN = /^v\d+\.\d+\.\d+$/;

export interface VersionedPathInfo {
  version: string | null;
  rest: string;
}

export const getVersionedPathInfo = (pathname: string): VersionedPathInfo => {
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (!match || !VERSION_SEGMENT_PATTERN.test(match[1])) {
    return { version: null, rest: pathname || '/' };
  }
  return { version: match[1], rest: match[2] || '/' };
};

// Returns the canonical path for `configuredVersion` given the `pathname` the tenant is
// currently on, or `null` if `pathname` is already canonical (nothing to redirect).
export const getCanonicalPath = (configuredVersion: string | null, pathname: string): string | null => {
  const { version: currentVersion, rest } = getVersionedPathInfo(pathname);

  if (configuredVersion === currentVersion) {
    return null; // both null (unversioned canonical), or both the same version — already correct
  }

  return configuredVersion ? `/${configuredVersion}${rest}` : rest;
};
