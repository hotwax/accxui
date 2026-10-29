export const VERSION = /^v\d+\.\d+\.\d+$/;
export const hostedVersions = (files) =>
  [
    ...new Set(
      files.flatMap((f) => {
        const m = f.path.match(/^\/(v\d+\.\d+\.\d+)\/index\.html$/);
        return m ? [m[1]] : [];
      }),
    ),
  ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
// Publish and replace take a comma-separated list; the other actions take one version.
export function versionList(value) {
  const list = String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!list.length || list.some((v) => !VERSION.test(v)))
    throw Error("Choose stable vX.Y.Z releases.");
  if (new Set(list).size !== list.length)
    throw Error("Each version can be listed only once.");
  return list;
}
export function planChange({
  action,
  version,
  environment,
  defaultVersion,
  targetDefault,
  hosted,
  releases,
  buildCapable,
}) {
  if (!["publish", "default", "remove", "rebuild", "replace"].includes(action))
    throw Error("Unknown operation.");
  if (!["uat", "prod"].includes(environment))
    throw Error("Choose UAT or Production.");
  const versions = ["publish", "replace"].includes(action)
    ? versionList(version)
    : null;
  if (!versions && action !== "rebuild" && !VERSION.test(version || ""))
    throw Error("Choose a stable vX.Y.Z release.");
  if (action !== "remove" && !buildCapable)
    throw Error("This app does not yet support versioned AccxUI builds.");
  const published = new Set(
    releases.filter((r) => !r.draft && !r.prerelease).map((r) => r.tag_name),
  );
  if (versions?.some((v) => !published.has(v)))
    throw Error("Only published stable GitHub releases can be deployed.");
  let retained = [...hosted];
  let build = [],
    removed = [],
    replaced = [],
    nextDefault = defaultVersion;
  if (action === "publish") {
    // Listed versions that are already hosted are rebuilt in place; root and unlisted versions stay.
    build = versions;
    replaced = versions.filter((v) => hosted.includes(v));
    retained.push(...versions.filter((v) => !hosted.includes(v)));
  }
  if (action === "replace") {
    // The site becomes exactly these versions with targetDefault at root; everything else is removed.
    if (!versions.includes(targetDefault))
      throw Error("The Default must be one of the listed versions.");
    build = versions;
    replaced = versions.filter((v) => hosted.includes(v));
    removed = hosted.filter((v) => !versions.includes(v));
    retained = [...versions];
    nextDefault = targetDefault;
  }
  if (action === "default") {
    if (!hosted.includes(version))
      throw Error("Publish this version before making it Default.");
    if (!defaultVersion)
      throw Error(
        "Current Default is unverified. Verify its release before replacing it.",
      );
    if (!hosted.includes(defaultVersion))
      throw Error(
        "Publish the current Default as a version first so rollback remains available.",
      );
    if (version === defaultVersion) throw Error("This is already the Default.");
    if (!published.has(version))
      throw Error("The selected release is no longer published on GitHub.");
    build = [version];
    nextDefault = version;
  }
  if (action === "remove") {
    if (!hosted.includes(version)) throw Error("This version is not hosted.");
    if (!defaultVersion)
      throw Error("Cannot remove a version while Default is unverified.");
    if (version === defaultVersion)
      throw Error("Choose a different Default before removing this version.");
    retained.splice(retained.indexOf(version), 1);
    removed = [version];
  }
  if (action === "rebuild") {
    if (!defaultVersion || !VERSION.test(defaultVersion))
      throw Error("Verify the current Default before rebuilding.");
    build = [...new Set([defaultVersion, ...hosted])];
    if (build.some((v) => !published.has(v)))
      throw Error(
        "Every hosted version and Default must still have a published GitHub release to rebuild.",
      );
    if (!hosted.includes(defaultVersion)) retained.push(defaultVersion);
    replaced = [...retained];
  }
  return {
    action,
    environment,
    version: version || null,
    targetDefault: action === "replace" ? targetDefault : null,
    build,
    added: build.filter((v) => !hosted.includes(v)),
    replaced,
    removed,
    retained,
    previousDefault: defaultVersion,
    nextDefault,
    rootChanges: ["default", "rebuild", "replace"].includes(action),
    confirmation:
      action === "remove"
        ? `REMOVE ${version}`
        : environment === "prod"
          ? "PUBLISH TO PRODUCTION"
          : action === "replace" && removed.length
            ? `REPLACE ${environment.toUpperCase()} SITE`
            : null,
  };
}
const versionPattern = (v) => `^/${v.replaceAll(".", "\\.")}(?:/.*)?$`;
const isVersionRule = (h) =>
  typeof h.regex === "string" && /^\^\/v[^/]+\(\?:\/\.\*\)\?\$$/.test(h.regex);
