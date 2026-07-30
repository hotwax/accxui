// Pure, URL-based version canonicalization — no store/router/Vue dependency, so it's unit-testable
// and shared by both the router guard and useAuth's fetchAppVersion.
//
// A versioned path looks like `/vX.Y.Z/<rest>` (e.g. `/v5.0.0/tabs/orders`); the first path segment
// IS the version string. `/<rest>` (first segment not version-shaped) is an unversioned path.

const VERSION_SEGMENT_PATTERN = /^v\d+\.\d+\.\d+$/;

export interface VersionedPathInfo {
  version: string | null;
  rest: string;
}

// Split a pathname into its leading version segment (or null) and the remainder.
export const getVersionedPathInfo = (pathname: string): VersionedPathInfo => {
  const match = pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (!match || !VERSION_SEGMENT_PATTERN.test(match[1])) {
    return { version: null, rest: pathname || "/" };
  }
  return { version: match[1], rest: match[2] || "/" };
};

// Given the version configured for this deployment (`""` = none) and the current pathname, return
// the path the app should actually be on, or `null` if it's already canonical (nothing to do):
//   - none    + versioned URL        -> strip the version (run at root)
//   - vX.Y.Z  + unversioned/other    -> add or switch to vX.Y.Z (also corrects an invalid version)
//   - already correct                -> null
// Only the version prefix changes; the caller preserves query/hash.
export const getCanonicalPath = (configuredVersion: string, pathname: string): string | null => {
  const { version: currentVersion, rest } = getVersionedPathInfo(pathname);
  const desired = configuredVersion || null;
  if (desired === currentVersion) return null;
  return desired ? `/${desired}${rest}` : rest;
};
