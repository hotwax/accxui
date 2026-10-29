import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolveTarget } from "./catalog.mjs";
import { repoFile, githubPages, snapshot, fingerprint } from "./providers.mjs";
import { discoverDefault, verifiedFile } from "./build-metadata.mjs";
import { hostedVersions, planChange } from "./plans.mjs";
import { resolveBuild, buildRelease } from "./build.mjs";
import { applyHosting } from "./hosting.mjs";
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function validateRequest(input) {
  if (!/^hotwax\/[a-z0-9-]+$/.test(input.repo || ""))
    throw Error("Only the calling HotWax app repository is supported");
  if (
    !["inventory", "plan", "execute"].includes(input.operation) ||
    !["uat", "prod"].includes(input.environment)
  )
    throw Error("Invalid hosting operation or environment");
  if (!/^[a-f0-9-]{36}$/.test(input.requestId || ""))
    throw Error("Invalid request ID");
  if (!input.actor) throw Error("Missing GitHub actor");
  if (
    input.operation !== "inventory" &&
    !["publish", "default", "remove", "rebuild", "replace"].includes(
      input.action,
    )
  )
    throw Error("Invalid hosting action");
}
export function validatePlan(plan, input, live, sources) {
  if (
    plan.schemaVersion !== 1 ||
    plan.repo !== input.repo ||
    plan.actor !== input.actor ||
    plan.environment !== input.environment ||
    plan.action !== input.action ||
    plan.version !== (input.version || null) ||
    (plan.targetDefault || null) !== (input.defaultVersion || null)
  )
    throw Error(
      "This plan does not match the actor, app, environment or requested operation",
    );
  if (
    !Number.isFinite(Date.parse(plan.expiresAt)) ||
    Date.parse(plan.expiresAt) < Date.now()
  )
    throw Error("The plan expired; review it again");
  if (plan.toolsSha !== input.toolsSha)
    throw Error("Hosting tools changed; review a new plan");
  if (
    plan.target.project !== live.target.project ||
    plan.target.site !== live.target.site ||
    plan.baseFingerprint !== fingerprint(live.before)
  )
    throw Error("Live Hosting changed; review a new plan");
  if (digest(plan.sources) !== digest(sources))
    throw Error("Release source refs changed; review a new plan");
  if (plan.confirmation && input.confirmation !== plan.confirmation)
    throw Error("Confirmation does not match the reviewed operation");
}
export async function inspectDeployment(gh, connection, repo, environment) {
  const target = resolveTarget(
    JSON.parse(await repoFile(gh, repo, ".firebaserc")),
    environment,
  );
  await connection.api(
    "GET",
    `/projects/${target.project}/sites/${target.site}`,
  );
  const before = await snapshot(connection.api, target.site);
  let metadata;
  try {
    metadata = await discoverDefault(before, target);
  } catch (e) {
    metadata = {
      defaultVersion: null,
      configuredEnvironment: null,
      source: null,
      error: e.message,
    };
  }
  const latest = await connection.api(
    "GET",
    `/sites/${target.site}/channels/live/releases`,
    undefined,
    { pageSize: 1 },
  );
  if (latest.releases?.[0]?.name !== before.release.name)
    throw Error("Hosting changed during inspection; refresh again");
  const hosting = {
    available: true,
    target,
    versions: hostedVersions(before.files),
    defaultVersion: metadata.defaultVersion,
    configuredEnvironment: metadata.configuredEnvironment,
    defaultSource: metadata.source,
    defaultError: metadata.error,
    checkedAt: new Date().toISOString(),
    deployedAt: before.release.releaseTime,
    release: before.release.name,
    fileCount: before.files.length,
  };
  return { hosting, target, before };
}
export async function preparePlan(gh, connection, input) {
  validateRequest(input);
  const live = await inspectDeployment(
    gh,
    connection,
    input.repo,
    input.environment,
  );
  const releases = await githubPages(gh, `/repos/${input.repo}/releases`);
  let buildCapable = false;
  try {
    buildCapable = (await repoFile(gh, input.repo, ".env.example")).includes(
      "VITE_APP_VERSION_CONFIG=",
    );
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const change = planChange({
    ...input,
    targetDefault: input.defaultVersion,
    defaultVersion: live.hosting.defaultVersion,
    hosted: live.hosting.versions,
    releases,
    buildCapable,
  });
  const app = {
    id: input.repo.split("/")[1],
    repo: input.repo,
    name: input.repo.split("/")[1],
  };
  const sources = [];
  for (const version of change.build)
    sources.push(await resolveBuild(gh, app, version));
  const plan = {
    schemaVersion: 1,
    id: input.requestId,
    repo: input.repo,
    actor: input.actor,
    toolsSha: input.toolsSha,
    ...change,
    app,
    target: live.target,
    baseFingerprint: fingerprint(live.before),
    baseRelease: live.before.release.name,
    sources,
    sourceCommits: sources.map(({ config, ...s }) => s),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    writable: true,
    warnings: [],
  };
  if (plan.removed.length)
    plan.warnings.push(
      `Removes ${plan.removed.join(", ")}. Check Company instance selections first: instances pinned to a removed version are not changed.`,
    );
  if (plan.action === "publish" && plan.replaced.length)
    plan.warnings.push(
      `Already hosted and rebuilt in place: ${plan.replaced.join(", ")}.`,
    );
  if (plan.rootChanges)
    plan.warnings.push(
      plan.action === "replace"
        ? `Users of the main URL receive ${plan.nextDefault}. The site afterwards serves only ${plan.retained.join(", ")}.`
        : "Users of the main URL receive this rebuilt Default. Pinned releases remain hosted.",
    );
  if (plan.action === "rebuild")
    plan.warnings.push(
      "Every hosted version is rebuilt from its own pinned app and AccxUI commits. A failed build prevents publication.",
    );
  return { plan, live };
}
export async function executePlan(
  gh,
  connection,
  plan,
  input,
  workspace,
  progress,
) {
  validateRequest(input);
  const { plan: fresh, live } = await preparePlan(gh, connection, input);
  validatePlan(plan, input, live, fresh.sources);
  // Recompute all change lists from live state; stored plans are never executable instructions.
  const reviewed = [
    "build",
    "added",
    "replaced",
    "removed",
    "retained",
    "previousDefault",
    "nextDefault",
    "rootChanges",
    "confirmation",
  ];
  for (const key of reviewed)
    if (digest(plan[key]) !== digest(fresh[key]))
      throw Error("The reviewed change differs from the current plan");
  await mkdir(workspace, { recursive: true });
  const artifacts = new Map();
  if (["publish", "rebuild", "replace"].includes(fresh.action))
    for (const source of fresh.sources)
      for (const [file, bytes] of await buildRelease(
        fresh.app,
        source,
        input.environment,
        workspace,
        false,
        progress,
      ))
        artifacts.set(file, bytes);
  if (fresh.rootChanges)
    for (const [file, bytes] of await buildRelease(
      fresh.app,
      fresh.sources.find((s) => s.version === fresh.nextDefault),
      input.environment,
      workspace,
      true,
      progress,
    ))
      artifacts.set(file, bytes);
  // Every action refreshes the version manifest Company reads, once the Default is known.
  if (fresh.nextDefault) {
    let manifest = {};
    if (live.before.files.some((f) => f.path === "/hosted-versions.json"))
      manifest = JSON.parse(
        await verifiedFile(live.before, live.target, "/hosted-versions.json"),
      );
    const environmentTypeId =
      input.environment === "uat" ? "AppEnvUAT" : "AppEnvProd";
    const metadata = Buffer.from(
      JSON.stringify(
        {
          ...manifest,
          schemaVersion: 1,
          appId: manifest.appId || fresh.sources[0]?.appId,
          rootVersion: fresh.nextDefault,
          environmentTypeId,
          versions: fresh.retained.map((version) => ({
            version,
            environmentTypeId,
          })),
        },
        null,
        2,
      ),
    );
    artifacts.set("/release-manager.json", metadata);
    artifacts.set("/hosted-versions.json", metadata);
  }
  return applyHosting(
    connection,
    live.target,
    live.before,
    fresh,
    artifacts,
    progress,
  );
}
