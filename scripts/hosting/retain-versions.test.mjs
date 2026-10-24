import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { selectVersionFiles, writeVerifiedFile } from "./retain-versions.mjs";

const contents = Buffer.from("already shipped build\n");
const file = { path: "/v5.2.1/index.html", status: "ACTIVE", hash: createHash("sha256").update(gzipSync(contents, { level: 9 })).digest("hex") };

test("retains only the requested complete version, without root or other versions", () => {
  assert.deepEqual(selectVersionFiles([file, { ...file, path: "/index.html" }, { ...file, path: "/v5.3.0/index.html" }], ["v5.2.1"]), [file]);
  assert.throws(() => selectVersionFiles([file], ["v5.1.0"]), /not hosted/);
  assert.throws(() => selectVersionFiles([file], ["../v5.2.1"]), /stable/);
});

test("rejects paths that could escape the retained version or change the download URL", () => {
  for (const name of ["../index.html", "assets/../../index.html", "./index.html", "assets//file.js", "%2e%2e/index.html", "assets\\file.js", "file.js?other", "file.js#fragment"]) {
    assert.throws(() => selectVersionFiles([file, { ...file, path: `/v5.2.1/${name}` }], ["v5.2.1"]), /Unsafe/);
  }
  assert.throws(() => selectVersionFiles([{ ...file, status: "EXPECTED" }], ["v5.2.1"]), /Invalid/);
});

test("copies identical bytes and refuses HTML fallbacks, changed bytes, and overwrites", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "retain-hosting-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(writeVerifiedFile(directory, file, Buffer.from("new SPA fallback")), /changed or returned a fallback/);
  await writeVerifiedFile(directory, file, contents);
  assert.deepEqual(await readFile(path.join(directory, "v5.2.1/index.html")), contents);
  await assert.rejects(writeVerifiedFile(directory, file, contents), { code: "EEXIST" });
});
