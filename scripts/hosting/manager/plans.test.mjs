import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hostedVersions,
  planChange,
  configFor,
  verifyFileChanges,
} from "./plans.mjs";
import { resolveTarget } from "./catalog.mjs";
const base = {
  environment: "uat",
  defaultVersion: "v2.0.0",
  hosted: ["v2.0.0", "v1.0.0"],
  releases: ["v3.0.0", "v2.0.0", "v1.0.0"].map((tag_name) => ({
    tag_name,
    draft: false,
    prerelease: false,
  })),
  buildCapable: true,
};
test("inventory requires an actual version index, not tags or orphan assets", () =>
  assert.deepEqual(
    hostedVersions([
      { path: "/v1.0.0/assets/a.js" },
      { path: "/v2.0.0/index.html" },
      { path: "/v12.0.0/index.html" },
      { path: "/index.html" },
    ]),
    ["v12.0.0", "v2.0.0"],
  ));
test("publish preserves Default and every old version", () => {
  const plan = planChange({ ...base, action: "publish", version: "v3.0.0" });
  assert.equal(plan.rootChanges, false);
  assert.equal(plan.nextDefault, "v2.0.0");
  assert.deepEqual(plan.retained, ["v2.0.0", "v1.0.0", "v3.0.0"]);
  assert.deepEqual(plan.build, ["v3.0.0"]);
});
test("publish takes a list, adds new versions and rebuilds hosted ones in place", () => {
  const plan = planChange({
    ...base,
    action: "publish",
    version: "v3.0.0,v1.0.0",
  });
  assert.deepEqual(plan.build, ["v3.0.0", "v1.0.0"]);
  assert.deepEqual(plan.added, ["v3.0.0"]);
  assert.deepEqual(plan.replaced, ["v1.0.0"]);
  assert.deepEqual(plan.removed, []);
  assert.deepEqual(plan.retained, ["v2.0.0", "v1.0.0", "v3.0.0"]);
  assert.equal(plan.nextDefault, "v2.0.0");
  assert.equal(plan.rootChanges, false);
});
test("version lists reject duplicates and malformed entries", () => {
  for (const version of ["v3.0.0,v3.0.0", "v3.0.0,main", ","])
    assert.throws(() => planChange({ ...base, action: "publish", version }));
});
test("replace makes the site exactly the listed versions with the chosen Default", () => {
  const plan = planChange({
    ...base,
    action: "replace",
    version: "v3.0.0,v2.0.0",
    targetDefault: "v2.0.0",
  });
  assert.deepEqual(plan.build, ["v3.0.0", "v2.0.0"]);
  assert.deepEqual(plan.added, ["v3.0.0"]);
  assert.deepEqual(plan.replaced, ["v2.0.0"]);
  assert.deepEqual(plan.removed, ["v1.0.0"]);
  assert.deepEqual(plan.retained, ["v3.0.0", "v2.0.0"]);
  assert.equal(plan.nextDefault, "v2.0.0");
  assert.equal(plan.rootChanges, true);
  assert.equal(plan.confirmation, "REPLACE UAT SITE");
});
test("replace needs the Default in the list but not a verified current Default", () => {
  assert.throws(
    () =>
      planChange({
        ...base,
        action: "replace",
        version: "v3.0.0",
        targetDefault: "v2.0.0",
      }),
    /one of the listed/,
  );
  const plan = planChange({
    ...base,
    action: "replace",
    version: "v3.0.0,v2.0.0,v1.0.0",
    targetDefault: "v3.0.0",
    defaultVersion: null,
  });
  assert.deepEqual(plan.removed, []);
  assert.equal(plan.confirmation, null);
  assert.equal(
    planChange({
      ...base,
      environment: "prod",
      action: "replace",
      version: "v3.0.0",
      targetDefault: "v3.0.0",
    }).confirmation,
    "PUBLISH TO PRODUCTION",
  );
});
test("draft, prerelease, malformed and absent releases cannot deploy", () => {
  for (const version of ["v4.0.0", "main", "v1.0.0/../x"])
    assert.throws(() => planChange({ ...base, action: "publish", version }));
  assert.throws(
    () =>
      planChange({
        ...base,
        releases: [{ tag_name: "v3.0.0", draft: true }],
        action: "publish",
        version: "v3.0.0",
      }),
    /published/,
  );
});
test("promoting Default retains previous version for rollback", () => {
  const p = planChange({ ...base, action: "default", version: "v1.0.0" });
  assert.equal(p.nextDefault, "v1.0.0");
  assert.deepEqual(p.retained, base.hosted);
  assert.equal(p.rootChanges, true);
});
test("promotion refuses an unhosted target or an unverified/unretained old Default", () => {
  for (const overrides of [
    { version: "v3.0.0" },
    { version: "v1.0.0", defaultVersion: null },
    { version: "v1.0.0", hosted: ["v1.0.0"] },
  ])
    assert.throws(() =>
      planChange({ ...base, action: "default", ...overrides }),
    );
});
test("removal refuses current or unknown Default and requires exact confirmation", () => {
  assert.throws(
    () => planChange({ ...base, action: "remove", version: "v2.0.0" }),
    /different Default/,
  );
  assert.throws(
    () =>
      planChange({
        ...base,
        action: "remove",
        version: "v1.0.0",
        defaultVersion: null,
      }),
    /unverified/,
  );
  const p = planChange({ ...base, action: "remove", version: "v1.0.0" });
  assert.equal(p.confirmation, "REMOVE v1.0.0");
  assert.deepEqual(p.removed, ["v1.0.0"]);
  assert.deepEqual(p.retained, ["v2.0.0"]);
  assert.equal(p.rootChanges, false);
});
test("full rebuild includes ALL hosted versions and Default, with no latest-N trimming", () => {
  const p = planChange({ ...base, action: "rebuild" });
  assert.deepEqual(p.build, ["v2.0.0", "v1.0.0"]);
  assert.equal(p.nextDefault, base.defaultVersion);
  assert.deepEqual(p.removed, []);
});
test("rebuild cannot silently skip missing source releases", () =>
  assert.throws(
    () =>
      planChange({
        ...base,
        action: "rebuild",
        releases: base.releases.slice(0, 2),
      }),
    /Every hosted version/,
  ));
