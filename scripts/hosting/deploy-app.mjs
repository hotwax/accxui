// `pnpm deploy:app`: chooses what to deploy, then runs the plan and execute steps of the app's
// GitHub Actions hosting workflow and follows them. Nothing is built or deployed from this machine,
// so builds use the same pinned sources and GitHub secrets as every other deployment.
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const VERSION = /^v\d+\.\d+\.\d+$/;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_COUNT = 2;

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--publish-only") {
      options.publishOnly = true;
      continue;
    }
    if (
      !["--app", "--environment", "--count", "--versions", "--default"].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error(`Invalid option: ${key}`);
    const name = key.slice(2);
    if (options[name] !== undefined) throw Error(`Duplicate option: ${key}`);
    options[name] = args[++i];
  }
  if (options.count !== undefined && !/^[1-9]\d*$/.test(options.count))
    throw Error("--count must be a positive number");
  if (options.count && options.versions)
    throw Error("Use either --count or --versions, not both");
  if (options.publishOnly && (options.count || options.default))
    throw Error("--publish-only takes --versions only");
  if (options.publishOnly && !options.versions)
    throw Error("--publish-only needs --versions");
  if (options.default && !options.versions)
    throw Error("--default needs --versions");
  return options;
}

// Latest patch of each major.minor, newest `count` minors, newest first: the same set the tag rollout keeps.
export function latestVersions(tags, count) {
  const latest = new Map();
  const sorted = tags
    .filter((t) => VERSION.test(t))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const tag of sorted) latest.set(tag.split(".").slice(0, 2).join("."), tag);
  return [...latest.values()].reverse().slice(0, count);
}

// The workflow inputs for a request. A count becomes an exact list so the plan always names its versions.
export function requestInputs(options, tags) {
  if (options.publishOnly) return { action: "publish", version: options.versions, default_version: "" };
  if (options.versions) {
    const list = options.versions.split(",").map((v) => v.trim());
    if (!list.includes(options.default))
      throw Error("--default must be one of the listed --versions");
    return { action: "replace", version: list.join(","), default_version: options.default };
  }
  const versions = latestVersions(tags, Number(options.count || DEFAULT_COUNT));
  if (!versions.length) throw Error("No published vX.Y.Z releases found");
  return { action: "replace", version: versions.join(","), default_version: versions[0] };
}

export function describePlan(plan) {
  const list = (values) => (values?.length ? values.join(", ") : "none");
  return [
    `  Site       : ${plan.target.project} / ${plan.target.site}`,
    `  Action     : ${plan.action}`,
    `  Default    : ${plan.previousDefault || "unknown"} -> ${plan.nextDefault || "unknown"}${plan.rootChanges ? " (root rebuilt)" : " (root unchanged)"}`,
    `  Build      : ${list(plan.build)}`,
    `  Added      : ${list(plan.added)}`,
    `  Rebuilt    : ${list(plan.replaced)}`,
    `  Removed    : ${list(plan.removed)}`,
    `  Afterwards : ${list(plan.retained)}`,
    ...(plan.warnings || []).map((w) => `  Warning    : ${w}`),
  ].join("\n");
}

const gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function appRepo(app) {
  const url = execFileSync("git", ["-C", path.join(root, "apps", app), "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  const repo = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  if (!repo) throw Error(`Cannot tell the GitHub repository of ${app}`);
  return repo;
}

function hostingConfig(app) {
  const file = path.join(root, "apps", app, ".github/app-hosting.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

const hasMergeDeploy = (app) =>
  existsSync(path.join(root, "apps", app, ".github/workflows/firebase-hosting-merge.yml"));

function environmentsFor(app) {
  return [...(hasMergeDeploy(app) ? ["dev"] : []), ...(hostingConfig(app)?.environments || [])];
}

async function choose(rl, label, values) {
  values.forEach((v, i) => console.log(`  ${i + 1}) ${v}`));
  const answer = (await rl.question(`${label} (number): `)).trim();
  const value = values[Number(answer) - 1];
  if (!value) throw Error("Nothing selected");
  return value;
}

// Each dispatch carries a request id in its run name; find that run, follow it, then read its saved result.
async function runWorkflow(repo, config, branch, inputs) {
  const fields = Object.entries(inputs).flatMap(([k, v]) => ["-f", `${k}=${v ?? ""}`]);
  gh(["workflow", "run", config.workflow, "-R", repo, "--ref", branch, ...fields]);
  let run;
  for (let i = 0; i < 40 && !run; i++) {
    await pause(3000);
    const runs = JSON.parse(
      gh(["run", "list", "-R", repo, "--workflow", config.workflow, "--event", "workflow_dispatch", "-L", "20", "--json", "databaseId,displayTitle,url"]),
    );
    run = runs.find((r) => r.displayTitle.includes(`[${inputs.request_id}]`));
  }
  if (!run) throw Error("The workflow run did not start. Check the app's Actions page.");
  console.log(`  Run: ${run.url}`);
  spawnSync("gh", ["run", "watch", String(run.databaseId), "-R", repo, "--interval", "10"], { stdio: "inherit" });
  let content;
  try {
    content = gh([
      "api",
      `repos/${repo}/contents/requests/${inputs.request_id}.json?ref=${config.stateBranch}`,
      "--jq",
      ".content",
    ]);
  } catch {
    throw Error(`${inputs.operation} failed before saving a result: ${run.url}`);
  }
  const result = JSON.parse(Buffer.from(content, "base64").toString("utf8"));
  if (result.status !== "completed")
    throw Error(`${inputs.operation} ${result.status}: ${result.error || "see " + run.url}`);
  return result;
}

// Dev has no versioned hosting: it re-runs the latest merge deployment of the default branch.
async function redeployDev(rl, repo, branch) {
  const [last] = JSON.parse(
    gh(["run", "list", "-R", repo, "--workflow", "firebase-hosting-merge.yml", "--branch", branch, "-L", "1", "--json", "databaseId,displayTitle,url,headSha"]),
  );
  if (!last) throw Error(`No dev deployment of ${branch} to re-run`);
  console.log(`\n  Re-run dev deploy of ${branch} @ ${last.headSha.slice(0, 7)}: ${last.displayTitle}\n  ${last.url}`);
  if (!/^y/i.test(await rl.question("Proceed? [y/N] "))) throw Error("aborted");
  gh(["run", "rerun", String(last.databaseId), "-R", repo]);
  await pause(5000);
  const watch = spawnSync("gh", ["run", "watch", String(last.databaseId), "-R", repo, "--exit-status", "--interval", "10"], { stdio: "inherit" });
  if (watch.status !== 0) throw Error(`Dev deploy failed: ${last.url}`);
}

export async function main(args) {
  const options = parseArgs(args);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const apps = readdirSync(path.join(root, "apps")).filter((a) => environmentsFor(a).length).sort();
    const app = options.app || (await choose(rl, "Select app to deploy", apps));
    if (!apps.includes(app)) throw Error(`${app} has no deploy workflows`);
    const environments = environmentsFor(app);
    const environment = options.environment || (await choose(rl, "Select target environment", environments));
    if (!environments.includes(environment))
      throw Error(`${app} is not set up for ${environment} (${environments.join(", ")} available)`);
    const repo = appRepo(app);
    const branch = gh(["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
    if (environment === "dev") {
      if (options.count || options.versions) throw Error("Dev deploys the default branch only; versions are not supported");
      return redeployDev(rl, repo, branch);
    }
    const config = hostingConfig(app);
    if (!options.publishOnly && !options.versions && !options.count)
      options.count = (await rl.question(`How many minor versions to host? [${DEFAULT_COUNT}] `)).trim() || String(DEFAULT_COUNT);
    if (!/^[1-9]\d*$/.test(options.count || "1")) throw Error("The count must be a positive number");
    const tags = options.versions
      ? []
      : gh(["api", `repos/${repo}/releases`, "--paginate", "--jq", ".[] | select(.draft | not) | select(.prerelease | not) | .tag_name"]).split("\n");
    const request = requestInputs(options, tags);
    const shared = { environment, ...request };
    console.log(`\nPlanning ${request.action} of ${app} ${environment}: ${request.version}${request.default_version ? ` (Default ${request.default_version})` : ""}`);
    const planned = await runWorkflow(repo, config, branch, { operation: "plan", request_id: randomUUID(), ...shared });
    const plan = planned.plan;
    console.log(`\n${describePlan(plan)}\n`);
    let confirmation = "";
    if (plan.confirmation) {
      confirmation = (await rl.question(`Type "${plan.confirmation}" to deploy: `)).trim();
      if (confirmation !== plan.confirmation) throw Error("aborted");
    } else if (!/^y/i.test(await rl.question("Deploy this plan? [y/N] "))) throw Error("aborted");
    const done = await runWorkflow(repo, config, branch, {
      operation: "execute",
      request_id: randomUUID(),
      ...shared,
      plan_sha: plan.planSha,
      confirmation,
    });
    console.log(`\nDone: ${app} ${environment} Default ${done.hosting?.defaultVersion || plan.nextDefault}, versions ${(done.hosting?.versions || plan.retained).join(", ")}.`);
  } finally {
    rl.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`ERROR: ${e.message}`);
    process.exitCode = 1;
  });
}
