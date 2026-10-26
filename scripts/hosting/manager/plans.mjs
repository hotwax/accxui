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
export function planChange({
  action,
  version,
  environment,
  defaultVersion,
  hosted,
  releases,
  buildCapable,
}) {
  if (!["publish", "default", "remove", "rebuild"].includes(action))
    throw Error("Unknown operation.");
  if (!["uat", "prod"].includes(environment))
    throw Error("Choose UAT or Production.");
  if (action !== "rebuild" && !VERSION.test(version || ""))
    throw Error("Choose a stable vX.Y.Z release.");
  if (action !== "remove" && !buildCapable)
    throw Error("This app does not yet support versioned AccxUI builds.");
  const published = new Set(
    releases.filter((r) => !r.draft && !r.prerelease).map((r) => r.tag_name),
  );
  const retained = [...hosted];
  let build = [],
    removed = [],
    nextDefault = defaultVersion;
  if (action === "publish") {
    if (!published.has(version))
      throw Error("Only a published stable GitHub release can be deployed.");
    if (hosted.includes(version))
      throw Error(
        "This version is already hosted. Use Rebuild all to rebuild it.",
      );
    retained.push(version);
    build = [version];
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
  }
  return {
    action,
    environment,
    version: version || null,
    build,
    removed,
    retained,
    previousDefault: defaultVersion,
    nextDefault,
    rootChanges: ["default", "rebuild"].includes(action),
    confirmation:
      action === "remove"
        ? `REMOVE ${version}`
        : environment === "prod"
          ? "PUBLISH TO PRODUCTION"
          : null,
  };
}
export function configFor(plan, config) {
  const next = structuredClone(config || {});
  if (plan.action === "remove") {
    // Retain unrelated routing/security rules; remove rules aimed at the deleted directory.
    const prefix = `/${plan.version}/`;
    next.rewrites = (next.rewrites || []).filter(
      (r) => !String(r.path || "").startsWith(prefix),
    );
    next.redirects = (next.redirects || []).filter(
      (r) => !String(r.location || "").startsWith(prefix),
    );
  }
  if (plan.action === "publish") {
    next.rewrites = [
      {
        regex: `^/${plan.version.replaceAll(".", "\\.")}(?:/.*)?$`,
        path: `/${plan.version}/index.html`,
      },
      ...(next.rewrites || []),
    ];
    next.headers = [
      ...(next.headers || []),
      {
        regex: `^/${plan.version.replaceAll(".", "\\.")}(?:/.*)?$`,
        headers: { "Cache-Control": "no-cache" },
      },
    ];
  }
  if (plan.action === "rebuild") {
    next.rewrites = [
      ...plan.retained.map((v) => ({
        regex: `^/${v.replaceAll(".", "\\.")}(?:/.*)?$`,
        path: `/${v}/index.html`,
      })),
      ...(next.rewrites || []),
    ];
  }
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
      plan.action === "rebuild" &&
      plan.retained.some((v) => old.path.startsWith(`/${v}/`)) &&
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
