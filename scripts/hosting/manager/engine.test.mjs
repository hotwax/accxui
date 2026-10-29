import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, validatePlan } from "./engine.mjs";
import { fingerprint } from "./providers.mjs";
import { readPlanBlob } from "./state.mjs";
const input = {
  repo: "hotwax/job-manager",
  actor: "tester",
  operation: "execute",
  action: "publish",
  environment: "uat",
  requestId: "11111111-1111-4111-8111-111111111111",
  version: "v3.5.0",
  toolsSha: "a".repeat(40),
};
const live = {
  target: { project: "uat-project", site: "app-uat" },
  before: {
    release: { name: "release-one" },
    version: { config: {} },
    files: [{ path: "/index.html", hash: "hash" }],
  },
};
const sources = [
  { appCommit: "a".repeat(40), frameworkCommit: "b".repeat(40) },
];
const plan = () => ({
  schemaVersion: 1,
  ...input,
  target: live.target,
  baseFingerprint: fingerprint(live.before),
  sources,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
test("valid actor-bound plan is accepted", () => {
  validateRequest(input);
  validatePlan(plan(), input, live, sources);
});
for (const [field, value] of Object.entries({
  repo: "hotwax/products",
  actor: "someone-else",
  environment: "prod",
  action: "remove",
  version: "v3.4.2",
  toolsSha: "b".repeat(40),
  expiresAt: "2000-01-01",
  targetDefault: "v3.5.0",
}))
  test(`rejects changed ${field}`, () =>
    assert.throws(() =>
      validatePlan({ ...plan(), [field]: value }, input, live, sources),
    ));
test("rejects changed hosting files and sources", () => {
  assert.throws(
    () =>
      validatePlan(
        plan(),
        input,
        { ...live, before: { ...live.before, files: [] } },
        sources,
      ),
    /Live Hosting changed/,
  );
  assert.throws(
    () => validatePlan(plan(), input, live, []),
    /source refs changed/,
  );
});
test("requires destructive-operation confirmation", () =>
  assert.throws(
    () =>
      validatePlan(
        { ...plan(), confirmation: "REMOVE v3.5.0" },
        input,
        live,
        sources,
      ),
    /Confirmation/,
  ));
test("immutable plan lookup rejects branches and parses a git blob", async () => {
  await assert.rejects(
    readPlanBlob(
      () => assert.fail("must not request"),
      "hotwax/job-manager",
      "main",
    ),
    /immutable/,
  );
  const got = await readPlanBlob(
    async (m, p) => {
      assert.ok(p.endsWith("/git/blobs/" + "a".repeat(40)));
      return {
        encoding: "base64",
        content: Buffer.from(JSON.stringify(plan())).toString("base64"),
      };
    },
    input.repo,
    "a".repeat(40),
  );
  assert.equal(got.actor, "tester");
});
test("the Hosting fingerprint ignores map key order but not rule order or values", () => {
  const snap = (headers, files = [{ path: "/index.html", hash: "a" }]) => ({
    release: { name: "sites/s/channels/live/releases/1" },
    version: { config: { headers } },
    files,
  });
  const manifest = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
  const assets = { glob: "**/assets/**", headers: { "Cache-Control": "immutable" } };
  const base = fingerprint(snap([{ glob: "/hosted-versions.json", headers: manifest }, assets]));
  // Same config read again, with Firebase returning the map keys in another order.
  assert.equal(
    fingerprint(
      snap([{ headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }, glob: "/hosted-versions.json" }, assets]),
    ),
    base,
  );
  assert.notEqual(fingerprint(snap([assets, { glob: "/hosted-versions.json", headers: manifest }])), base);
  assert.notEqual(
    fingerprint(snap([{ glob: "/hosted-versions.json", headers: { ...manifest, "Cache-Control": "no-cache" } }, assets])),
    base,
  );
  assert.notEqual(
    fingerprint(snap([{ glob: "/hosted-versions.json", headers: manifest }, assets], [{ path: "/index.html", hash: "b" }])),
    base,
  );
});
