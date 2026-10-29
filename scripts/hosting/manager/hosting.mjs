import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshot, listFiles, fingerprint } from "./providers.mjs";
import { configFor, verifyFileChanges } from "./plans.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
export async function applyHosting(
  connection,
  target,
  before,
  plan,
  artifacts,
  progress,
) {
  const { api, upload } = connection;
  const unchanged = async () => {
    if (fingerprint(await snapshot(api, target.site)) !== fingerprint(before))
      throw Error(
        "Hosting changed since this plan was reviewed. Refresh and review again.",
      );
  };
  await unchanged();
  // Checked before cloning so a bad build leaves nothing behind. Spaces are allowed (Firebase serves
  // them URL-encoded, e.g. Job Manager's "Job manager.png"); characters a URL path cannot carry are not.
  for (const file of artifacts.keys())
    if (
      !file.startsWith("/") ||
      /[\\%?#\x00-\x1f\x7f]/.test(file) ||
      file.split("/").some((p) => p === "." || p === "..")
    )
      throw Error(`Unsafe artifact path: ${JSON.stringify(file)}`);
  // Removed versions go away; replaced versions are cleared so stale hashed assets do not survive.
  const exclusions = [...plan.removed, ...(plan.replaced || [])];
  let operation = await api("POST", `/sites/${target.site}/versions:clone`, {
    sourceVersion: before.version.name,
    finalize: false,
    ...(exclusions.length
      ? {
          exclude: {
            regexes: exclusions.map((v) => `^/${v.replaceAll(".", "\\.")}/.*$`),
          },
        }
      : {}),
  });
  const deadline = Date.now() + 120000;
  while (!operation.done) {
    if (!operation.name || Date.now() > deadline)
      throw Error("Firebase clone timed out.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    operation = await api("GET", `/${operation.name}`);
  }
  if (operation.error || !operation.response?.name)
    throw Error("Firebase clone failed.");
  const name = operation.response.name;
  const blobs = new Map(),
    digests = new Map();
  for (const [file, bytes] of artifacts) {
    const compressed = gzipSync(bytes, { level: 9 }),
      digest = hash(compressed);
    blobs.set(digest, compressed);
    digests.set(file, digest);
  }
  progress(`Uploading ${digests.size} built files`);
  const entries = [...digests];
  for (let offset = 0; offset < entries.length; offset += 500) {
    const response = await api("POST", `/${name}:populateFiles`, {
      files: Object.fromEntries(entries.slice(offset, offset + 500)),
    });
    for (const digest of response.uploadRequiredHashes || []) {
      if (!blobs.has(digest)) throw Error("Unexpected requested upload.");
      await upload(response.uploadUrl, digest, blobs.get(digest));
    }
  }
  const config = configFor(plan, before.version.config);
  await api(
    "PATCH",
    `/${name}`,
    { config, status: "FINALIZED" },
    { updateMask: "config,status" },
  );
  const finalized = await api("GET", `/${name}`);
  if (!isDeepStrictEqual(finalized.config, config))
    throw Error("Firebase configuration verification failed.");
  verifyFileChanges(before.files, await listFiles(api, name), plan, digests);
  await unchanged();
  progress("Publishing verified Firebase deployment");
  const release = await api(
    "POST",
    `/sites/${target.site}/channels/live/releases`,
    {
      message: `Release Manager: ${plan.action} ${plan.version || "all versions"}`,
    },
    { versionName: name },
  );
  const after = await snapshot(api, target.site);
  if (after.release.name !== release.name)
    throw Error(
      "Another deployment followed this operation. Refresh Hosting before proceeding.",
    );
  verifyFileChanges(before.files, after.files, plan, digests);
  if (!isDeepStrictEqual(after.version.config, config))
    throw Error("Published configuration differs from the reviewed plan.");
  return {
    release: release.name,
    version: name,
    previousVersion: before.version.name,
    files: after.files.length,
  };
}
