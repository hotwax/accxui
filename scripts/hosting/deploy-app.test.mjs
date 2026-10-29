import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  latestVersions,
  requestInputs,
  describePlan,
} from "./deploy-app.mjs";

const tags = ["v3.5.1", "v3.5.0", "v3.4.2", "v3.4.1", "v3.3.0", "v2.9.9", "main", "v3.6.0-rc1"];

test("latest N keeps the newest patch of the newest minors, newest first", () => {
  assert.deepEqual(latestVersions(tags, 2), ["v3.5.1", "v3.4.2"]);
  assert.deepEqual(latestVersions(tags, 10), ["v3.5.1", "v3.4.2", "v3.3.0", "v2.9.9"]);
});

test("a count becomes an exact replace with the latest release at root", () =>
  assert.deepEqual(requestInputs({ count: "2" }, tags), {
    action: "replace",
    version: "v3.5.1,v3.4.2",
    default_version: "v3.5.1",
  }));

test("exact versions replace the site with the chosen Default", () => {
  assert.deepEqual(requestInputs({ versions: "v3.5.0, v3.4.2", default: "v3.4.2" }, []), {
    action: "replace",
    version: "v3.5.0,v3.4.2",
    default_version: "v3.4.2",
  });
  assert.throws(
    () => requestInputs({ versions: "v3.5.0", default: "v3.4.2" }, []),
    /one of the listed/,
  );
});

test("publish-only sends just the listed versions and leaves the Default alone", () =>
  assert.deepEqual(requestInputs(parseArgs(["--publish-only", "--versions", "v3.6.0,v3.4.2"]), []), {
    action: "publish",
    version: "v3.6.0,v3.4.2",
    default_version: "",
  }));

test("conflicting or incomplete options are refused", () => {
  for (const args of [
    ["--count", "0"],
    ["--count", "2", "--versions", "v1.0.0"],
    ["--publish-only"],
    ["--publish-only", "--versions", "v1.0.0", "--default", "v1.0.0"],
    ["--default", "v1.0.0"],
    ["--channel", "live"],
    ["--app", "a", "--app", "b"],
  ])
    assert.throws(() => parseArgs(args), undefined, args.join(" "));
});

test("the plan summary names every change before anything is deployed", () => {
  const text = describePlan({
    target: { project: "uat-project", site: "app-uat" },
    action: "replace",
    previousDefault: "v3.4.2",
    nextDefault: "v3.5.1",
    rootChanges: true,
    build: ["v3.5.1", "v3.4.2"],
    added: ["v3.5.1"],
    replaced: ["v3.4.2"],
    removed: ["v3.3.0"],
    retained: ["v3.5.1", "v3.4.2"],
    warnings: ["Removes v3.3.0."],
  });
  for (const part of ["app-uat", "v3.4.2 -> v3.5.1 (root rebuilt)", "Removed    : v3.3.0", "Warning    : Removes v3.3.0."])
    assert.ok(text.includes(part), part);
});
