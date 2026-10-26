import { randomUUID } from "node:crypto";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { github, firebase } from "./providers.mjs";
import { writeState, readPlanBlob } from "./state.mjs";
import {
  validateRequest,
  inspectDeployment,
  preparePlan,
  executePlan,
} from "./engine.mjs";

const input = {
  repo: process.env.GITHUB_REPOSITORY,
  actor: process.env.GITHUB_ACTOR,
  requestId: process.env.RM_REQUEST_ID || randomUUID(),
  operation: process.env.RM_OPERATION || "inventory",
  environment: process.env.RM_ENVIRONMENT || "uat",
  action: process.env.RM_ACTION,
  version: process.env.RM_VERSION || null,
  confirmation: process.env.RM_CONFIRMATION || "",
  toolsSha: process.env.RM_TOOLS_SHA,
};
validateRequest(input);
if (
  process.env.GITHUB_REF !== `refs/heads/${process.env.RM_DEFAULT_BRANCH}` &&
  input.operation !== "inventory"
)
  throw Error("Manual hosting operations must use the default branch");
if (
  input.environment === "prod" &&
  process.env.RM_PRODUCTION_ENABLED !== "true"
)
  throw Error("Production hosting management is not enabled");
if (!process.env.GH_TOKEN || !process.env.STATE_TOKEN)
  throw Error("Missing GitHub authentication");
const gh = github(process.env.GH_TOKEN),
  state = github(process.env.STATE_TOKEN);
const result = {
  schemaVersion: 1,
  id: input.requestId,
  operation: input.operation,
  environment: input.environment,
  action: input.action,
  version: input.version,
  actor: input.actor,
  status: "running",
  createdAt: new Date().toISOString(),
  steps: [],
  runUrl: `https://github.com/${input.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
};
const progress = (message) => {
  result.steps.push({ message, at: new Date().toISOString() });
  console.log(message);
};
let failed = false;
try {
  await writeState(
    state,
    input.repo,
    `requests/${input.requestId}.json`,
    result,
  );
  const connection = await firebase();
  if (input.operation === "plan") {
    const { plan, live } = await preparePlan(gh, connection, input);
    const saved = await writeState(
      state,
      input.repo,
      `plans/${input.requestId}.json`,
      plan,
    );
    result.plan = { ...plan, planSha: saved.content.sha };
    await writeState(
      state,
      input.repo,
      `inventory/${input.environment}.json`,
      live.hosting,
    );
  } else if (input.operation === "execute") {
    const plan = await readPlanBlob(state, input.repo, process.env.RM_PLAN_SHA);
    result.deployment = await executePlan(
      gh,
      connection,
      plan,
      input,
      path.join(process.env.RUNNER_TEMP || ".", `hosting-${input.requestId}`),
      progress,
    );
  }
  if (input.operation !== "plan") {
    const live = await inspectDeployment(
      gh,
      connection,
      input.repo,
      input.environment,
    );
    result.hosting = live.hosting;
    await writeState(
      state,
      input.repo,
      `inventory/${input.environment}.json`,
      live.hosting,
    );
  }
  result.status = "completed";
} catch (e) {
  failed = true;
  result.status = "failed";
  result.error = e.message;
}
result.finishedAt = new Date().toISOString();
try {
  await writeState(
    state,
    input.repo,
    `requests/${input.requestId}.json`,
    result,
  );
} catch {
  failed = true;
  console.error(
    "Unable to save operation status. Inspect this run and live Hosting before retrying.",
  );
}
if (process.env.GITHUB_STEP_SUMMARY)
  await writeFile(
    process.env.GITHUB_STEP_SUMMARY,
    `${input.operation}: **${result.status}**\n\n${result.error || "Inventory and deployment results were saved to the app-hosting-state branch."}\n`,
    { flag: "a" },
  );
if (failed) process.exitCode = 1;
