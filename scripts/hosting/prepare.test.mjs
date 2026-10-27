import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { prepareHosting, legacyWorkerPattern } from "./prepare.mjs";

const source = await readFile(new URL("./retire-legacy-worker.js", import.meta.url), "utf8");
async function fixture(t, hosting) {
  const root = await mkdtemp(path.join(tmpdir(), "worker-recovery-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "dist/v1.2.3"), { recursive: true });
  await writeFile(path.join(root, "dist/index.html"), "current app");
  await writeFile(path.join(root, "dist/v1.2.3/index.html"), "retained app");
  await writeFile(path.join(root, "dist/v1.2.3/service-worker.js"), "old caching worker");
  await writeFile(path.join(root, "dist/firebase-messaging-sw.js"), "push worker");
  await writeFile(path.join(root, "firebase.json"), JSON.stringify({ hosting }));
  return root;
}

test("all hosting targets retain recovery endpoints ahead of SPA rewrites without changing CSP/push", async (t) => {
  const headers = [{ source: "**", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'" }] }];
  const rewrites = [{ source: "/v1.2.3/**", destination: "/v1.2.3/index.html" }, { source: "**", destination: "/index.html" }];
  const root = await fixture(t, ["dev", "uat", "prod"].map(target => ({ target, public: "dist", headers, rewrites })));
  await prepareHosting(root);
  for (const file of ["dist/service-worker.js", "dist/v1.2.3/service-worker.js"]) {
    assert.equal(await readFile(path.join(root, file), "utf8"), source);
  }
  assert.equal(await readFile(path.join(root, "dist/firebase-messaging-sw.js"), "utf8"), "push worker");
  const first = await readFile(path.join(root, "firebase.json"), "utf8");
  for (const target of JSON.parse(first).hosting) {
    assert.deepEqual(target.rewrites.slice(1), rewrites);
    assert.deepEqual(target.headers[0], headers[0]);
    assert.equal(target.rewrites[0].destination, "/service-worker.js");
    assert.ok(new RegExp(target.rewrites[0].regex).test("/v0.0.1/service-worker.js"));
    assert.equal(target.headers.at(-1).headers[0].value, "no-store");
  }
  await prepareHosting(root);
  assert.equal(await readFile(path.join(root, "firebase.json"), "utf8"), first);
});

test("single-target configuration keeps its original shape", async (t) => {
  const root = await fixture(t, { public: "dist" });
  await prepareHosting(root);
  const { hosting } = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8"));
  assert.equal(Array.isArray(hosting), false);
  assert.equal(hosting.public, "dist");
});

test("compatibility rewrite does not capture push workers or app navigation", () => {
  const pattern = new RegExp(legacyWorkerPattern);
  for (const url of ["/service-worker.js", "/v1.20.300/service-worker.js"]) assert.ok(pattern.test(url));
  for (const url of ["/firebase-messaging-sw.js", "/v1.2.3/firebase-messaging-sw.js", "/orders", "/service-worker.js/anything", "/assets/service-worker.js"]) assert.equal(pattern.test(url), false);
});

test("a missing build fails before the hosting configuration is changed", async (t) => {
  const root = await fixture(t, [{ public: "missing" }]);
  const before = await readFile(path.join(root, "firebase.json"), "utf8");
  await assert.rejects(prepareHosting(root), /ENOENT/);
  assert.equal(await readFile(path.join(root, "firebase.json"), "utf8"), before);
});

test("an incomplete retained version fails before replacing any worker", async (t) => {
  const root = await fixture(t, { public: "dist" });
  await rm(path.join(root, "dist/v1.2.3/index.html"));
  await writeFile(path.join(root, "dist/service-worker.js"), "original worker");
  await assert.rejects(prepareHosting(root), /ENOENT/);
  assert.equal(await readFile(path.join(root, "dist/service-worker.js"), "utf8"), "original worker");
  assert.equal(await readFile(path.join(root, "dist/v1.2.3/service-worker.js"), "utf8"), "old caching worker");
});

test("retirement waits for activation, unregisters only itself, and reloads controlled windows", async () => {
  const events = {}, calls = [];
  vm.runInNewContext(source, { self: {
    addEventListener(name, handler) { events[name] = handler; },
    skipWaiting: async () => calls.push("skipWaiting"),
    registration: { unregister: async () => calls.push("unregister") },
    clients: { matchAll: async (options) => {
      assert.equal(options.type, "window");
      assert.equal(options.includeUncontrolled, undefined);
      return [
        { url: "https://app.test/v1.2.3/login?from=home#tab", navigate: async (url) => calls.push(url) },
        { url: "https://app.test/closed", navigate: async () => { throw new Error("closed window"); } },
      ];
    } },
    // Any cache/data deletion or claim of unrelated windows would fail this test.
  } });
  let pending;
  events.install({ waitUntil(p) { pending = p; } });
  await pending;
  events.activate({ waitUntil(p) { pending = p; } });
  await pending;
  assert.deepEqual(calls, ["skipWaiting", "unregister", "https://app.test/v1.2.3/login?from=home#tab"]);
  assert.deepEqual(Object.keys(events), ["install", "activate"]);
});
