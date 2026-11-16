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
test("any operation moves existing version cache rules ahead of the assets rule", () => {
  const assets = {
    source: "**/assets/**",
    headers: [{ key: "Cache-Control", value: "public,max-age=31536000,immutable" }],
  };
  const stale = { regex: "^/v1\\.0\\.0(?:/.*)?$", headers: { "Cache-Control": "no-cache" } };
  for (const action of ["default", "publish", "rebuild"]) {
    const next = configFor(
      planChange({ ...base, action, version: action === "rebuild" ? null : "v1.0.0" }),
      { headers: [assets, stale] },
    );
    assert.deepEqual(next.headers.slice(0, 2), [stale, assets], action);
  }
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
test("post-upload verification ignores Firebase's reserved /__/ files", () => {
  const before = [
    { path: "/index.html", hash: "root" },
    { path: "/__/firebase/init.js", hash: "init" },
  ];
  const uploads = new Map([["/v3.0.0/index.html", "new"]]);
  const publish = planChange({ ...base, action: "publish", version: "v3.0.0" });
  const built = [before[0], { path: "/v3.0.0/index.html", hash: "new" }];
  // Regenerated, dropped or newly added by Firebase on the clone: none of these is a failure.
  verifyFileChanges(before, [...built, { path: "/__/firebase/init.js", hash: "regenerated" }], publish, uploads);
  verifyFileChanges(before, built, publish, uploads);
  verifyFileChanges([before[0]], [...built, { path: "/__/firebase/init.json", hash: "added" }], publish, uploads);
  // The app's own files are still checked.
  assert.throws(
    () => verifyFileChanges(before, [{ path: "/index.html", hash: "bad" }, built[1]], publish, uploads),
    /Preserved/,
  );
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
import { discoverDefault, entryScriptImports } from "./build-metadata.mjs";
test("Default discovery follows a module-federation bootstrap to the app bundle", async () => {
  // Shape of the live uat-fulfillment root build (v4.2.3).
  const files = {
    "/index.html":
      '<script type="module" crossorigin src="/assets/mf-entry-bootstrap-0-a.js"></script>',
    "/assets/mf-entry-bootstrap-0-a.js":
      'const __mfImport=(s)=>import(s);(async()=>{const h=await __mfImport("./hostInit-b.js")})().then(()=>__mfImport("./index-c.js"));',
    "/assets/hostInit-b.js":
      'import{x}from"./loadShare-d.js";import("../remoteEntry.js");import("./localSharedImportMap-e.js");',
    "/assets/loadShare-d.js": "export const x=1;",
    "/assets/localSharedImportMap-e.js": "export default {};",
    "/assets/index-c.js":
      'import"./loadShare-d.js";import"./virtualExposes-f.js";n(()=>import("./index-g.js"),[],import.meta.url);',
    "/assets/virtualExposes-f.js": "export default {};",
    "/assets/index-g.js":
      'const c={"environmentTypeId":"AppEnvUAT"};JSON.parse(\'{"version":"4.2.3","branch":"","tag":"v4.2.3","revision":"b539f46c","builtTime":1}\')',
    // A retained version's bundle must never be read for the root Default.
    "/v4.1.0/assets/index-z.js":
      '{"version":"4.1.0","branch":"","tag":"v4.1.0","revision":"x","builtTime":1}',
  };
  const state = {
    files: Object.entries(files).map(([path, body]) => ({
      path,
      hash: createHash("sha256").update(body).digest("hex"),
    })),
  };
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    fetched.push(path);
    return path in files
      ? new Response(files[path])
      : new Response("<html>", { status: 200 });
  };
  try {
    assert.deepEqual(
      await discoverDefault(state, { origin: "https://site.web.app" }),
      {
        defaultVersion: "v4.2.3",
        configuredEnvironment: "AppEnvUAT",
        source: "Compiled build metadata",
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(!fetched.some((p) => p.startsWith("/v4.1.0/")));
  assert.ok(!fetched.includes("/remoteEntry.js"));
});
test("entry imports stay inside root assets and check dynamic imports first", () =>
  assert.deepEqual(
    entryScriptImports(
      'import"./a.js";import("./b.js");import("../remoteEntry.js");import"./legacy-c.js";"assets/Settings-d.js"',
      "/assets/entry.js",
    ),
    ["/assets/Settings-d.js", "/assets/b.js", "/assets/a.js"],
  ));
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
