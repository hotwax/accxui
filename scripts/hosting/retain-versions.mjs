import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function selectVersionFiles(files, versions) {
  if (versions.some(version => !/^v\d+\.\d+\.\d+$/.test(version))) {
    throw new Error("Expected stable vX.Y.Z versions");
  }
  const selected = files.filter(file => versions.some(version => file.path.startsWith(`/${version}/`)));
  for (const file of selected) {
    const segments = file.path.slice(1).split("/");
    if (segments.some(segment => !segment || segment === "." || segment === "..") || /[\\%?#\x00-\x20]/.test(file.path)) {
      throw new Error(`Unsafe hosted path: ${file.path}`);
    }
    if (file.status !== "ACTIVE" || !/^[a-f0-9]{64}$/.test(file.hash)) throw new Error(`Invalid hosted file: ${file.path}`);
  }
  for (const version of versions) {
    if (!selected.some(file => file.path === `/${version}/index.html`)) {
      throw new Error(`${version} is not hosted; refusing to rebuild or omit it`);
    }
  }
  return selected;
}

export async function writeVerifiedFile(outputDirectory, file, contents) {
  // Firebase identifies files by the SHA-256 of their level-9 gzip representation.
  const compressed = gzipSync(contents, { level: 9 });
  // gzip's OS header differs between macOS, Linux, Windows and unknown-platform uploads.
  // Only that metadata byte may vary; the compressed content must still match exactly.
  const verified = [compressed[9], 0, 3, 19, 255].some(os => {
    compressed[9] = os;
    return createHash("sha256").update(compressed).digest("hex") === file.hash;
  });
  if (!verified) throw new Error(`Hosted content changed or returned a fallback: ${file.path}`);
  const destination = path.join(outputDirectory, file.path.slice(1));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, { flag: "wx" });
}

export async function retainVersions(appDirectory, projectAlias, versions) {
  if (!versions.length) return;
  const rc = JSON.parse(await readFile(path.join(appDirectory, ".firebaserc"), "utf8"));
  const project = rc.projects?.[projectAlias] || projectAlias;
  const sites = rc.targets?.[project]?.hosting?.uat;
  if (sites?.length !== 1 || !/^[a-z0-9-]+$/.test(sites[0])) throw new Error("Expected one configured UAT hosting site");
  const site = sites[0];
  const config = JSON.parse(await readFile(path.join(appDirectory, "firebase.json"), "utf8"));
  const target = [config.hosting].flat().find(target => target.target === "uat");
  if (!target?.public) throw new Error("Missing UAT hosting public directory");
  const outputDirectory = path.resolve(appDirectory, target.public);

  // Use the same Firebase CLI installation and authentication as the deploy step.
  const lib = process.env.FIREBASE_TOOLS_LIB || path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "firebase-tools/lib");
  const require = createRequire(import.meta.url);
  const auth = require(path.join(lib, "auth.js"));
  const { requireAuth } = require(path.join(lib, "requireAuth.js"));
  const { Client } = require(path.join(lib, "apiv2.js"));
  const options = { nonInteractive: true, token: process.env.HOTWAX_PUBLIC_SECRET, account: process.env.FIREBASE_ACCOUNT };
  if (options.account) auth.setActiveAccount(options, auth.selectAccount(options.account));
  await requireAuth(options, true);
  const api = new Client({ urlPrefix: "https://firebasehosting.googleapis.com", apiVersion: "v1beta1", auth: true });
  const latestRelease = async () => (await api.get(`/projects/${project}/sites/${site}/releases`, { queryParams: { pageSize: 1 } })).body.releases?.[0];
  const release = await latestRelease();
  if (!release?.version?.name) throw new Error("No deployed UAT version to retain");
  const files = [];
  let pageToken;
  do {
    const result = (await api.get(`/${release.version.name}/files`, { queryParams: { status: "ACTIVE", pageSize: 1000, ...(pageToken ? { pageToken } : {}) } })).body;
    files.push(...(result.files || []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  const selected = selectVersionFiles(files, versions);
  // An existing directory means a build/copy already occupies this version. Never overwrite it.
  for (const version of versions) await mkdir(path.join(outputDirectory, version));
  for (let offset = 0; offset < selected.length; offset += 8) {
    await Promise.all(selected.slice(offset, offset + 8).map(async file => {
      const response = await fetch(`https://${site}.web.app${file.path}`, { redirect: "error", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${file.path}`);
      await writeVerifiedFile(outputDirectory, file, Buffer.from(await response.arrayBuffer()));
    }));
  }
  if ((await latestRelease())?.name !== release.name) throw new Error("UAT changed while retaining versions; retry against the new release");
  console.log(`Retained ${selected.length} verified files for ${versions.join(", ")} from ${release.version.name}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appDirectory, projectAlias, ...versions] = process.argv.slice(2);
  if (!appDirectory || !projectAlias) throw new Error("Usage: retain-versions.mjs <app-directory> <project-alias> [vX.Y.Z ...]");
  await retainVersions(path.resolve(appDirectory), projectAlias, versions);
}
