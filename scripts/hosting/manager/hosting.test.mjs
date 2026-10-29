// Algorithm model only. Live Firebase reads and real builds are verified separately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHosting } from "./hosting.mjs";
import { planChange } from "./plans.mjs";
const before = {
  release: {
    name: "sites/demo/channels/live/releases/one",
    version: { name: "sites/demo/versions/one" },
  },
  version: {
    name: "sites/demo/versions/one",
    config: { rewrites: [{ glob: "**", path: "/index.html" }] },
  },
  files: [
    { path: "/index.html", hash: "root", status: "ACTIVE" },
    { path: "/v1.0.0/index.html", hash: "old", status: "ACTIVE" },
    { path: "/v2.0.0/index.html", hash: "current", status: "ACTIVE" },
  ],
};
const base = {
  environment: "uat",
  defaultVersion: "v2.0.0",
  hosted: ["v2.0.0", "v1.0.0"],
  releases: ["v3.0.0", "v2.0.0", "v1.0.0"].map((tag_name) => ({
    tag_name,
    draft: false,
  })),
  buildCapable: true,
};
function model({ staleAt = 0, corrupt = false } = {}) {
  let reads = 0,
    live = structuredClone(before),
    candidate,
    files;
  const calls = [];
  const api = async (method, url, body) => {
    calls.push({ method, url });
    if (url.endsWith("/channels/live/releases") && method === "GET") {
      reads++;
      return {
        releases: [
          {
            ...live.release,
            ...(staleAt === reads ? { name: "changed" } : {}),
          },
        ],
      };
    }
    if (method === "GET" && url.endsWith("/versions/one")) return live.version;
    if (method === "GET" && url.endsWith("/versions/one/files"))
      return live.files.length ? { files: live.files } : {};
    if (url.endsWith(":clone")) {
      candidate = { name: "sites/demo/versions/two" };
      files = structuredClone(before.files).filter(
        (f) =>
          !(body.exclude?.regexes || []).some((r) =>
            new RegExp(r).test(f.path),
          ),
      );
      return { done: true, response: candidate };
    }
    if (url.endsWith(":populateFiles")) {
      for (const [path, hash] of Object.entries(body.files)) {
        files = files.filter((f) => f.path !== path);
        files.push({ path, hash, status: "ACTIVE" });
      }
      return { uploadRequiredHashes: [] };
    }
    if (method === "PATCH") {
      candidate = { ...candidate, ...body };
      if (corrupt)
        files.find((f) => f.path === "/index.html").hash = "corrupted";
      return candidate;
    }
    if (url.endsWith("/versions/two/files")) return { files };
    if (method === "GET" && url.endsWith("/versions/two")) return candidate;
    if (method === "POST" && url.endsWith("/releases")) {
      live = {
        release: {
          name: "sites/demo/channels/live/releases/two",
          version: candidate,
        },
        version: candidate,
        files,
      };
      return live.release;
    }
    throw Error("Unexpected model operation " + method + " " + url);
  };
  return { api, upload: async () => {}, calls };
}
test("publish uploads scoped files, verifies preservation, then releases", async () => {
  const client = model();
  const plan = planChange({ ...base, action: "publish", version: "v3.0.0" });
  const r = await applyHosting(
    client,
    { site: "demo" },
    before,
    plan,
    new Map([["/v3.0.0/index.html", Buffer.from("version")]]),
    () => {},
  );
  assert.equal(r.files, 4);
  assert.equal(
    client.calls.filter(
      (c) => c.method === "POST" && c.url.endsWith("/releases"),
    ).length,
    1,
  );
});
test("file names with spaces publish", async () => {
  const client = model();
  await applyHosting(
    client,
    { site: "demo" },
    before,
    planChange({ ...base, action: "publish", version: "v3.0.0" }),
    new Map([
      ["/v3.0.0/index.html", Buffer.from("version")],
      ["/v3.0.0/img/icons/Job manager.png", Buffer.from("icon")],
    ]),
    () => {},
  );
  assert.ok(client.calls.some((c) => c.method === "POST" && c.url.endsWith("/releases")));
});
test("an unsafe file name is rejected before anything is cloned", async () => {
  const client = model();
  await assert.rejects(
    () =>
      applyHosting(
        client,
        { site: "demo" },
        before,
        planChange({ ...base, action: "publish", version: "v3.0.0" }),
        new Map([["/v3.0.0/a#b.js", Buffer.from("x")]]),
        () => {},
      ),
    /Unsafe artifact path: "\/v3\.0\.0\/a#b\.js"/,
  );
  assert.equal(client.calls.some((c) => c.url.includes("versions:clone")), false);
});
for (const staleAt of [1, 2])
  test(`channel movement at checkpoint ${staleAt} prevents publication`, async () => {
    const client = model({ staleAt });
    await assert.rejects(
      () =>
        applyHosting(
          client,
          { site: "demo" },
          before,
          planChange({ ...base, action: "publish", version: "v3.0.0" }),
          new Map([["/v3.0.0/index.html", Buffer.from("version")]]),
          () => {},
        ),
      /changed/,
    );
    assert.equal(
      client.calls.some(
        (c) => c.method === "POST" && c.url.endsWith("/releases"),
      ),
      false,
    );
  });
test("changed Default content fails verification before publication", async () => {
  const client = model({ corrupt: true });
  await assert.rejects(
    () =>
      applyHosting(
        client,
        { site: "demo" },
        before,
        planChange({ ...base, action: "publish", version: "v3.0.0" }),
        new Map([["/v3.0.0/index.html", Buffer.from("version")]]),
        () => {},
      ),
    /Preserved file/,
  );
  assert.equal(
    client.calls.some(
      (c) => c.method === "POST" && c.url.endsWith("/releases"),
    ),
    false,
  );
});
test("replace clears every hosted version folder and keeps only the new set", async () => {
  const client = model();
  const plan = planChange({
    ...base,
    action: "replace",
    version: "v3.0.0,v2.0.0",
    targetDefault: "v3.0.0",
  });
  const r = await applyHosting(
    client,
    { site: "demo" },
    before,
    plan,
    new Map([
      ["/index.html", Buffer.from("root v3")],
      ["/v3.0.0/index.html", Buffer.from("v3")],
      ["/v2.0.0/index.html", Buffer.from("v2 rebuilt")],
    ]),
    () => {},
  );
  assert.equal(r.files, 3);
});
test("removal excludes only its version and preserves the default", async () => {
  const client = model();
  const r = await applyHosting(
    client,
    { site: "demo" },
    before,
    planChange({ ...base, action: "remove", version: "v1.0.0" }),
    new Map(),
    () => {},
  );
  assert.equal(r.files, 2);
  assert.equal(r.previousVersion, before.version.name);
});
