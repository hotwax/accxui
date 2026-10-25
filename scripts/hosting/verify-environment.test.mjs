import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyEnvironment } from "./verify-environment.mjs";

async function fixture(t, environment = "AppEnvProd") {
  const dist = await mkdtemp(path.join(tmpdir(), "hosting-env-test-"));
  t.after(() => rm(dist, { recursive: true, force: true }));
  for (const version of ["", "v5.3.0"]) {
    await mkdir(path.join(dist, version, "assets"), { recursive: true });
    await writeFile(path.join(dist, version, "index.html"), '<script src="assets/index.js"></script>');
    const json = JSON.stringify({ appId: "CYCLE_COUNT", environmentTypeId: environment, buildVersion: version });
    // Exercise both JS string delimiters, including escaped JSON quotes.
    await writeFile(path.join(dist, version, "assets/index.js"), `JSON.parse('${json}')`);
    await writeFile(path.join(dist, version, "assets/index-legacy.js"), `JSON.parse(${JSON.stringify(json)})`);
  }
  return dist;
}

for (const environment of ["AppEnvDev", "AppEnvUAT", "AppEnvProd"]) {
  test(`accepts matching root, versioned and legacy ${environment} builds`, async t => {
    await verifyEnvironment(await fixture(t, environment), environment);
  });
}

test("rejects the development default for a production release with a failing CLI exit", async t => {
  const dist = await fixture(t, "AppEnvDev");
  const result = spawnSync(process.execPath, [new URL("./verify-environment.mjs", import.meta.url).pathname, dist, "AppEnvProd"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected AppEnvProd, found AppEnvDev/);
});

test("rejects a UAT version even when the root and the other bundle are production", async t => {
  const dist = await fixture(t);
  await writeFile(path.join(dist, "v5.3.0/assets/index-legacy.js"), 'JSON.parse(\'{"environmentTypeId": "AppEnvUAT"}\')');
  await assert.rejects(verifyEnvironment(dist, "AppEnvProd"), /v5.3.0.*expected AppEnvProd, found AppEnvUAT/);
});

test("fails closed when a version's config is missing", async t => {
  const dist = await fixture(t);
  for (const file of ["index.js", "index-legacy.js"]) {
    await writeFile(path.join(dist, "v5.3.0/assets", file), "console.log('no config')");
  }
  await assert.rejects(verifyEnvironment(dist, "AppEnvProd"), /v5.3.0: no compiled environmentTypeId/);
});

test("rejects incomplete builds and unknown target environments", async t => {
  const dist = await fixture(t);
  await assert.rejects(verifyEnvironment(dist, "production"), /Expected AppEnvDev, AppEnvUAT or AppEnvProd/);
  await rm(path.join(dist, "v5.3.0/index.html"));
  await assert.rejects(verifyEnvironment(dist, "AppEnvProd"), /ENOENT/);
});