test("production requires specific confirmation; unknown environments fail", () => {
  assert.equal(
    planChange({
      ...base,
      environment: "prod",
      action: "publish",
      version: "v3.0.0",
    }).confirmation,
    "PUBLISH TO PRODUCTION",
  );
  assert.throws(() =>
    planChange({ ...base, environment: "production-other", action: "rebuild" }),
  );
});
test("target discovery resolves legacy aliases through actual hosting targets", () => {
  assert.deepEqual(
    resolveTarget(
      {
        projects: { production: "prod-project" },
        targets: { "prod-project": { hosting: { prod: ["site-prod"] } } },
      },
      "prod",
    ).site,
    "site-prod",
  );
  assert.throws(
    () =>
      resolveTarget(
        { targets: { a: { hosting: { uat: ["one", "two"] } } } },
        "uat",
      ),
    /one/,
  );
});
test("publish routes are scoped and existing security/redirect rules survive", () => {
  const original = {
    rewrites: [{ glob: "**", path: "/index.html" }],
    headers: [{ glob: "**", headers: { "X-Frame-Options": "SAMEORIGIN" } }],
    redirects: [{ glob: "/old", location: "/new", statusCode: 302 }],
  };
  const next = configFor(
    planChange({ ...base, action: "publish", version: "v3.0.0" }),
    original,
  );
  assert.deepEqual(next.headers.at(-2), original.headers[0]);
  assert.deepEqual(next.redirects, original.redirects);
  assert.equal(
    new RegExp(next.rewrites[0].regex).test("/v3.0.0/products"),
    true,
  );
  assert.equal(new RegExp(next.rewrites[0].regex).test("/products"), false);
  assert.equal(original.rewrites.length, 1);
});
test("removal removes version routing without changing root routing", () => {
  const config = {
    rewrites: [
      { glob: "/v1.0.0/**", path: "/v1.0.0/index.html" },
      { glob: "**", path: "/index.html" },
    ],
  };
  assert.deepEqual(
    configFor(
      planChange({ ...base, action: "remove", version: "v1.0.0" }),
      config,
    ).rewrites,
    [{ glob: "**", path: "/index.html" }],
  );
});
test("replace drops routes of removed versions and adds routes only for new ones", () => {
  const config = {
    rewrites: [
      { glob: "/v1.0.0/**", path: "/v1.0.0/index.html" },
      { glob: "/v2.0.0/**", path: "/v2.0.0/index.html" },
      { glob: "**", path: "/index.html" },
    ],
  };
  const next = configFor(
    planChange({
      ...base,
      action: "replace",
      version: "v3.0.0,v2.0.0",
      targetDefault: "v3.0.0",
    }),
    config,
  );
  assert.deepEqual(next.rewrites.map((r) => r.path), [
    "/v3.0.0/index.html",
    "/v2.0.0/index.html",
    "/index.html",
  ]);
});
test("a published version keeps the immutable cache on its assets", () => {
  const original = {
    headers: [
      { source: "**", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      {
        source: "**/assets/**",
        headers: [{ key: "Cache-Control", value: "public,max-age=31536000,immutable" }],
      },
    ],
  };
  const next = configFor(
    planChange({ ...base, action: "publish", version: "v3.0.0" }),
    original,
  );
  // Firebase applies matching rules in order; the last Cache-Control wins.
  const version = next.headers.findIndex(
    (h) => h.regex && new RegExp(h.regex).test("/v3.0.0/assets/app.js"),
  );
  const assets = next.headers.findIndex((h) => h.source === "**/assets/**");
  assert.ok(version >= 0 && version < assets);
});
test("removal drops the removed version's cache rule", () => {
  const published = configFor(
    planChange({ ...base, action: "publish", version: "v3.0.0" }),
    {},
  );
  assert.equal(published.headers.some((h) => h.regex), true);
  const next = configFor(
    planChange({ ...base, hosted: ["v3.0.0", ...base.hosted], action: "remove", version: "v3.0.0" }),
    published,
  );
  assert.equal(next.headers.some((h) => h.regex), false);
});
test("the version manifest always gets an uncached cross-origin header, once", () => {
  const plan = planChange({ ...base, action: "publish", version: "v3.0.0" });
  const next = configFor(plan, {});
  const rules = next.headers.filter((h) => h.glob === "/hosted-versions.json");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].headers["Access-Control-Allow-Origin"], "*");
  assert.equal(
    configFor(plan, next).headers.filter((h) =>
      JSON.stringify(h).includes("hosted-versions.json"),
    ).length,
    1,
  );
});
test("publish over a hosted version clears its stale assets", () => {
  const before = [
    { path: "/index.html", hash: "root" },
    { path: "/v1.0.0/assets/old.js", hash: "old" },
  ];
  const plan = planChange({ ...base, action: "publish", version: "v1.0.0" });
  const uploads = new Map([["/v1.0.0/assets/new.js", "new"]]);
  verifyFileChanges(
    before,
    [before[0], { path: "/v1.0.0/assets/new.js", hash: "new" }],
    plan,
    uploads,
  );
  assert.throws(
    () =>
      verifyFileChanges(
        before,
        [...before, { path: "/v1.0.0/assets/new.js", hash: "new" }],
        plan,
        uploads,
      ),
    /Stale rebuilt/,
  );
});
test("post-upload verification fails on changed root, omitted upload or surviving removed version", () => {
  const before = [
    { path: "/index.html", hash: "root" },
    { path: "/v1.0.0/index.html", hash: "old" },
  ];
  const remove = planChange({ ...base, action: "remove", version: "v1.0.0" });
  assert.throws(
    () => verifyFileChanges(before, before, remove, new Map()),
    /still hosted/,
  );
  assert.throws(
    () =>
      verifyFileChanges(
        before,
        [{ path: "/index.html", hash: "bad" }],
        remove,
        new Map(),
      ),
    /Preserved/,
  );
  assert.throws(
    () =>
      verifyFileChanges(
        before,
        [before[0]],
        remove,
        new Map([["/release-manager.json", "new"]]),
      ),
    /not verified/,
  );
  verifyFileChanges(before, [before[0]], remove, new Map());
});
import { parseBuildMetadata, matchesHostedHash } from "./build-metadata.mjs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
test("Default metadata ignores library versions and unreleased branch builds", () => {
  assert.equal(
    parseBuildMetadata(
      'version="3.5.30";JSON.parse(\'{"version":"3.4.1","branch":"","tag":"v3.4.1","revision":"abc","builtTime":123}\')',
    ),
    "v3.4.1",
  );
  assert.equal(
    parseBuildMetadata(
      '{"version":"3.4.1","branch":"main","tag":"v3.4.1","revision":"abc","builtTime":123}',
    ),
    null,
  );
});
test("public asset content must match the Hosting manifest", () => {
  const bytes = Buffer.from("verified app bundle"),
    gz = gzipSync(bytes, { level: 9 });
  gz[9] = 3;
  const digest = createHash("sha256").update(gz).digest("hex");
  assert.equal(matchesHostedHash(bytes, digest), true);
  assert.equal(matchesHostedHash(Buffer.from("different"), digest), false);
});
test("rebuild replaces obsolete hashed assets only inside rebuilt version directories", () => {
  const before = [
    { path: "/index.html", hash: "root" },
    { path: "/v1.0.0/assets/old.js", hash: "old" },
    { path: "/custom.txt", hash: "custom" },
  ];
  const plan = planChange({ ...base, action: "rebuild" });
  const uploads = new Map([["/v1.0.0/assets/new.js", "new"]]);
  verifyFileChanges(
    before,
    [before[0], before[2], { path: "/v1.0.0/assets/new.js", hash: "new" }],
    plan,
    uploads,
  );
  assert.throws(
    () =>
      verifyFileChanges(
        before,
        [...before, { path: "/v1.0.0/assets/new.js", hash: "new" }],
        plan,
        uploads,
      ),
    /Stale rebuilt/,
  );
});