export function configFor(plan, config) {
  const next = structuredClone(config || {});
  // Retain unrelated routing/security rules; remove rules aimed at deleted directories.
  for (const v of plan.removed || []) {
    const prefix = `/${v}/`;
    next.rewrites = (next.rewrites || []).filter(
      (r) => !String(r.path || "").startsWith(prefix),
    );
    next.redirects = (next.redirects || []).filter(
      (r) => !String(r.location || "").startsWith(prefix),
    );
    next.headers = (next.headers || []).filter(
      (h) => h.regex !== versionPattern(v),
    );
  }
  if (["publish", "replace"].includes(plan.action)) {
    // Newly added versions get their routes; already-hosted ones keep the routes they have.
    const added = plan.added || [];
    next.rewrites = [
      ...added.map((v) => ({ regex: versionPattern(v), path: `/${v}/index.html` })),
      ...(next.rewrites || []),
    ];
    next.headers = [
      ...added.map((v) => ({
        regex: versionPattern(v),
        headers: { "Cache-Control": "no-cache" },
      })),
      ...(next.headers || []),
    ];
  }
  // Company reads the version manifest cross-origin and must never get a cached copy.
  if (!(next.headers || []).some((h) => JSON.stringify(h).includes("hosted-versions.json")))
    next.headers = [
      ...(next.headers || []),
      {
        glob: "/hosted-versions.json",
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      },
    ];
  if (plan.action === "rebuild") {
    next.rewrites = [
      ...plan.retained.map((v) => ({
        regex: `^/${v.replaceAll(".", "\\.")}(?:/.*)?$`,
        path: `/${v}/index.html`,
      })),
      ...(next.rewrites || []),
    ];
  }
  // Version cache rules go first, so later rules (the immutable `**/assets/**` cache) still win for
  // the version's files. Every operation reorders them, which also repairs rules written after.
  const headers = next.headers || [];
  next.headers = [
    ...headers.filter(isVersionRule),
    ...headers.filter((h) => !isVersionRule(h)),
  ];
  return next;
}
export function verifyFileChanges(before, after, plan, uploads) {
  const actual = new Map(after.map((f) => [f.path, f]));
  for (const old of before) {
    if (plan.removed.some((v) => old.path.startsWith(`/${v}/`))) {
      if (actual.has(old.path))
        throw Error(`Removed path is still hosted: ${old.path}`);
      continue;
    }
    if (
      (plan.replaced || []).some((v) => old.path.startsWith(`/${v}/`)) &&
      !uploads.has(old.path)
    ) {
      if (actual.has(old.path))
        throw Error(`Stale rebuilt file remains: ${old.path}`);
      continue;
    }
    if (!uploads.has(old.path) && actual.get(old.path)?.hash !== old.hash)
      throw Error(`Preserved file changed: ${old.path}`);
  }
  for (const [file, digest] of uploads)
    if (actual.get(file)?.hash !== digest)
      throw Error(`Built file was not verified: ${file}`);
  const original = new Set(before.map((f) => f.path));
  for (const f of after)
    if (!original.has(f.path) && !uploads.has(f.path))
      throw Error(`Unexpected file: ${f.path}`);
}
